import '../scripts/test-isolation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {connectStore,migrate,one} from '../server/storage.mjs';
import {provision,requestPasswordReset,resetPassword,login,authenticate} from '../server/auth.mjs';
import {mailConfig,queuePasswordReset,dispatchOne} from '../server/mail.mjs';

test('recupero password self-service: email generica, link monouso e revoca sessioni',async()=>{
  const db=await connectStore();await migrate(db);
  const oldPassword='Password-reset-vecchia-2026!';
  const user=await provision(db,{slug:'reset-demo',name:'Reset Demo',email:'utente@example.com',password:oldPassword,userName:'Utente Test'});
  const config=mailConfig({MAIL_MODE:'preview',MAIL_FROM:'demo@localhost.invalid',MAIL_FROM_NAME:'luviqAI',PUBLIC_APP_URL:'https://staging.example.test'},'https://staging.example.test');
  try{
    const auth=await login(db,{slug:'reset-demo',email:'utente@example.com',password:oldPassword},'login-ip');
    assert.equal((await authenticate(db,'luviq_session='+auth.token)).id,user.id);

    const request=await requestPasswordReset(db,{slug:'reset-demo',email:'utente@example.com'},'reset-ip');
    assert(request?.token);
    assert.equal(request.tenantId,user.tenantId);
    const queued=await queuePasswordReset(db,request,config);
    assert.equal(queued.queued,true);

    const mail=await one(db,"SELECT kind,status,recipient,content FROM mail_messages WHERE id=$1",[queued.mailId]);
    assert.equal(mail.kind,'password_reset');
    assert.equal(mail.status,'queued');
    assert.equal(mail.recipient,'utente@example.com');
    assert(mail.content.link.includes('#reset='));
    assert(!mail.content.text.includes(oldPassword));

    await dispatchOne(db,config);
    assert.equal((await one(db,'SELECT status FROM mail_messages WHERE id=$1',[queued.mailId])).status,'preview');

    const nextPassword='Password-reset-nuova-2026!';
    await resetPassword(db,{token:request.token,password:nextPassword});
    assert.equal(await authenticate(db,'luviq_session='+auth.token),null);
    await assert.rejects(resetPassword(db,{token:request.token,password:oldPassword}),/scaduto|utilizzato/);
    await assert.rejects(login(db,{slug:'reset-demo',email:'utente@example.com',password:oldPassword},'old-ip'),/non corretti/);
    const next=await login(db,{slug:'reset-demo',email:'utente@example.com',password:nextPassword},'new-ip');
    assert.equal(next.user.id,user.id);
  }finally{await db.close();}
});

test('recupero password non rivela account inesistenti e applica rate limit',async()=>{
  const db=await connectStore();await migrate(db);
  await provision(db,{slug:'rate-demo',name:'Rate Demo',email:'utente@example.com',password:'Password-rate-limit-2026!'});
  try{
    assert.equal(await requestPasswordReset(db,{slug:'rate-demo',email:'inesistente@example.com'},'same-ip'),null);
    const first=await requestPasswordReset(db,{slug:'rate-demo',email:'utente@example.com'},'same-ip');
    assert(first?.token);
    const second=await requestPasswordReset(db,{slug:'rate-demo',email:'utente@example.com'},'same-ip');
    const third=await requestPasswordReset(db,{slug:'rate-demo',email:'utente@example.com'},'same-ip');
    const fourth=await requestPasswordReset(db,{slug:'rate-demo',email:'utente@example.com'},'same-ip');
    assert(second?.token);
    assert(third?.token);
    assert.equal(fourth,null);
  }finally{await db.close();}
});
