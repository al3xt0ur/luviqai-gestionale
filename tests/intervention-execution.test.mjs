import '../scripts/test-isolation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {connectStore,migrate} from '../server/storage.mjs';
import {provision,manageUser} from '../server/auth.mjs';
import {mutate,snapshot} from '../server/domain.mjs';

test('rapportino: checklist, timer, materiali e firma',async()=>{
  const db=await connectStore();await migrate(db);
  const manager=await provision(db,{slug:'report-a',name:'Report A',email:'manager@example.com',password:'Password-market-ready-2026!'});
  try{
    const operator=(await manageUser(db,manager,{name:'Tecnico',email:'tecnico@example.com',role:'operator',password:'Password-market-ready-2026!'})).user;
    manager.assignableUserIds=[operator.id];
    const run=(actor,action,input)=>mutate(db,actor,action,input,crypto.randomUUID());
    const client=(await run(manager,'client',{name:'Cliente'})).value;
    const job=(await run(manager,'job',{clientId:client.id,title:'Commessa'})).value;
    const intervention=(await run(manager,'intervention',{
      jobId:job.id,date:new Date(Date.now()-60000).toISOString(),service:'Manutenzione',team:'Tecnico',
      duration:60,operators:1,status:'planned',assignedUserIds:[operator.id]
    })).value;

    const operatorActor={...operator,tenantId:manager.tenantId};
    await run(operatorActor,'execution-start',{id:intervention.id});
    await new Promise(resolve=>setTimeout(resolve,10));
    await run(operatorActor,'execution-stop',{id:intervention.id});
    const saved=(await run(operatorActor,'execution-save',{
      id:intervention.id,
      checklist:[{id:'a',text:'Controllo iniziale',done:true},{id:'b',text:'Pulizia finale',done:false}],
      materials:[{id:'m1',text:'Filtro ricambio'}],
      reportNotes:'Intervento eseguito regolarmente.',
      signatureName:'Mario Cliente',
      signatureData:''
    })).value;
    assert.equal(saved.checklist.length,2);
    assert.equal(saved.materials.length,1);
    assert.equal(saved.signatureName,'Mario Cliente');

    const state=await snapshot(db,manager);
    const found=state.interventions.find(i=>i.id===intervention.id);
    assert.equal(found.execution.checklist[0].done,true);
    assert.equal(found.execution.reportNotes,'Intervento eseguito regolarmente.');
    assert.ok(found.execution.elapsedSeconds>=0);
  }finally{await db.close();}
});

test('rapportino: operatore non assegnato non può modificarlo',async()=>{
  const db=await connectStore();await migrate(db);
  const manager=await provision(db,{slug:'report-b',name:'Report B',email:'manager2@example.com',password:'Password-market-ready-2026!'});
  try{
    const one=(await manageUser(db,manager,{name:'Uno',email:'uno@example.com',role:'operator',password:'Password-market-ready-2026!'})).user;
    const two=(await manageUser(db,manager,{name:'Due',email:'due@example.com',role:'operator',password:'Password-market-ready-2026!'})).user;
    manager.assignableUserIds=[one.id,two.id];
    const run=(actor,action,input)=>mutate(db,actor,action,input,crypto.randomUUID());
    const client=(await run(manager,'client',{name:'Cliente'})).value;
    const job=(await run(manager,'job',{clientId:client.id,title:'Commessa'})).value;
    const intervention=(await run(manager,'intervention',{
      jobId:job.id,date:new Date(Date.now()-60000).toISOString(),service:'Visita',team:'Uno',
      duration:60,operators:1,status:'planned',assignedUserIds:[one.id]
    })).value;
    await assert.rejects(run({...two,tenantId:manager.tenantId},'execution-save',{id:intervention.id,checklist:[],materials:[]}),/non assegnato/);
  }finally{await db.close();}
});
