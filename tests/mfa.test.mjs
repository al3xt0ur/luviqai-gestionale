import '../scripts/test-isolation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHmac} from 'node:crypto';
import {connectStore,migrate} from '../server/storage.mjs';
import {provision,login,authenticate,beginMfaSetup,enableMfa,verifyMfaLogin,mfaStatus,disableMfa} from '../server/auth.mjs';

const B32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function decode(value){let bits=0,acc=0;const out=[];for(const c of value){const n=B32.indexOf(c);acc=(acc<<5)|n;bits+=5;if(bits>=8){out.push((acc>>>(bits-8))&255);bits-=8;}}return Buffer.from(out)}
function totp(secret,time=Date.now()){const counter=Math.floor(time/30000),buf=Buffer.alloc(8);buf.writeBigUInt64BE(BigInt(counter));const h=createHmac('sha1',decode(secret)).update(buf).digest(),o=h[h.length-1]&15;return String((h.readUInt32BE(o)&0x7fffffff)%1000000).padStart(6,'0')}

test('MFA TOTP: setup, login challenge, recovery code e disattivazione',async()=>{
  process.env.MFA_SECRET_KEY=randomBytes(32).toString('base64url');
  const db=await connectStore();await migrate(db);
  const password='Password-MFA-prova-2026!';
  const user=await provision(db,{slug:'mfa-demo',name:'MFA Demo',email:'admin@example.com',password});
  try{
    const first=await login(db,{slug:'mfa-demo',email:user.email,password},'mfa-ip-1');
    const actor=await authenticate(db,'luviq_session='+first.token);
    assert.equal((await mfaStatus(db,actor)).enabled,false);

    const setup=await beginMfaSetup(db,actor);
    assert.match(setup.secret,/^[A-Z2-7]+$/);
    assert(setup.uri.startsWith('otpauth://totp/'));

    const enabled=await enableMfa(db,actor,{code:totp(setup.secret)});
    assert.equal(enabled.ok,true);
    assert.equal(enabled.recoveryCodes.length,8);
    assert.equal((await mfaStatus(db,actor)).enabled,true);

    const challenged=await login(db,{slug:'mfa-demo',email:user.email,password},'mfa-ip-2');
    assert.equal(challenged.mfaRequired,true);
    assert(!challenged.token);
    await assert.rejects(verifyMfaLogin(db,{challenge:challenged.challenge,code:'000000'}),/non valido/);

    const second=await verifyMfaLogin(db,{challenge:challenged.challenge,code:totp(setup.secret)});
    const secondActor=await authenticate(db,'luviq_session='+second.token);
    assert.equal(secondActor.id,user.id);

    const recoveryLogin=await login(db,{slug:'mfa-demo',email:user.email,password},'mfa-ip-3');
    const recovered=await verifyMfaLogin(db,{challenge:recoveryLogin.challenge,code:enabled.recoveryCodes[0]});
    assert.equal(recovered.user.id,user.id);
    const reuse=await login(db,{slug:'mfa-demo',email:user.email,password},'mfa-ip-4');
    await assert.rejects(verifyMfaLogin(db,{challenge:reuse.challenge,code:enabled.recoveryCodes[0]}),/non valido/);

    const currentActor=await authenticate(db,'luviq_session='+recovered.token);
    await disableMfa(db,currentActor,{password,code:totp(setup.secret)});
    const normal=await login(db,{slug:'mfa-demo',email:user.email,password},'mfa-ip-5');
    assert(normal.token);
    assert.equal(normal.mfaRequired,undefined);
  }finally{await db.close();delete process.env.MFA_SECRET_KEY}
});
