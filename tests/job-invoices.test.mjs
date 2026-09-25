import '../scripts/test-isolation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {connectStore,migrate} from '../server/storage.mjs';
import {provision} from '../server/auth.mjs';
import {mutate,snapshot} from '../server/domain.mjs';
import {today} from '../server/quotes.mjs';

test('fatturazione lavori: preventivo, manuale, validazioni, duplicati e modifica',async()=>{
 const db=await connectStore();await migrate(db);await migrate(db);
 const actor=await provision(db,{slug:'job-billing',name:'Billing',email:'billing@example.com',password:'Password-billing-2026!'});
 const run=(action,input,key=crypto.randomUUID())=>mutate(db,actor,action,input,key);
 try{
  const client=(await run('client',{name:'Cliente lavoro'})).value;
  const other=(await run('client',{name:'Altro cliente'})).value;
  const base={clientId:client.id,title:'Servizio',issueDate:today(),dueDate:today(),lines:[{description:'Pulizia',quantity:200,unitPrice:12500,vat:2200,discount:1000}]};
  let quote=(await run('quote',{...base,validUntil:today()})).value;
  for(const status of ['sent','accepted'])quote=(await run('quote-status',{id:quote.id,revision:quote.revision,status,reason:'Conferma'})).value;
  async function completed(quoteId){
   let job=(await run('job',{clientId:client.id,title:'Lavoro completato',quoteId})).value;
   await assert.rejects(run('invoice',{...base,jobId:job.id}),/completato/);
   for(const status of ['planned','active','completed'])job=(await run('job-status',{id:job.id,revision:job.revision,status,reason:'Avanzamento'})).value;
   return job;
  }
  const job=await completed(quote.id),manual=await completed(null);
  await assert.rejects(run('invoice',{...base,jobId:9999}),/non trovata/);
  await assert.rejects(run('invoice',{...base,clientId:other.id,jobId:manual.id}),/stesso cliente/);
  const key=crypto.randomUUID(),input={...base,jobId:job.id,quoteId:quote.id};
  const invoice=(await run('invoice',input,key)).value;
  assert.equal(invoice.jobId,job.id);assert.equal(invoice.quoteId,quote.id);
  assert.equal(invoice.total,quote.total);assert.deepEqual(invoice.document.lines,quote.document.lines);
  assert.deepEqual(invoice.document.job,{id:job.id,title:job.title});
  assert.equal((await run('invoice',input,key)).value.id,invoice.id);
  await assert.rejects(run('invoice',{...base,jobId:job.id}),/già una fattura/);
  await assert.rejects(run('invoice',{...base,id:invoice.id,revision:invoice.revision,quoteId:null,clientId:other.id,reason:'Cambio cliente'}),/stesso cliente/);
  const edited=(await run('invoice',{...base,id:invoice.id,revision:invoice.revision,quoteId:quote.id,reason:'Aggiornamento'})).value;
  assert.equal(edited.jobId,job.id);
  const manualInput={...base,jobId:manual.id,title:manual.title,lines:[{description:manual.title,quantity:100,unitPrice:0,vat:2200}]};
  const attempts=await Promise.allSettled([run('invoice',manualInput),run('invoice',manualInput)]);
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
  const manualInvoice=attempts.find(r=>r.status==='fulfilled').value.value;
  assert.equal(manualInvoice.quoteId,null);assert.equal(manualInvoice.jobId,manual.id);assert.equal(manualInvoice.total,0);
  await assert.rejects(run('invoice',{...base,id:edited.id,revision:edited.revision,jobId:manual.id,quoteId:null,reason:'Cambio lavoro'}),/già una fattura/);
  await run('invoice-status',{id:manualInvoice.id,revision:manualInvoice.revision,status:'cancelled',reason:'Da rifare'});
  const replacement=(await run('invoice',manualInput)).value;assert.notEqual(replacement.id,manualInvoice.id);
  const free=(await run('invoice',base)).value;assert.equal(free.jobId,null);
  await run('invoice-status',{id:edited.id,revision:edited.revision,status:'cancelled',reason:'Da rifare'});
  const quoteOnly=(await run('invoice',{...base,quoteId:quote.id})).value;
  assert.equal(quoteOnly.jobId,null);assert.equal(quoteOnly.quoteId,quote.id);
  const state=await snapshot(db,actor);assert.equal(state.invoices.find(i=>i.id===replacement.id).jobId,manual.id);
  const tenantB=await provision(db,{slug:'billing-other',name:'Other',email:'other@example.com',password:'Password-billing-2026!'});
  const foreignClient=(await mutate(db,tenantB,'client',{name:'Cliente B'},crypto.randomUUID())).value;
  await assert.rejects(mutate(db,tenantB,'invoice',{...base,clientId:foreignClient.id,jobId:job.id},crypto.randomUUID()),/non trovata/);
 }finally{await db.close();}
});
