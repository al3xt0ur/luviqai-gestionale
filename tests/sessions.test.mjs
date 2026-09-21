import '../scripts/test-isolation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {connectStore,migrate} from '../server/storage.mjs';
import {provision,digest,activeSessions,revokeSession,revokeOtherSessions} from '../server/auth.mjs';

test('gestione sessioni attive e revoca',async()=>{
  const db=await connectStore();await migrate(db);
  const user=await provision(db,{slug:'sessioni-demo',name:'Sessioni Demo',email:'admin@example.com',password:'Una-password-lunga-2026!'});
  const now=Date.now();
  const hashes=['uno','due','tre'].map(digest);
  try{
    for(let i=0;i<hashes.length;i++)await db.query(
      'INSERT INTO sessions(token_hash,user_id,csrf,expires,created_at,last_seen_at,ip_address,user_agent) VALUES($1,$2,$3,$4,$5,$5,$6,$7)',
      [hashes[i],user.id,'csrf-'+i,now+3600000,now+i,'10.0.0.'+(i+1),'Browser '+(i+1)]
    );
    const actor={...user,tokenHash:hashes[0],csrf:'csrf-0'};
    let sessions=await activeSessions(db,actor);
    assert.equal(sessions.length,3);
    assert.equal(sessions.filter(s=>s.current).length,1);
    assert.equal(sessions.find(s=>s.userAgent==='Browser 2').ipAddress,'10.0.0.2');

    const other=sessions.find(s=>s.userAgent==='Browser 2');
    await revokeSession(db,actor,{id:other.id});
    sessions=await activeSessions(db,actor);
    assert.equal(sessions.length,2);

    const result=await revokeOtherSessions(db,actor);
    assert.equal(result.revoked,1);
    sessions=await activeSessions(db,actor);
    assert.equal(sessions.length,1);
    assert.equal(sessions[0].current,true);
    await assert.rejects(revokeSession(db,actor,{id:sessions[0].id}),/sessione corrente/i);
  }finally{await db.close();}
});
