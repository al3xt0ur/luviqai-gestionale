import '../scripts/test-isolation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssistant,aiSettings} from '../server/ai.mjs';
import {connectStore,migrate} from '../server/storage.mjs';
import {provision} from '../server/auth.mjs';
import {mutate,snapshot} from '../server/domain.mjs';

test('AI: configurazione consente solo modelli gratuiti',()=>{
 assert.equal(aiSettings({}).enabled,false);
 assert.equal(aiSettings({OPENROUTER_API_KEY:'test',OPENROUTER_MODEL:'paid/model'}).enabled,false);
 assert.equal(aiSettings({OPENROUTER_API_KEY:'test',OPENROUTER_MODEL:'vendor/model:free'}).enabled,true);
});
test('AI: isolamento, conferma esplicita, nessun dato DB al provider e duplicati atomici',async()=>{
 const db=await connectStore();await migrate(db);
 try{
 const a=await provision(db,{slug:'ai-a',name:'A',email:'a@example.com',password:'Password-test-2026!'});
 const b=await provision(db,{slug:'ai-b',name:'B',email:'b@example.com',password:'Password-test-2026!'});
 await mutate(db,a,'client',{name:'Casa Fittizia',email:'secret@example.com'},'client-a');
 await mutate(db,b,'client',{name:'Solo Altra Azienda'},'client-b');
 let time=Date.now(),intent={action:'clients',name:'Casa'},sent,calls=0;
 const ai=createAssistant({settings:aiSettings({OPENROUTER_API_KEY:'fake-test-key'}),now:()=>time,fetcher:async(url,options)=>{calls++;sent=JSON.parse(options.body);return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(intent)}}]})};}});
 await assert.rejects(ai.ask(db,{...a,role:'operator'},{quick:'pending_jobs'}),e=>e.status===403);
 const local=await ai.ask(db,a,{message:'Qual è il lavoro oltre scadenza?'});assert.match(local.text,/Nessun risultato/);assert.equal(calls,0);
 const consentNeeded=await ai.ask(db,a,{message:'Cerca Casa'});assert.equal(consentNeeded.requiresConsent,true);assert.equal(calls,0);
 const search=await ai.ask(db,a,{message:'Cerca Casa',consent:true,history:['Prima domanda']});assert.equal(search.rows.length,1);
 assert(!JSON.stringify(sent).includes('secret@example.com'));assert(!JSON.stringify(sent).includes('Solo Altra Azienda'));assert(JSON.stringify(sent.messages).includes('Prima domanda'));assert.equal(sent.provider.data_collection,'deny');assert.equal(calls,1);
 intent={action:'clients',name:'Solo Altra'};assert.equal((await ai.ask(db,a,{message:'Cerca Solo Altra',consent:true})).rows.length,0);
 intent={action:'sql',sql:'DELETE FROM clients'};await ai.ask(db,a,{message:'Elimina tutto',consent:true});assert.equal((await snapshot(db,a)).clients.length,1);
 intent={action:'draft_quote',clientName:'Casa Fittizia',title:'Pulizia',lines:[{description:'Pulizia',quantity:200,unitPrice:2500,vat:2200}]};
 const draft=await ai.ask(db,a,{message:'Prepara preventivo',consent:true});assert.equal(draft.proposal.total,6100);assert.equal((await snapshot(db,a)).quotes.length,0);
 await assert.rejects(ai.confirm(db,a,{token:draft.proposal.token}),/esplicitamente/);
 await assert.rejects(ai.confirm(db,b,{token:draft.proposal.token,confirm:true}),e=>e.status===404);
 await assert.rejects(ai.confirm(db,{...a,id:'different-user'},{token:draft.proposal.token,confirm:true}),e=>e.status===404);
 const results=await Promise.all(Array.from({length:6},()=>ai.confirm(db,a,{token:draft.proposal.token,confirm:true,payload:{total:1}})));
 assert(results.every(r=>r.quoteId===results[0].quoteId));const state=await snapshot(db,a);assert.equal(state.quotes.length,1);assert.equal(state.quotes[0].total,6100);assert.equal(state.quotes[0].status,'draft');assert.equal(state.audit.filter(r=>r.action==='quote').length,1);
 time+=16*60000;await assert.rejects(ai.confirm(db,a,{token:draft.proposal.token,confirm:true}),e=>e.status===404);
 const offline=createAssistant({settings:aiSettings({}),fetcher:()=>{throw Error('Nessuna rete attesa');}});assert.deepEqual((await offline.ask(db,a,{quick:'overdue_invoices'})).rows,[]);
 await assert.rejects(offline.ask(db,a,{message:'Ciao',consent:true}),e=>e.status===503);
 }finally{await db.close()}
});
test('AI: errori provider e risposta malformata non eseguono scritture',async()=>{
 const db=await connectStore();await migrate(db);try{
 const actor=await provision(db,{slug:'ai-errors',name:'Test',email:'e@example.com',password:'Password-test-2026!'});
 for(const response of [{ok:false,status:429},{ok:true,json:async()=>({choices:[{message:{content:'non json'}}]})}]){
 const ai=createAssistant({settings:aiSettings({OPENROUTER_API_KEY:'fake'}),fetcher:async()=>response});
 await assert.rejects(ai.ask(db,actor,{message:'ciao',consent:true}),e=>[502,503].includes(e.status));
 assert.equal((await snapshot(db,actor)).quotes.length,0);
 }
 }finally{await db.close()}
});

test('AI: riepilogo contestuale usa solo dati server-side senza inviarli al provider',async()=>{
 const db=await connectStore();await migrate(db);try{
  const actor=await provision(db,{slug:'ai-context',name:'Contesto',email:'context@example.com',password:'Password-test-2026!'});
  const clientResult=await mutate(db,actor,'client',{name:'Cliente Contestuale',email:'private@example.com'},'ctx-client');
  const clientId=clientResult.value.id;
  const ai=createAssistant({settings:aiSettings({}),fetcher:()=>{throw Error('Il provider non deve essere chiamato');}});
  const result=await ai.ask(db,actor,{quick:'context_summary',context:{page:'Clienti',clientId}});
  assert.match(result.text,/Cliente Contestuale/);
  assert(result.rows.some(x=>x.includes('lavori aperti')));
 }finally{await db.close()}
});

test('AI: small talk locale e fallback pulito senza OpenRouter',async()=>{
 const db=await connectStore();await migrate(db);try{
  const actor=await provision(db,{slug:'ai-smalltalk',name:'Smalltalk',email:'smalltalk@example.com',password:'Password-test-2026!'});
  const ai=createAssistant({settings:aiSettings({}),fetcher:()=>{throw Error('Provider non atteso');}});
  assert.match((await ai.ask(db,actor,{message:'come ti chiami?'})).text,/luviqAI/);
  assert.match((await ai.ask(db,actor,{message:'ciao'})).text,/assistente operativo/i);
  assert.match((await ai.ask(db,actor,{message:'cosa puoi fare?'})).text,/lavori scaduti/i);
  assert.match((await ai.ask(db,actor,{message:'raccontami una barzelletta'})).text,/OpenRouter gratuito configurato/i);
 }finally{await db.close()}
});
