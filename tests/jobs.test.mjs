import '../scripts/test-isolation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {connectStore,migrate} from '../server/storage.mjs';
import {provision} from '../server/auth.mjs';
import {mutate,snapshot} from '../server/domain.mjs';
import {today} from '../server/quotes.mjs';

const plusDays=(day,n)=>new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);

test('commesse: preventivo accettato, intervento senza pacchetto e isolamento tenant',async()=>{
  const db=await connectStore();await migrate(db);
  const password='Password-market-ready-2026!';
  const a=await provision(db,{slug:'market-a',name:'Market A',email:'a@example.com',password});
  const b=await provision(db,{slug:'market-b',name:'Market B',email:'b@example.com',password});
  const run=(actor,action,input,key=crypto.randomUUID())=>mutate(db,actor,action,input,key);
  try{
    const client=(await run(a,'client',{name:'Cliente Commessa',email:'cliente@example.com'})).value;
    const day=today();
    let quote=(await run(a,'quote',{
      clientId:client.id,
      title:'Servizio a forfait',
      issueDate:day,
      validUntil:plusDays(day,30),
      lines:[{description:'Servizio completo',quantity:100,unitPrice:10000,vat:2200}]
    })).value;
    quote=(await run(a,'quote-status',{id:quote.id,revision:quote.revision,status:'sent',reason:'Invio di prova'})).value;
    quote=(await run(a,'quote-status',{id:quote.id,revision:quote.revision,status:'accepted',reason:'Accettato dal cliente'})).value;

    let job=(await run(a,'job',{
      clientId:client.id,
      quoteId:quote.id,
      title:'Commessa da preventivo',
      description:'Prima commessa market-ready',
      dueDate:plusDays(day,7)
    })).value;
    assert.equal(job.status,'draft');
    assert.equal(job.quoteId,quote.id);
    assert.equal(job.packageId,null);

    job=(await run(a,'job-status',{id:job.id,revision:job.revision,status:'planned',reason:'Pianificazione'})).value;
    job=(await run(a,'job-status',{id:job.id,revision:job.revision,status:'active',reason:'Avvio'})).value;

    const intervention=(await run(a,'intervention',{
      jobId:job.id,
      date:new Date(Date.now()-60000).toISOString(),
      service:'Intervento a forfait',
      team:'Squadra A',
      duration:90,
      operators:2,
      status:'pending'
    })).value;
    assert.equal(intervention.packageId,null);
    assert.equal(intervention.jobId,job.id);

    await run(a,'approve',{id:intervention.id});
    job=(await run(a,'job-status',{id:job.id,revision:job.revision,status:'completed',reason:'Lavoro concluso'})).value;
    assert.equal(job.status,'completed');

    const state=await snapshot(db,a);
    assert.equal(state.jobs.length,1);
    assert.equal(state.interventions[0].jobId,job.id);
    assert.equal(state.interventions[0].clientId,client.id);
    assert.equal(state.interventions[0].cost,180);

    await assert.rejects(run(b,'job-status',{id:job.id,revision:job.revision,status:'cancelled',reason:'Attacco'}),/non trovata/);
    assert.equal((await snapshot(db,b)).jobs.length,0);
  }finally{await db.close();}
});

test('commesse: non si chiude con interventi ancora aperti',async()=>{
  const db=await connectStore();await migrate(db);
  const actor=await provision(db,{slug:'market-c',name:'Market C',email:'c@example.com',password:'Password-market-ready-2026!'});
  const run=(action,input)=>mutate(db,actor,action,input,crypto.randomUUID());
  try{
    const client=(await run('client',{name:'Cliente'})).value;
    let job=(await run('job',{clientId:client.id,title:'Commessa manuale'})).value;
    job=(await run('job-status',{id:job.id,revision:job.revision,status:'planned',reason:'Pianifica'})).value;
    job=(await run('job-status',{id:job.id,revision:job.revision,status:'active',reason:'Avvia'})).value;
    await run('intervention',{jobId:job.id,date:new Date(Date.now()+86400000).toISOString(),service:'Visita',team:'Team',duration:60,operators:1,status:'planned'});
    await assert.rejects(run('job-status',{id:job.id,revision:job.revision,status:'completed',reason:'Chiudi'}),/interventi aperti/);
  }finally{await db.close();}
});
