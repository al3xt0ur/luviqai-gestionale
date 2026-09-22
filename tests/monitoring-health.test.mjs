import '../scripts/test-isolation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {connectStore,migrate} from '../server/storage.mjs';
import {publicHealth} from '../server/monitoring.mjs';

test('health pubblico: ok con database raggiungibile e nessun picco 5xx',async()=>{
  const db=await connectStore();await migrate(db);
  try{
    const health=await publicHealth(db,{errorThreshold:2,windowMinutes:15,release:'6C5B5F577E6EF3F884286AF70D2F738828659DBA'});
    assert.equal(health.ok,true);
    assert.equal(health.status,'ok');
    assert.equal(health.checks.database,'ok');
    assert.equal(health.checks.recentErrors,'ok');
    assert.equal(health.release,'6c5b5f577e6ef3f884286af70d2f738828659dba');
    assert.equal('recentServerErrors' in health,false);
  }finally{await db.close();}
});

test('health pubblico: non espone un identificativo release non valido',async()=>{
  const db=await connectStore();await migrate(db);
  try{
    const health=await publicHealth(db,{release:'valore non sicuro'});
    assert.equal(health.release,'unknown');
  }finally{await db.close();}
});

test('health pubblico: degraded quando i 5xx recenti superano la soglia',async()=>{
  const db=await connectStore();await migrate(db);
  try{
    const date=new Date().toISOString();
    for(let i=0;i<2;i++)await db.query(
      'INSERT INTO technical_log(id,date,method,path,status,duration_ms,tenant_id,user_id,error) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      ['health-test-'+i,date,'GET','/api/test',500,10,null,null,'errore']
    );
    const health=await publicHealth(db,{errorThreshold:2,windowMinutes:15});
    assert.equal(health.ok,false);
    assert.equal(health.status,'degraded');
    assert.equal(health.checks.database,'ok');
    assert.equal(health.checks.recentErrors,'critical');
  }finally{await db.close();}
});
