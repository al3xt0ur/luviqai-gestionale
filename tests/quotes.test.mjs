import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {connectStore,migrate,tenantTransaction} from '../server/storage.mjs';
import {provision} from '../server/auth.mjs';
import {mutate,snapshot} from '../server/domain.mjs';
import {calculateLines,today} from '../server/quotes.mjs';
import {backupStore,restoreStore} from '../server/backup.mjs';

test('preventivi: importi interi e arrotondamento per riga',()=>{
 const result=calculateLines([{description:'Pulizia',quantity:250,unitPrice:1999,discount:1000,vat:2200}]);
 assert.equal(result.net,4498);assert.equal(result.tax,990);assert.equal(result.total,5488);
 assert.equal(calculateLines([{description:'Centesimo',quantity:150,unitPrice:1,vat:0}]).total,2);
 for(const value of [-1,0,1.1,NaN])assert.throws(()=>calculateLines([{description:'Voce',quantity:value,unitPrice:100,vat:0}]),/intero/);
 assert.throws(()=>calculateLines([]),/voci/);assert.throws(()=>calculateLines([{description:' ',quantity:100,unitPrice:100,vat:0}]),/obbligatori/);
 assert.throws(()=>calculateLines([{description:'Grande',quantity:1000000,unitPrice:10000000,vat:0}]),/massimo/);
});

test('preventivi: flusso completo, isolamento, concorrenza, copia, backup e persistenza',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'luviq-quotes-'));let db=await connectStore({path:join(dir,'pg')});
 try{
  await migrate(db);const a=await provision(db,{slug:'quote-a',name:'Impresa A',email:'a@example.com',password:'Password-preventivi-2026!'}),b=await provision(db,{slug:'quote-b',name:'Impresa B',email:'b@example.com',password:'Password-preventivi-2026!'});
  const run=(action,input,key=crypto.randomUUID(),actor=a)=>mutate(db,actor,action,input,key);
  const client=(await run('client',{name:'Cliente originale',address:'Via Uno'})).value;
  const input={clientId:client.id,title:'Pulizie periodiche',issueDate:today(),validUntil:'2099-12-31',lines:[{description:'Servizio',quantity:250,unitPrice:1999,discount:1000,vat:2200}],terms:'Pagamento concordato'};
  let quote;
  await t.test('creazione idempotente, date e stato validati dal server',async()=>{
   const all=await Promise.all(Array.from({length:8},()=>run('quote',{...input,total:1,status:'accepted'},'new-quote')));quote=all[0].value;
   assert(all.every(r=>r.value.id===quote.id));assert.equal(quote.total,5488);assert.equal(quote.status,'draft');
   assert.equal((await snapshot(db,a)).quotes.length,1);
   await assert.rejects(run('quote',{...input,issueDate:'2026-02-30'}),/Data/);
   await assert.rejects(run('quote',{...input,validUntil:'2000-01-01'}),/scadenza/);
   await assert.rejects(run('quote-status',{id:quote.id,revision:quote.revision,status:'accepted',reason:'Salta invio'}),/Passaggio/);
  });
  await t.test('modifiche concorrenti, snapshot anagrafico e invio manuale',async()=>{
   const changes=await Promise.allSettled([run('quote',{...input,id:quote.id,revision:1,title:'Proposta definitiva',reason:'Correzione'}),run('quote',{...input,id:quote.id,revision:1,title:'Conflitto',reason:'Altro'})]);
   assert.equal(changes.filter(x=>x.status==='fulfilled').length,1);assert.equal(changes.filter(x=>x.status==='rejected'&&x.reason.status===409).length,1);
   quote=(await snapshot(db,a)).quotes[0];
   await run('client',{id:client.id,name:'Nome aggiornato'});
   await assert.rejects(run('quote-status',{id:quote.id,revision:quote.revision,status:'sent'}),/obbligatori/);
   quote=(await run('quote-status',{id:quote.id,revision:quote.revision,status:'sent',reason:'Consegnato a mano'})).value;
   assert.equal(quote.document.client.name,'Cliente originale');
   await assert.rejects(run('quote',{...input,id:quote.id,revision:quote.revision,reason:'Cambio'}),/bozze/);
   const state=await snapshot(db,a);assert.equal(state.audit.filter(x=>x.action==='quote-status').length,1);
  });
  await t.test('accettazione una sola volta, scadenza e annullamento motivato',async()=>{
   const p={id:quote.id,revision:quote.revision,status:'accepted',reason:'Conferma telefonica'};
   const all=await Promise.all(Array.from({length:6},()=>run('quote-status',p,'accept')));quote=all[0].value;assert.equal(quote.status,'accepted');
   assert.equal((await snapshot(db,a)).packages.length,0);
   await assert.rejects(run('quote-status',p),/modificato/);
   await assert.rejects(run('quote-status',{...p,revision:quote.revision,status:'rejected'}),/Passaggio/);
   quote=(await run('quote-status',{id:quote.id,revision:quote.revision,status:'cancelled',reason:'Accordo annullato'})).value;
   const expired=(await run('quote',{...input,issueDate:'2000-01-01',validUntil:'2000-02-01'})).value;
   await assert.rejects(run('quote-status',{id:expired.id,revision:1,status:'sent',reason:'Prova'}),/scaduto/);
   const future=(await run('quote',{...input,issueDate:'2099-01-01'})).value;
   await assert.rejects(run('quote-status',{id:future.id,revision:1,status:'sent',reason:'Prova'}),/futuro/);
  });
  await t.test('copia con nuovo numero, isolamento e permessi reali',async()=>{
   const copied=(await run('quote',{...input,sourceId:quote.id})).value;assert.notEqual(copied.number,quote.number);assert.equal(copied.sourceId,quote.id);assert.equal(copied.status,'draft');
   const sent=(await run('quote-status',{id:copied.id,revision:1,status:'sent',reason:'Consegna'})).value;
   const rejected=(await run('quote-status',{id:sent.id,revision:sent.revision,status:'rejected',reason:'Proposta non accettata'})).value;
   assert.equal(rejected.status,'rejected');await assert.rejects(run('quote-status',{id:rejected.id,revision:rejected.revision,status:'accepted',reason:'Ripensamento'}),/Passaggio/);
   const proposal={...input,sourceId:rejected.id,negotiation:true,lines:[{description:'Offerta rinegoziata',quantity:100,unitPrice:3000,discount:0,vat:2200}]};
   const results=await Promise.all(Array.from({length:4},()=>run('quote',proposal,'negotiation-key')));
   assert(results.every(x=>x.value.id===results[0].value.id));
   const revised=results[0].value;assert.equal(revised.status,'draft');assert.equal(revised.total,3660);assert.equal(revised.sourceId,rejected.id);
   const original=(await snapshot(db,a)).quotes.find(x=>x.id===rejected.id);assert.equal(original.status,'rejected');assert.equal(original.total,rejected.total);
   await assert.rejects(run('quote',{...proposal,sourceId:quote.id}),/rifiutato/);
   const other=(await run('client',{name:'Altro cliente'})).value;
   await assert.rejects(run('quote',{...proposal,clientId:other.id}),/stesso cliente/);
   assert.deepEqual((await snapshot(db,b)).quotes,[]);
   await tenantTransaction(db,b.tenantId,async tx=>assert.equal((await tx.query('SELECT * FROM quotes')).rows.length,0));
   await assert.rejects(run('quote-status',{id:quote.id,revision:quote.revision,status:'sent',reason:'Attacco'},undefined,b),/non trovato/);
   await assert.rejects(run('quote',input,undefined,{...a,role:'operator'}),/account/);
   assert.deepEqual((await snapshot(db,{...a,role:'operator'})).quotes,[]);
   await run('quote',input,undefined,{...a,role:'platform_admin'});
  });
  await t.test('ripristino e riavvio conservano contenuti e storico',async()=>{
   const before=await snapshot(db,a),path=join(dir,'backup.json');await backupStore(db,path);
   const restored=await connectStore();try{await migrate(restored);await restoreStore(restored,path);assert.deepEqual(await snapshot(restored,a),before);}finally{await restored.close();}
   await db.close();db=await connectStore({path:join(dir,'pg')});await migrate(db);assert.deepEqual(await snapshot(db,a),before);
  });
 }finally{await db.close();await rm(dir,{recursive:true,force:true});}
});
