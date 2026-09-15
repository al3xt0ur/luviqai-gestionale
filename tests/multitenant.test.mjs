import test from 'node:test';
import assert from 'node:assert/strict';
import { connectStore,migrate,tenantTransaction,one } from '../server/storage.mjs';
import { provision,login,authenticate,manageUser,createReset,resetPassword,changePassword,team } from '../server/auth.mjs';
import { mutate,snapshot } from '../server/domain.mjs';
import { importLegacy } from '../server/bootstrap.mjs';
import { openDB,seed,snapshot as oldSnapshot } from '../server/db.mjs';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('PostgreSQL: autenticazione, isolamento RLS, saldi, ruoli, recupero e migrazione',async t=>{
  const db=await connectStore();await migrate(db);await migrate(db);
  const password='Password-di-prova-2026!';
  const a=await provision(db,{slug:'prima',name:'Prima impresa',email:'admin@example.com',password});
  const b=await provision(db,{slug:'seconda',name:'Seconda impresa',email:'admin@example.com',password});
  const run=(actor,action,input,key=crypto.randomUUID())=>mutate(db,actor,action,input,key);
  let client,pkg,job;
  try {
    await t.test('password cifrate con hash, sessioni persistenti e credenziali di un’altra azienda',async()=>{
      const raw=await one(db,'SELECT password_hash FROM users WHERE id=$1',[a.id]);assert(!raw.password_hash.includes(password));
      const auth=await login(db,{slug:'prima',email:a.email,password},'test-ip');
      assert.equal((await authenticate(db,'luviq_session='+auth.token)).tenantId,a.tenantId);
      assert.equal(await authenticate(db,'luviq_session=invalid'),null);
      await assert.rejects(login(db,{slug:'non-esiste',email:a.email,password},'test-ip'),/non corretti/);
    });
    await t.test('ID sovrapposti e query senza filtro restano separati con RLS',async()=>{
      client=(await run(a,'client',{name:'Cliente riservato A'})).value;
      const cb=(await run(b,'client',{name:'Cliente riservato B'})).value;
      assert.equal(client.id,cb.id);
      assert.equal((await snapshot(db,b)).clients[0].name,'Cliente riservato B');
      await tenantTransaction(db,b.tenantId,async tx=>{
        const all=(await tx.query('SELECT * FROM clients')).rows;
        assert.equal(all.length,1);assert.equal(all[0].name,'Cliente riservato B');
        assert.equal((await tx.query('SELECT * FROM clients WHERE tenant_id=$1',[a.tenantId])).rows.length,0);
        await assert.rejects(tx.query("INSERT INTO clients(tenant_id,id,name,email,phone,address) VALUES($1,99,'Attack','','','')",[a.tenantId]),/row-level security/);
      }).catch(e=>{if(!/transaction is aborted/.test(e.message))throw e;});
      await assert.rejects(run(a,'client',{name:'Attacco',tenantId:b.tenantId}),/azienda/i);
      const onlyA=(await run(a,'client',{name:'Solo A'})).value;
      await assert.rejects(run(b,'client',{id:onlyA.id,name:'Rubato'}),/non trovato/);
    });
    await t.test('approvazioni concorrenti e idempotenza conservano il saldo',async()=>{
      pkg=(await run(a,'package',{clientId:client.id,tier:'Star',initial:300,rule:'operator',paid:true})).value;
      job=(await run(a,'intervention',{packageId:pkg.id,date:new Date(Date.now()-86400000).toISOString(),duration:60,operators:2,service:'Pulizia',team:'Squadra',status:'pending'})).value;
      assert.equal((await snapshot(db,a)).packages[0].free,180);
      const all=await Promise.all(Array.from({length:10},()=>run(a,'approve',{id:job.id},'same-key')));
      assert(all.every(r=>r.ok));
      const state=await snapshot(db,a);assert.equal(state.packages[0].consumed,120);assert.equal(state.audit.filter(x=>x.action==='approve').length,1);
      await assert.rejects(run(a,'approve',{id:job.id}),/Solo/);
      await assert.rejects(run(b,'approve',{id:job.id}),/non trovato/);
      await assert.rejects(run(a,'intervention',{packageId:pkg.id,date:new Date().toISOString(),duration:91,operators:2,service:'Troppo',team:'T',status:'planned'}),/insufficienti/);
    });
    await t.test('rettifica, archivio e annullamento non perdono storia o disponibilità',async()=>{
      await assert.rejects(run(a,'rectify',{id:job.id,duration:40,operators:2}),/obbligatori/);
      await run(a,'rectify',{id:job.id,duration:40,operators:2,reason:'Correzione'});
      assert.equal((await snapshot(db,a)).packages[0].remaining,220);
      await assert.rejects(run(a,'archive',{id:client.id,reason:'Chiudi'}),/ore residue/);
      await run(a,'cancel',{id:job.id,reason:'Annullato'},'cancel-key');
      await run(a,'cancel',{id:job.id,reason:'Annullato'},'cancel-key');
      assert.equal((await snapshot(db,a)).packages[0].free,300);
      const empty=(await run(a,'client',{name:'Da archiviare'})).value;
      await run(a,'archive',{id:empty.id,reason:'Non più cliente'});
      await assert.rejects(run(a,'package',{clientId:empty.id,tier:'Star',initial:1200,rule:'team',paid:true}),/archiviato/);
      await run(a,'restore',{id:empty.id,reason:'Tornato'});
      assert.equal((await snapshot(db,a)).clients.find(c=>c.id===empty.id).archived,false);
    });
    await t.test('operatore limitato agli interventi assegnati, disattivazione revoca la sessione',async()=>{
      await manageUser(db,a,{email:'operatore@example.com',name:'Operatore A',role:'operator',password});
      const opLogin=await login(db,{slug:'prima',email:'operatore@example.com',password},'op-ip');
      const op=opLogin.user;
      assert.equal((await snapshot(db,op)).interventions.length,0);
      a.assignableUserIds=[op.id];
      const j=(await run(a,'intervention',{packageId:pkg.id,date:new Date(Date.now()-60000).toISOString(),service:'Assegnato',team:'Operatore A',duration:30,operators:1,status:'planned',assignedUserId:op.id})).value;
      await assert.rejects(run(op,'complete',{id:job.id,duration:30,operators:1}),/non assegnato/);
      await assert.rejects(run(op,'approve',{id:j.id}),/account/);
      assert.equal((await snapshot(db,op)).interventions.length,1);
      await run(op,'complete',{id:j.id,duration:20,operators:1});
      assert.equal((await snapshot(db,a)).audit[0].authorId,op.id);
      await manageUser(db,a,{id:op.id,active:false});
      assert.equal(await authenticate(db,'luviq_session='+opLogin.token),null);
      await assert.rejects(manageUser(db,b,{id:op.id,active:true}),/non trovato/);
      assert.equal((await team(db,b)).length,1);
    });
    await t.test('recupero monouso, revoca sessioni e cambio password',async()=>{
      const auth=await login(db,{slug:'seconda',email:b.email,password},'b-ip');
      const token=await createReset(db,'seconda',b.email);
      const nextPassword='Nuova-password-2026!';
      await resetPassword(db,{token,password:nextPassword});
      assert.equal(await authenticate(db,'luviq_session='+auth.token),null);
      await assert.rejects(resetPassword(db,{token,password}),/scaduto/);
      const next=await login(db,{slug:'seconda',email:b.email,password:nextPassword},'b-ip');
      await assert.rejects(changePassword(db,b,{currentPassword:'errata',password}),/attuale/);
      await changePassword(db,b,{currentPassword:nextPassword,password});
      assert.equal(await authenticate(db,'luviq_session='+next.token),null);
    });
    await t.test('limite persistente ai tentativi di accesso',async()=>{
      for(let n=0;n<5;n++)await assert.rejects(login(db,{slug:'prima',email:a.email,password:'errata'},'attack-ip'),/non corretti/);
      await assert.rejects(login(db,{slug:'prima',email:a.email,password},'attack-ip'),/Troppi tentativi/);
    });
    await t.test('importazione SQLite preserva quantità e storico una sola volta',async()=>{
      const dir=mkdtempSync(join(tmpdir(),'luviq-import-'));
      try {
        const path=join(dir,'legacy.sqlite'),old=openDB(path);seed(old);const state=oldSnapshot(old);old.close();
        const c=await provision(db,{slug:'importata',name:'Importata',email:'i@example.com',password});
        assert.equal(await importLegacy(db,c.tenantId,path),true);assert.equal(await importLegacy(db,c.tenantId,path),false);
        const imported=await snapshot(db,c);assert.equal(imported.audit.length,state.audit.length);assert.equal(imported.clients.length,4);
        assert.deepEqual(imported.packages.map(p=>[p.id,p.remaining,p.committed,p.free]),state.packages.map(p=>[p.id,p.remaining,p.committed,p.free]));
      }finally{rmSync(dir,{recursive:true,force:true});}
    });
  } finally {await db.close();}
});
