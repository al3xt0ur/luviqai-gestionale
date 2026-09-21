import '../scripts/test-isolation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {connectStore,migrate,one} from '../server/storage.mjs';
import {provision,login,authenticate,manageUser,changePassword} from '../server/auth.mjs';
import {provisionAdmins,platformState,switchCompany,createCompany,suspendCompany,adminProfile,resetCompanyUser} from '../server/platform.mjs';
import {mutate,snapshot} from '../server/domain.mjs';

test('amministratori piattaforma: autorità globale controllata, tracciamento e revoche',async t=>{
  const db=await connectStore();await migrate(db);await migrate(db);
  const password='Password-admin-test-2026!';
  const managers=[];
  for(const slug of ['prima','seconda'])managers.push(await provision(db,{slug,name:slug,email:'manager@example.com',password}));
  const admins=await provisionAdmins(db,[{name:'Admin Uno',email:'one@example.com',password},{name:'Admin Due',email:'two@example.com',password}]);
  const auth=await login(db,{slug:'luviqai',email:'one@example.com',password},'ip-admin');
  let admin=await authenticate(db,'luviq_session='+auth.token);
  const run=(actor,action,input,key=crypto.randomUUID())=>mutate(db,actor,action,input,key);
  try {
    await t.test('due amministratori equivalenti; responsabili senza accesso globale o auto-promozione',async()=>{
      for(const a of admins)assert.equal((await platformState(db,a)).companies.length,2);
      await assert.rejects(platformState(db,managers[0]),/riservato/);
      await assert.rejects(switchCompany(db,managers[0],{id:managers[1].tenantId}),/riservato/);
      await assert.rejects(manageUser(db,managers[0],{name:'Attacco',email:'bad@example.com',password,role:'platform_admin'}),/Ruolo/);
      await assert.rejects(provisionAdmins(db,[{name:'A',email:'a@example.com',password},{name:'B',email:'b@example.com',password}]),/già configurati/);
    });
    await t.test('accesso esplicito con CSRF rinnovato, azioni firmate e RLS mantenuta',async()=>{
      const previous={...admin};
      const entered=await switchCompany(db,admin,{id:managers[0].tenantId});assert.notEqual(entered.csrf,admin.csrf);
      await assert.rejects(switchCompany(db,previous,{id:managers[1].tenantId}),/sessione/);
      admin=await authenticate(db,'luviq_session='+auth.token);
      assert.equal(admin.role,'platform_admin');assert.equal(admin.tenantId,managers[0].tenantId);
      const client=(await run(admin,'client',{name:'Modificato dall’admin'})).value;
      assert.equal((await snapshot(db,managers[0])).clients[0].id,client.id);
      assert.equal((await snapshot(db,managers[0])).audit[0].authorId,admins[0].id);
      assert.equal((await snapshot(db,managers[1])).clients.length,0);
      await switchCompany(db,admin,{id:managers[1].tenantId});admin=await authenticate(db,'luviq_session='+auth.token);
      assert.equal((await snapshot(db,admin)).clients.length,0);
    });
    await t.test('creazione impresa e sospensione revocano solo gli account aziendali',async()=>{
      await createCompany(db,admin,{slug:'terza',name:'Terza',userName:'Nuovo',email:'new@example.com',password},'create-key');
      assert.equal((await platformState(db,admin)).companies.length,3);
      const logged=await login(db,{slug:'prima',email:'manager@example.com',password},'manager-ip');
      await suspendCompany(db,admin,{id:managers[0].tenantId,active:false,reason:'Prova sospensione'});
      assert.equal(await authenticate(db,'luviq_session='+logged.token),null);
      await assert.rejects(login(db,{slug:'prima',email:'manager@example.com',password},'manager-ip'),/non corretti/);
      assert(await authenticate(db,'luviq_session='+auth.token));
      await switchCompany(db,admin,{id:managers[0].tenantId});admin=await authenticate(db,'luviq_session='+auth.token);
      assert.equal((await snapshot(db,admin)).company.active,false);
      await suspendCompany(db,admin,{id:managers[0].tenantId,active:true,reason:'Riattivazione'});
      assert((await login(db,{slug:'prima',email:'manager@example.com',password},'manager-ip')).token);
    });
    await t.test('reset aziendale non espone password e non modifica account platform',async()=>{
      await resetCompanyUser(db,admin,{id:managers[0].id,companyId:managers[0].tenantId,password:'Nuova-password-2026!',reason:'Richiesta responsabile'});
      assert((await login(db,{slug:'prima',email:managers[0].email,password:'Nuova-password-2026!'},'manager-ip')).token);
      await assert.rejects(resetCompanyUser(db,admin,{id:admins[1].id,companyId:admins[1].tenantId,password,reason:'Tentativo'}),/non trovato/);
      const audit=(await platformState(db,admin)).audit;assert(!JSON.stringify(audit).includes('Nuova-password-2026!'));
    });
    await t.test('profilo personale e password funzionano anche dentro un’impresa',async()=>{
      await adminProfile(db,admin,{name:'Admin aggiornato',email:'updated@example.com'});
      await changePassword(db,admin,{currentPassword:password,password:'Admin-nuova-password-2026!'});
      assert.equal(await authenticate(db,'luviq_session='+auth.token),null);
      const newLogin=await login(db,{slug:'luviqai',email:'updated@example.com',password:'Admin-nuova-password-2026!'},'admin-ip');
      assert.equal(newLogin.user.name,'Admin aggiornato');assert.equal(newLogin.user.tenantId,newLogin.user.homeTenantId);
      assert.equal((await one(db,'SELECT count(*) AS n FROM users WHERE role=$1',['platform_admin'])).n,2);
    });
  }finally{await db.close();}
});
