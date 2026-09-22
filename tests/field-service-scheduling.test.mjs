import '../scripts/test-isolation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {connectStore,migrate} from '../server/storage.mjs';
import {provision,manageUser} from '../server/auth.mjs';
import {mutate,snapshot} from '../server/domain.mjs';

test('field service: serie ricorrente multi-operatore e conflitti',async()=>{
  const db=await connectStore();await migrate(db);
  const manager=await provision(db,{slug:'field-team',name:'Field Team',email:'manager@example.com',password:'Password-market-ready-2026!'});
  try{
    const op1=(await manageUser(db,manager,{name:'Operatore Uno',email:'op1@example.com',role:'operator',password:'Password-market-ready-2026!'})).user;
    const op2=(await manageUser(db,manager,{name:'Operatore Due',email:'op2@example.com',role:'operator',password:'Password-market-ready-2026!'})).user;
    manager.assignableUserIds=[op1.id,op2.id];
    const run=(action,input)=>mutate(db,manager,action,input,crypto.randomUUID());

    const client=(await run('client',{name:'Cliente Field'})).value;
    const job=(await run('job',{clientId:client.id,title:'Manutenzione ricorrente'})).value;
    const start=new Date(Date.now()+7*86400000);
    start.setUTCHours(9,0,0,0);

    const created=(await run('intervention',{
      jobId:job.id,
      date:start.toISOString(),
      service:'Manutenzione programmata',
      team:'Squadra Nord',
      duration:120,
      operators:2,
      status:'planned',
      assignedUserIds:[op1.id,op2.id],
      recurrence:{enabled:true,frequency:'weekly',count:3}
    })).value;
    assert.equal(created.recurrenceCount,3);

    const state=await snapshot(db,manager);
    assert.equal(state.interventions.length,3);
    const series=state.interventions.filter(i=>i.recurrenceSeriesId===created.recurrenceSeriesId);
    assert.equal(series.length,3);
    assert.ok(series.every(i=>i.assignedUserIds.length===2));
    assert.deepEqual(new Set(series.flatMap(i=>i.assignedUserIds)),new Set([op1.id,op2.id]));

    await assert.rejects(run('intervention',{
      jobId:job.id,
      date:new Date(start.getTime()+30*60000).toISOString(),
      service:'Conflitto',
      team:'Squadra Nord',
      duration:60,
      operators:1,
      status:'planned',
      assignedUserIds:[op1.id]
    }),/già impegnato/);

    const ordered=[...series].sort((a,b)=>a.date.localeCompare(b.date));
    await assert.rejects(run('reschedule',{
      id:ordered[2].id,
      date:ordered[1].date,
      reason:'Test conflitto'
    }),/già impegnato/);

    const operatorState=await snapshot(db,{...op2,tenantId:manager.tenantId});
    assert.equal(operatorState.interventions.length,3);
  }finally{await db.close();}
});

test('field service: account assegnati non possono superare la squadra dichiarata',async()=>{
  const db=await connectStore();await migrate(db);
  const manager=await provision(db,{slug:'field-count',name:'Field Count',email:'manager2@example.com',password:'Password-market-ready-2026!'});
  try{
    const op1=(await manageUser(db,manager,{name:'Uno',email:'one@example.com',role:'operator',password:'Password-market-ready-2026!'})).user;
    const op2=(await manageUser(db,manager,{name:'Due',email:'two@example.com',role:'operator',password:'Password-market-ready-2026!'})).user;
    manager.assignableUserIds=[op1.id,op2.id];
    const run=(action,input)=>mutate(db,manager,action,input,crypto.randomUUID());
    const client=(await run('client',{name:'Cliente'})).value;
    const job=(await run('job',{clientId:client.id,title:'Commessa'})).value;
    await assert.rejects(run('intervention',{
      jobId:job.id,date:new Date(Date.now()+86400000).toISOString(),service:'Visita',team:'Team',
      duration:60,operators:1,status:'planned',assignedUserIds:[op1.id,op2.id]
    }),/non può superare/);
  }finally{await db.close();}
});
