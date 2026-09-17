import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {connectStore,migrate,tenantTransaction} from '../server/storage.mjs';
import {provision} from '../server/auth.mjs';
import {mutate,snapshot} from '../server/domain.mjs';
import {invoicePDF} from '../server/invoice-pdf.mjs';
import {backupStore,restoreStore} from '../server/backup.mjs';
import {today} from '../server/quotes.mjs';

const addDays=(iso,days)=>{const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)};
const line=(overrides={})=>({description:'Servizio di pulizia',quantity:200,unitPrice:10000,discount:1000,vat:2200,...overrides});

async function acceptedQuote(db,actor,clientId,run){
  const issue=today(),valid=addDays(issue,30);
  let q=(await run('quote',{clientId,title:'Servizio continuativo',issueDate:issue,validUntil:valid,lines:[line()],terms:'Pagamento concordato',notes:''})).value;
  q=(await run('quote-status',{id:q.id,revision:q.revision,status:'sent',reason:'Invio di prova'})).value;
  return (await run('quote-status',{id:q.id,revision:q.revision,status:'accepted',reason:'Accettazione cliente'})).value;
}

test('Fatture: bozza, collegamento preventivo, importi, concorrenza, stati e isolamento',async t=>{
  const db=await connectStore();await migrate(db);
  const a=await provision(db,{slug:'fatture-a',name:'Impresa A',email:'a@example.com',password:'Password-fatture-2026!'});
  const b=await provision(db,{slug:'fatture-b',name:'Impresa B',email:'b@example.com',password:'Password-fatture-2026!'});
  const run=(action,input,key=crypto.randomUUID(),actor=a)=>mutate(db,actor,action,input,key);
  try{
    const ca=(await run('client',{name:'Cliente A',email:'cliente-a@example.com'})).value;
    const ca2=(await run('client',{name:'Cliente A2'})).value;
    const cb=(await run('client',{name:'Cliente B'},undefined,b)).value;
    const quote=await acceptedQuote(db,a,ca.id,run);
    const issue=today(),due=addDays(issue,30);

    let invoice;
    await t.test('creazione e modifica bozza con preventivo accettato dello stesso cliente',async()=>{
      const input={clientId:ca.id,quoteId:quote.id,title:'Fattura servizio',issueDate:issue,dueDate:due,lines:[line()],notes:'Prima nota'};
      const first=await Promise.all(Array.from({length:5},()=>run('invoice',input,'invoice-create')));
      invoice=first[0].value;
      assert(first.every(x=>x.value.id===invoice.id));
      assert.equal(invoice.status,'draft');
      assert.equal(invoice.net,18000);assert.equal(invoice.tax,3960);assert.equal(invoice.total,21960);
      assert.equal(invoice.quoteId,quote.id);assert.equal(invoice.revision,1);
      const saved=JSON.parse(invoice.document);assert.equal(saved.client.id,ca.id);assert.equal(saved.company.name,'Impresa A');
      await assert.rejects(run('invoice',{...input,clientId:ca2.id}),/stesso cliente/);
      await assert.rejects(run('invoice',input),/già una fattura attiva/);
      await assert.rejects(run('invoice',{...input,dueDate:addDays(issue,-1)}),/scadenza/);
      const changed=(await run('invoice',{...input,id:invoice.id,revision:invoice.revision,title:'Fattura aggiornata',lines:[line({quantity:100})],reason:'Correzione quantità'})).value;
      assert.equal(changed.revision,2);assert.equal(changed.net,9000);assert.equal(changed.tax,1980);assert.equal(changed.total,10980);
      assert.equal(JSON.parse(changed.document).title,'Fattura aggiornata');
      invoice=changed;
      const audit=(await snapshot(db,a)).audit.find(x=>x.action==='invoice'&&JSON.parse(x.beforeValue)?.id===invoice.id);
      assert.equal(audit.reason,'Correzione quantità');
    });

    await t.test('versioni concorrenti e chiavi idempotenti non duplicano modifiche',async()=>{
      const base=invoice;
      const edit=n=>run('invoice',{id:base.id,revision:base.revision,clientId:ca.id,quoteId:quote.id,title:'Concorrenza '+n,issueDate:issue,dueDate:due,lines:[line({quantity:100+n})],notes:'',reason:'Test concorrenza'});
      const results=await Promise.allSettled([edit(1),edit(2)]);
      assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
      assert.equal(results.filter(x=>x.status==='rejected'&&x.reason.status===409).length,1);
      invoice=(await snapshot(db,a)).invoices.find(x=>x.id===base.id);
      const repeat=await run('invoice-status',{id:invoice.id,revision:invoice.revision,status:'issued',reason:'Emissione'},'issue-once');
      const duplicate=await run('invoice-status',{id:invoice.id,revision:invoice.revision,status:'issued',reason:'Emissione'},'issue-once');
      assert.deepEqual(duplicate,repeat);invoice=repeat.value;
      await assert.rejects(run('invoice-status',{id:invoice.id,revision:invoice.revision,status:'cancelled',reason:'Altro'},'issue-once'),/Identificativo/);
    });

    await t.test('emissione, pagamento, annullamento e date',async()=>{
      assert.equal(invoice.status,'issued');
      await assert.rejects(run('invoice',{id:invoice.id,revision:invoice.revision,clientId:ca.id,title:'No',issueDate:issue,dueDate:due,lines:[line()],reason:'Tentativo'}),/bozza/);
      await assert.rejects(run('invoice-payment',{id:invoice.id,revision:invoice.revision,paymentDate:addDays(today(),1),method:'Bonifico'}),/futura/);
      invoice=(await run('invoice-payment',{id:invoice.id,revision:invoice.revision,paymentDate:today(),method:'Bonifico',reference:'TRN-123'})).value;
      assert.equal(invoice.status,'paid');assert(invoice.paidAt);
      const payment=typeof invoice.payment==='string'?JSON.parse(invoice.payment):invoice.payment;
      assert.equal(payment.method,'Bonifico');assert.equal(payment.reference,'TRN-123');
      await assert.rejects(run('invoice-status',{id:invoice.id,revision:invoice.revision,status:'cancelled',reason:'Dopo pagamento'}),/Passaggio/);
      await assert.rejects(run('invoice-payment',{id:invoice.id,revision:invoice.revision,paymentDate:today(),method:'Contanti'}),/solo su una fattura emessa/i);

      const q2=await acceptedQuote(db,a,ca.id,run);
      let cancellabile=(await run('invoice',{clientId:ca.id,quoteId:q2.id,title:'Da annullare',issueDate:issue,dueDate:due,lines:[line()]})).value;
      cancellabile=(await run('invoice-status',{id:cancellabile.id,revision:cancellabile.revision,status:'cancelled',reason:'Errore documento'})).value;
      assert.equal(cancellabile.status,'cancelled');
      const replacement=(await run('invoice',{clientId:ca.id,quoteId:q2.id,title:'Sostitutiva',issueDate:issue,dueDate:due,lines:[line()]})).value;
      assert.equal(replacement.quoteId,q2.id);

      const future=addDays(today(),1);
      const q3=await acceptedQuote(db,a,ca.id,run);
      const futureDraft=(await run('invoice',{clientId:ca.id,quoteId:q3.id,title:'Futura',issueDate:future,dueDate:addDays(future,30),lines:[line()]})).value;
      await assert.rejects(run('invoice-status',{id:futureDraft.id,revision:futureDraft.revision,status:'issued',reason:'Troppo presto'}),/data futura/);
    });

    await t.test('permessi e isolamento aziendale',async()=>{
      assert.deepEqual((await snapshot(db,{...a,role:'operator'})).invoices,[]);
      await assert.rejects(run('invoice',{clientId:ca.id,title:'Vietata',issueDate:issue,dueDate:due,lines:[line()]},undefined,{...a,role:'operator'}),/account/);
      assert.deepEqual((await snapshot(db,b)).invoices,[]);
      await assert.rejects(run('invoice-status',{id:invoice.id,revision:invoice.revision,status:'cancelled',reason:'Cross tenant'},undefined,b),/non trovata/);
      await tenantTransaction(db,b.tenantId,async tx=>assert.equal((await tx.query('SELECT * FROM invoices')).rows.length,0));
      const own=(await run('invoice',{clientId:cb.id,title:'Fattura B',issueDate:issue,dueDate:due,lines:[line()]},undefined,b)).value;
      assert.equal(own.id,1);assert.equal((await snapshot(db,a)).invoices.some(x=>x.clientId===cb.id&&x.id===own.id),false);
    });

    await t.test('PDF valido',async()=>{
      const pdf=await invoicePDF(invoice);
      assert(Buffer.isBuffer(pdf));assert(pdf.length>1000);assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
    });
  }finally{await db.close();}
});

test('Fatture incluse in backup e ripristino',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'luviq-invoice-backup-')),path=join(dir,'backup.json');
  const source=await connectStore(),target=await connectStore();
  try{
    await migrate(source);await migrate(target);
    const actor=await provision(source,{slug:'fatture-backup',name:'Backup fatture',email:'backup@example.com',password:'Password-fatture-2026!'});
    const run=(action,input,key=crypto.randomUUID())=>mutate(source,actor,action,input,key);
    const client=(await run('client',{name:'Cliente backup'})).value;
    const invoice=(await run('invoice',{clientId:client.id,title:'Documento backup',issueDate:today(),dueDate:addDays(today(),15),lines:[line()]})).value;
    await backupStore(source,path);await restoreStore(target,path);
    const restored=await snapshot(target,actor);
    assert.equal(restored.invoices.length,1);assert.equal(restored.invoices[0].id,invoice.id);assert.equal(restored.invoices[0].total,invoice.total);
    assert.equal(JSON.parse(restored.invoices[0].document).title,'Documento backup');
  }finally{await source.close();await target.close();rmSync(dir,{recursive:true,force:true});}
});
