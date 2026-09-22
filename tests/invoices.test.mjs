import '../scripts/test-isolation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {connectStore,migrate,tenantTransaction} from '../server/storage.mjs';
import {provision} from '../server/auth.mjs';
import {mutate,snapshot} from '../server/domain.mjs';
import {today} from '../server/quotes.mjs';
import {invoicePDF} from '../server/invoice-pdf.mjs';
import {backupStore,restoreStore} from '../server/backup.mjs';

const plusDays=(base,days)=>new Date(Date.parse(base+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);

async function fixture(){
  const db=await connectStore();await migrate(db);
  const a=await provision(db,{slug:'fatture-a',name:'Impresa Fatture A',email:'a@example.com',password:'Password-fatture-2026!'});
  const b=await provision(db,{slug:'fatture-b',name:'Impresa Fatture B',email:'b@example.com',password:'Password-fatture-2026!'});
  let seq=0;const run=(action,input,key,actor=a)=>mutate(db,actor,action,input,key||`fattura-${++seq}`);
  const client=(await run('client',{name:'Cliente Fatture',email:'cliente@example.com',address:'Via Test 1'})).value;
  const other=(await run('client',{name:'Altro Cliente'})).value;
  const lines=[{description:'Pulizia periodica',quantity:250,unitPrice:1999,discount:1000,vat:2200}];
  return {db,a,b,run,client,other,lines};
}

async function acceptedQuote(f){
  let q=(await f.run('quote',{clientId:f.client.id,title:'Servizio accettato',issueDate:today(),validUntil:plusDays(today(),30),lines:f.lines})).value;
  q=(await f.run('quote-status',{id:q.id,revision:q.revision,status:'sent',reason:'Consegnato'})).value;
  q=(await f.run('quote-status',{id:q.id,revision:q.revision,status:'accepted',reason:'Accettato dal cliente'})).value;
  return q;
}

const invoiceInput=(f,overrides={})=>({clientId:f.client.id,title:'Fattura pulizie',issueDate:today(),dueDate:plusDays(today(),30),lines:f.lines,notes:'Nota fattura',...overrides});

test('fatture: creazione, modifica bozza, importi, scadenze e concorrenza',async()=>{
  const f=await fixture();try{
    const first=await Promise.all(Array.from({length:6},()=>f.run('invoice',invoiceInput(f),'same-create')));
    let invoice=first[0].value;
    assert(first.every(x=>x.value.id===invoice.id));
    assert.equal(invoice.status,'draft');assert.equal(invoice.net,4498);assert.equal(invoice.tax,990);assert.equal(invoice.total,5488);
    assert.match(invoice.number,/^FAT-\d{4}-\d{4}$/);
    await assert.rejects(f.run('invoice',invoiceInput(f,{dueDate:plusDays(today(),-1)})),/scadenza/i);
    await assert.rejects(f.run('invoice',{...invoiceInput(f),id:invoice.id,revision:invoice.revision,title:'Senza motivo'}),/obbligatori/);
    const concurrent=await Promise.allSettled([
      f.run('invoice',{...invoiceInput(f),id:invoice.id,revision:invoice.revision,title:'Versione A',reason:'Correzione A'}),
      f.run('invoice',{...invoiceInput(f),id:invoice.id,revision:invoice.revision,title:'Versione B',reason:'Correzione B'})
    ]);
    assert.equal(concurrent.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(concurrent.filter(x=>x.status==='rejected'&&x.reason.status===409).length,1);
    invoice=(await snapshot(f.db,f.a)).invoices[0];assert.equal(invoice.revision,2);
  }finally{await f.db.close()}
});

test('fatture: preventivo accettato, stesso cliente e collegamento duplicato',async()=>{
  const f=await fixture();try{
    const quote=await acceptedQuote(f);
    const invoice=(await f.run('invoice',invoiceInput(f,{quoteId:quote.id}))).value;
    assert.equal(invoice.quoteId,quote.id);
    await assert.rejects(f.run('invoice',invoiceInput(f,{quoteId:quote.id})),/già una fattura attiva/i);
    await assert.rejects(f.run('invoice',invoiceInput(f,{quoteId:quote.id,clientId:f.other.id})),/stesso cliente/i);
    let pending=(await f.run('quote',{clientId:f.client.id,title:'Non accettato',issueDate:today(),validUntil:plusDays(today(),30),lines:f.lines})).value;
    await assert.rejects(f.run('invoice',invoiceInput(f,{quoteId:pending.id})),/preventivo accettato/i);
    const cancelled=(await f.run('invoice-status',{id:invoice.id,revision:invoice.revision,status:'cancelled',reason:'Annullata'})).value;
    assert.equal(cancelled.status,'cancelled');
    const replacement=(await f.run('invoice',invoiceInput(f,{quoteId:quote.id,title:'Nuova fattura'}))).value;
    assert.equal(replacement.quoteId,quote.id);
  }finally{await f.db.close()}
});

test('fatture: emissione, annullamento, pagamento e transizioni',async()=>{
  const f=await fixture();try{
    let invoice=(await f.run('invoice',invoiceInput(f))).value;
    await assert.rejects(f.run('invoice-payment',{id:invoice.id,revision:invoice.revision,paymentDate:today(),method:'Bonifico'}),/solo su una fattura emessa/i);
    await assert.rejects(f.run('invoice-status',{id:invoice.id,revision:invoice.revision,status:'issued',reason:' '},undefined),/obbligatori/);
    invoice=(await f.run('invoice-status',{id:invoice.id,revision:invoice.revision,status:'issued',reason:'Documento emesso'})).value;
    assert.equal(invoice.status,'issued');
    await assert.rejects(f.run('invoice',{...invoiceInput(f),id:invoice.id,revision:invoice.revision,reason:'Cambio'}),/bozza/i);
    await assert.rejects(f.run('invoice-payment',{id:invoice.id,revision:invoice.revision,paymentDate:plusDays(today(),1),method:'Bonifico'}),/futura/i);
    invoice=(await f.run('invoice-payment',{id:invoice.id,revision:invoice.revision,paymentDate:today(),method:'Bonifico',reference:'CRO TEST'})).value;
    assert.equal(invoice.status,'paid');assert(invoice.paidAt);assert.equal(invoice.payment.method,'Bonifico');
    await assert.rejects(f.run('invoice-status',{id:invoice.id,revision:invoice.revision,status:'cancelled',reason:'Tentativo'}),/Passaggio/i);
    let other=(await f.run('invoice',invoiceInput(f,{title:'Da annullare'}))).value;
    other=(await f.run('invoice-status',{id:other.id,revision:other.revision,status:'issued',reason:'Emessa'})).value;
    other=(await f.run('invoice-status',{id:other.id,revision:other.revision,status:'cancelled',reason:'Storno amministrativo'})).value;
    assert.equal(other.status,'cancelled');
  }finally{await f.db.close()}
});

test('fatture: permessi, isolamento aziendale, idempotenza e RLS',async()=>{
  const f=await fixture();try{
    const invoice=(await f.run('invoice',invoiceInput(f),'invoice-idem')).value;
    const again=(await f.run('invoice',invoiceInput(f),'invoice-idem')).value;assert.equal(again.id,invoice.id);
    await assert.rejects(f.run('invoice',{...invoiceInput(f),title:'Payload diverso'},'invoice-idem'),/Identificativo/i);
    assert.deepEqual((await snapshot(f.db,f.b)).invoices,[]);
    await assert.rejects(f.run('invoice-status',{id:invoice.id,revision:invoice.revision,status:'cancelled',reason:'Attacco'},undefined,f.b),/non trovata/i);
    await assert.rejects(f.run('invoice',invoiceInput(f),undefined,{...f.a,role:'operator'}),/account/i);
    assert.deepEqual((await snapshot(f.db,{...f.a,role:'operator'})).invoices,[]);
    await tenantTransaction(f.db,f.b.tenantId,async tx=>assert.equal((await tx.query('SELECT * FROM invoices')).rows.length,0));
  }finally{await f.db.close()}
});

test('fatture: PDF, backup e ripristino mantengono documento e pagamento',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'luviq-invoices-'));const f=await fixture();try{
    let invoice=(await f.run('invoice',invoiceInput(f))).value;
    const pdf=await invoicePDF(invoice);assert(Buffer.isBuffer(pdf));assert.equal(pdf.subarray(0,4).toString(),'%PDF');assert(pdf.length>1000);
    invoice=(await f.run('invoice-status',{id:invoice.id,revision:invoice.revision,status:'issued',reason:'Emessa'})).value;
    invoice=(await f.run('invoice-payment',{id:invoice.id,revision:invoice.revision,paymentDate:today(),method:'Carta',reference:'POS 1'})).value;
    const path=join(dir,'backup.json');await backupStore(f.db,path);
    const restored=await connectStore();try{await migrate(restored);await restoreStore(restored,path);const state=await snapshot(restored,f.a);assert.equal(state.invoices.length,1);assert.equal(state.invoices[0].status,'paid');assert.equal(state.invoices[0].payment.reference,'POS 1');assert.equal(state.invoices[0].document.title,'Fattura pulizie');}finally{await restored.close();}
  }finally{await f.db.close();await rm(dir,{recursive:true,force:true})}
});
