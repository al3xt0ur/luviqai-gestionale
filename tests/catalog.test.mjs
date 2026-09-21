import '../scripts/test-isolation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {connectStore,migrate,tenantTransaction} from '../server/storage.mjs';
import {provision} from '../server/auth.mjs';
import {mutate,snapshot} from '../server/domain.mjs';

test('Catalogo: condizioni immutabili, rinnovi, concorrenza, ruoli e imprese separate',async t=>{
  const db=await connectStore();await migrate(db);
  const a=await provision(db,{slug:'catalogo-a',name:'A',email:'a@example.com',password:'Password-catalogo-2026!'});
  const b=await provision(db,{slug:'catalogo-b',name:'B',email:'b@example.com',password:'Password-catalogo-2026!'});
  const run=(action,input,key=crypto.randomUUID(),actor=a)=>mutate(db,actor,action,input,key);
  let model,pkg,client;
  try {
    await t.test('nuova impresa vuota, quantità intere e duplicati',async()=>{
      assert.deepEqual((await snapshot(db,a)).catalog,[]);
      client=(await run('client',{name:'Cliente catalogo'})).value;
      await assert.rejects(run('template',{name:'Zero',minutes:0,rule:'team'}),/intero/);
      await assert.rejects(run('template',{name:'Frazioni',minutes:60.5,rule:'team'}),/intero/);
      await assert.rejects(run('template',{name:'Regola',minutes:60,rule:'invalid'}),/Regola/);
      await assert.rejects(run('template',{name:' ',minutes:60,rule:'team'}),/obbligatori/);
      const input={name:'Su misura',minutes:755,rule:'operator',description:'Servizi personalizzati'};
      const attempts=await Promise.all(Array.from({length:8},()=>run('template',input,'create-model')));
      model=attempts[0].value;assert(attempts.every(r=>r.value.id===model.id));
      assert.equal((await snapshot(db,a)).catalog.length,1);
      await assert.rejects(run('template',{...input,name:'SU MISURA'}),/già un modello/);
      await assert.rejects(run('package',{clientId:client.id,tier:'Star',initial:100,rule:'team'}),/catalogo/);
      await assert.rejects(run('package',{clientId:client.id,templateId:model.id,templateRevision:1,initial:756}),/intero/);
      pkg=(await run('package',{clientId:client.id,templateId:model.id,templateRevision:1,initial:700,paid:true,rule:'team',tier:'Alterato',original:9999})).value;
      assert.equal(pkg.original,755);assert.equal(pkg.rule,'operator');assert.equal(pkg.tier,'Su misura');
    });
    await t.test('modifica tracciata senza alterare saldi, nome o regola dei pacchetti venduti',async()=>{
      const change={...model,name:'Offerta nuova',minutes:900,rule:'team',reason:'Nuove condizioni'};
      await assert.rejects(run('template',{...change,reason:''}),/obbligatori/);
      const results=await Promise.allSettled([run('template',change),run('template',{...change,name:'Conflitto'})]);
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
      assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.status===409).length,1);
      model=(await snapshot(db,a)).catalog[0];
      const state=await snapshot(db,a),saved=state.packages[0];
      assert.equal(saved.tier,'Su misura');assert.equal(saved.original,755);assert.equal(saved.rule,'operator');assert.equal(saved.free,700);
      const audit=state.audit.find(x=>x.action==='template'&&JSON.parse(x.beforeValue));
      assert.equal(JSON.parse(audit.beforeValue).minutes,755);assert.equal(JSON.parse(audit.afterValue).minutes,900);assert.equal(audit.reason,'Nuove condizioni');assert.equal(audit.authorId,a.id);
      await assert.rejects(run('package',{clientId:client.id,templateId:model.id,templateRevision:1,initial:700}),/cambiato/);
      const renewed=(await run('package',{clientId:client.id,templateId:model.id,templateRevision:model.revision,initial:900,renewedFrom:pkg.id})).value;
      assert.equal(renewed.rule,'team');assert.equal(renewed.renewedFrom,pkg.id);assert.equal(renewed.original,900);
      const job=(await run('intervention',{packageId:pkg.id,date:new Date(Date.now()-60000).toISOString(),duration:10,operators:2,status:'pending',service:'Prova',team:'Squadra'})).value;
      await run('approve',{id:job.id});assert.equal((await snapshot(db,a)).packages.find(p=>p.id===pkg.id).consumed,20);
    });
    await t.test('disattivazione impedisce assegnazioni e rinnovi, riattivazione conserva modello',async()=>{
      await assert.rejects(run('template-status',{id:model.id,revision:model.revision,active:false}),/obbligatori/);
      const input={id:model.id,revision:model.revision,active:false,reason:'Fine offerta'};
      const disabled=await Promise.all(Array.from({length:5},()=>run('template-status',input,'disable-model')));
      model=disabled[0].value;assert.equal(model.active,false);
      await assert.rejects(run('package',{clientId:client.id,templateId:model.id,templateRevision:model.revision,initial:100,renewedFrom:pkg.id}),/disattivato/);
      await migrate(db);await migrate(db);assert.equal((await snapshot(db,a)).catalog[0].active,false);
      model=(await run('template-status',{id:model.id,revision:model.revision,active:true,reason:'Riapertura'})).value;
      assert.equal(model.active,true);
    });
    await t.test('catalogo isolato tramite RLS, operatore escluso, admin autorizzato',async()=>{
      assert.deepEqual((await snapshot(db,b)).catalog,[]);
      const bc=(await run('client',{name:'Cliente B'},undefined,b)).value;
      await assert.rejects(run('package',{clientId:bc.id,templateId:model.id,templateRevision:model.revision,initial:100},undefined,b),/catalogo/);
      await assert.rejects(run('template',{...model,name:'Sottratto',reason:'Test'},undefined,b),/non trovato/);
      await tenantTransaction(db,b.tenantId,async tx=>assert.equal((await tx.query('SELECT * FROM package_templates')).rows.length,0));
      await assert.rejects(run('template',{name:'Vietato',minutes:60,rule:'team'},undefined,{...a,role:'operator'}),/account/);
      assert.deepEqual((await snapshot(db,{...a,role:'operator'})).catalog,[]);
      await run('template',{name:'Creato da admin',minutes:60,rule:'team'},undefined,{...a,role:'platform_admin'});
      await run('template',{name:'Su misura',minutes:35,rule:'team'},undefined,b);
      assert.equal((await snapshot(db,a)).catalog.length,2);assert.equal((await snapshot(db,b)).catalog.length,1);
    });
  }finally{await db.close();}
});

test('migrazione del catalogo preserva pacchetti precedenti e non ricrea modelli al riavvio',async()=>{
  const db=await connectStore();
  try {
    const sql=(await readFile(new URL('../server/schema.sql',import.meta.url),'utf8')).split(/-- next\r?\nCREATE TABLE IF NOT EXISTS package_templates/)[0];
    await db.transaction(async tx=>{for(const statement of sql.split('-- next'))if(statement.trim())await tx.query(statement);});
    const a=await provision(db,{slug:'precedente',name:'Precedente',email:'old@example.com',password:'Password-legacy-2026!'});
    await db.query("INSERT INTO clients VALUES($1,1,'Legacy','','','',false)",[a.tenantId]);
    for(let id=1;id<=2;id++)await db.query("INSERT INTO packages(tenant_id,id,client_id,tier,original,initial,rule,paid,created) VALUES($1,$2,1,'Star',1200,150,$3,1,'2026-01-01')",[a.tenantId,id,id===1?'operator':'team']);
    await migrate(db);const before=await snapshot(db,a);
    assert.equal(before.catalog.length,2);assert.equal(before.packages[0].tier,'Star');assert.equal(before.packages[0].free,150);
    assert.equal(new Set(before.catalog.map(x=>x.name)).size,2);
    assert(before.packages.every(p=>before.catalog.some(c=>c.id===p.templateId&&c.rule===p.rule)));
    await migrate(db);assert.deepEqual(await snapshot(db,a),before);
  }finally{await db.close();}
});
