import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash, createHmac, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';
import { one, rows } from './storage.mjs';
import { fail, required, insert } from './domain.mjs';

const scrypt=promisify(scryptCallback);
export const digest=value=>createHash('sha256').update(value).digest('hex');
export const secret=()=>randomBytes(32).toString('base64url');
export function validatePassword(value) {
  if(typeof value!=='string'||value.length<12||value.length>200)fail('La password deve contenere da 12 a 200 caratteri.');
  return value;
}
export async function hashPassword(value) {
  validatePassword(value);
  const salt=randomBytes(16).toString('hex');
  const hash=await scrypt(value,salt,64,{N:16384,r:8,p:1});
  return `scrypt:${salt}:${hash.toString('hex')}`;
}
async function verify(value,stored) {
  if(typeof value!=='string'||value.length>200)return false;
  const [,salt,hash]=stored.split(':');
  const calculated=await scrypt(value,salt,64,{N:16384,r:8,p:1});
  return timingSafeEqual(calculated,Buffer.from(hash,'hex'));
}
const dummy=await hashPassword(secret());
const now=()=>new Date().toISOString();
const B32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buffer){
  let bits=0,value=0,out='';
  for(const byte of buffer){value=(value<<8)|byte;bits+=8;while(bits>=5){out+=B32[(value>>>(bits-5))&31];bits-=5;}}
  if(bits>0)out+=B32[(value<<(5-bits))&31];
  return out;
}
function base32Decode(value){
  const clean=String(value||'').toUpperCase().replace(/[^A-Z2-7]/g,'');
  let bits=0,acc=0;const out=[];
  for(const char of clean){const n=B32.indexOf(char);if(n<0)continue;acc=(acc<<5)|n;bits+=5;if(bits>=8){out.push((acc>>>(bits-8))&255);bits-=8;}}
  return Buffer.from(out);
}
function mfaKey(){
  const raw=String(process.env.MFA_SECRET_KEY||'');
  let key;
  try{key=Buffer.from(raw,'base64url');}catch{}
  if(!key||key.length!==32)fail('MFA non configurata sul server.',503);
  return key;
}
function encryptMfa(secretValue){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',mfaKey(),iv);
  const ciphertext=Buffer.concat([cipher.update(secretValue,'utf8'),cipher.final()]);
  return [iv,cipher.getAuthTag(),ciphertext].map(v=>v.toString('base64url')).join('.');
}
function decryptMfa(payload){
  const [iv,tag,data]=String(payload||'').split('.').map(v=>Buffer.from(v,'base64url'));
  if(!iv||!tag||!data||iv.length!==12||tag.length!==16)fail('Configurazione MFA non valida.',500);
  const decipher=createDecipheriv('aes-256-gcm',mfaKey(),iv);decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data),decipher.final()]).toString('utf8');
}
function hotp(secretValue,counter){
  const key=base32Decode(secretValue),buf=Buffer.alloc(8);buf.writeBigUInt64BE(BigInt(counter));
  const h=createHmac('sha1',key).update(buf).digest(),offset=h[h.length-1]&15;
  const n=(h.readUInt32BE(offset)&0x7fffffff)%1000000;
  return String(n).padStart(6,'0');
}
function verifyTotp(secretValue,code,time=Date.now()){
  const clean=String(code||'').replace(/\s/g,'');
  if(!/^\d{6}$/.test(clean))return false;
  const counter=Math.floor(time/30000);
  for(let drift=-1;drift<=1;drift++)if(hotp(secretValue,counter+drift)===clean)return true;
  return false;
}
function recoveryCode(){return randomBytes(5).toString('hex').toUpperCase().match(/.{1,5}/g).join('-');}
function safeEqualText(a,b){const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y);}
async function issueSession(tx,user,time=Date.now()){
  const token=secret(),csrf=secret();
  await tx.query('DELETE FROM sessions WHERE expires<$1',[time]);
  await tx.query('INSERT INTO sessions(token_hash,user_id,csrf,expires) VALUES($1,$2,$3,$4)',[digest(token),user.id,csrf,time+8*3600000]);
  return {token,csrf,user:publicUser(user)};
}
export const publicUser=u=>({id:u.id,tenantId:u.active_tenant_id||u.tenant_id,homeTenantId:u.tenant_id,name:u.name,email:u.email,role:u.role,mfaEnabled:!!u.mfa_enabled});

export async function provision(store,{slug,name,email,password,userName='Responsabile'}) {
  if(!/^[a-z0-9-]{3,50}$/.test(slug))fail('Codice azienda non valido.');
  required(name);email=required(email).toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('Email non valida.');
  const passwordHash=await hashPassword(password);
  return store.transaction(async tx=>{
    const tenantId=randomUUID(),id=randomUUID();
    await tx.query('INSERT INTO tenants(id,slug,name,created) VALUES($1,$2,$3,$4)',[tenantId,slug,name,now()]);
    const user=await one(tx,'INSERT INTO users(id,tenant_id,email,name,role,password_hash,created) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[id,tenantId,email,userName,'manager',passwordHash,now()]);
    return publicUser(user);
  });
}

export async function login(store,input,ip) {
  const slug=String(input.slug||'').trim().toLowerCase().slice(0,100),email=String(input.email||'').trim().toLowerCase().slice(0,300);
  const key=digest(`${slug}\0${email}`),ipKey=digest(`ip:${ip}`),time=Date.now();
  const result=await store.transaction(async tx=>{
    // Prima il limite IP, poi quello dell'account: ordine costante contro deadlock.
    for(const k of [ipKey,key])await tx.query('INSERT INTO login_attempts(key,failures,blocked_until) VALUES($1,0,0) ON CONFLICT DO NOTHING',[k]);
    const ipAttempt=await one(tx,'SELECT * FROM login_attempts WHERE key=$1 FOR UPDATE',[ipKey]);
    const attempt=await one(tx,'SELECT * FROM login_attempts WHERE key=$1 FOR UPDATE',[key]);
    if(Number(ipAttempt.blocked_until)>time||Number(attempt.blocked_until)>time)return {error:'Troppi tentativi. Riprova tra 15 minuti.',status:429};
    const user=await one(tx,'SELECT u.* FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE t.slug=$1 AND u.email=$2 AND u.active=true AND t.active=true',[slug,email]);
    const valid=await verify(input.password,user?.password_hash||dummy);
    if(!valid||!user) {
      for(const [k,a,limit] of [[ipKey,ipAttempt,30],[key,attempt,5]]) {
        const count=(Number(a.blocked_until)>0?0:a.failures)+1;
        await tx.query('UPDATE login_attempts SET failures=$2,blocked_until=$3 WHERE key=$1',[k,count,count>=limit?time+900000:0]);
      }
      return {error:'Azienda, email o password non corretti.',status:401};
    }
    await tx.query('DELETE FROM login_attempts WHERE key=$1',[key]);
    if(user.mfa_enabled){
      const challenge=secret();
      await tx.query('DELETE FROM mfa_challenges WHERE user_id=$1 OR expires<$2',[user.id,time]);
      await tx.query('INSERT INTO mfa_challenges(token_hash,user_id,expires,failures) VALUES($1,$2,$3,0)',[digest(challenge),user.id,time+5*60000]);
      return {mfaRequired:true,challenge,user:{name:user.name,email:user.email,role:user.role}};
    }
    return issueSession(tx,user,time);
  });
  if(result.error)fail(result.error,result.status);
  return result;
}

export async function verifyMfaLogin(store,input){
  const challenge=String(input?.challenge||''),code=String(input?.code||'').trim(),time=Date.now();
  if(!/^[A-Za-z0-9_-]{43}$/.test(challenge))fail('Verifica MFA non valida o scaduta.',401);
  return store.transaction(async tx=>{
    const row=await one(tx,`SELECT c.*,u.* FROM mfa_challenges c JOIN users u ON u.id=c.user_id JOIN tenants t ON t.id=u.tenant_id
      WHERE c.token_hash=$1 AND c.expires>$2 AND u.active=true AND t.active=true FOR UPDATE OF c`,[digest(challenge),time]);
    if(!row||!row.mfa_enabled||!row.mfa_secret_enc)fail('Verifica MFA non valida o scaduta.',401);
    if(Number(row.failures)>=5){await tx.query('DELETE FROM mfa_challenges WHERE token_hash=$1',[digest(challenge)]);fail('Troppi tentativi MFA. Accedi di nuovo.',429);}
    const secretValue=decryptMfa(row.mfa_secret_enc);
    let valid=verifyTotp(secretValue,code),recovery=false;
    const recoveryHashes=Array.isArray(row.mfa_recovery)?row.mfa_recovery:[];
    if(!valid&&code){
      const candidate=digest('mfa-recovery:'+code.toUpperCase());
      const index=recoveryHashes.findIndex(v=>safeEqualText(v,candidate));
      if(index>=0){valid=true;recovery=true;recoveryHashes.splice(index,1);}
    }
    if(!valid){await tx.query('UPDATE mfa_challenges SET failures=failures+1 WHERE token_hash=$1',[digest(challenge)]);fail('Codice di verifica non valido.',401);}
    if(recovery)await tx.query('UPDATE users SET mfa_recovery=$2 WHERE id=$1',[row.id,JSON.stringify(recoveryHashes)]);
    await tx.query('DELETE FROM mfa_challenges WHERE user_id=$1',[row.id]);
    return issueSession(tx,row,time);
  });
}

export async function mfaStatus(store,actor){
  const user=await one(store,'SELECT mfa_enabled FROM users WHERE id=$1',[actor.id]);
  return {enabled:!!user?.mfa_enabled,available:!!process.env.MFA_SECRET_KEY,eligible:['manager','platform_admin'].includes(actor.role)};
}

export async function beginMfaSetup(store,actor){
  if(!['manager','platform_admin'].includes(actor.role))fail('MFA disponibile per amministratori e responsabili.',403);
  mfaKey();
  const tenantId=actor.homeTenantId||actor.tenantId;
  return store.transaction(async tx=>{
    const user=await one(tx,'SELECT * FROM users WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[actor.id,tenantId]);
    if(!user)fail('Account non trovato.',404);
    const secretValue=base32Encode(randomBytes(20));
    await tx.query('UPDATE users SET mfa_secret_enc=$2,mfa_enabled=false,mfa_recovery=\'[]\'::jsonb WHERE id=$1',[actor.id,encryptMfa(secretValue)]);
    const label=encodeURIComponent('luviqAI:'+user.email),issuer=encodeURIComponent('luviqAI');
    return {secret:secretValue,uri:`otpauth://totp/${label}?secret=${secretValue}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`};
  });
}

export async function enableMfa(store,actor,input){
  if(!['manager','platform_admin'].includes(actor.role))fail('MFA disponibile per amministratori e responsabili.',403);
  const tenantId=actor.homeTenantId||actor.tenantId;
  return store.transaction(async tx=>{
    const user=await one(tx,'SELECT * FROM users WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[actor.id,tenantId]);
    if(!user?.mfa_secret_enc)fail('Avvia prima la configurazione MFA.');
    if(!verifyTotp(decryptMfa(user.mfa_secret_enc),input?.code))fail('Codice di verifica non valido.');
    const codes=Array.from({length:8},()=>recoveryCode());
    const hashes=codes.map(c=>digest('mfa-recovery:'+c));
    await tx.query('UPDATE users SET mfa_enabled=true,mfa_recovery=$2 WHERE id=$1',[actor.id,JSON.stringify(hashes)]);
    await tx.query('DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2',[actor.id,actor.tokenHash]);
    return {ok:true,recoveryCodes:codes};
  });
}

export async function disableMfa(store,actor,input){
  if(!['manager','platform_admin'].includes(actor.role))fail('MFA disponibile per amministratori e responsabili.',403);
  const tenantId=actor.homeTenantId||actor.tenantId;
  return store.transaction(async tx=>{
    const user=await one(tx,'SELECT * FROM users WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[actor.id,tenantId]);
    if(!user?.mfa_enabled||!user.mfa_secret_enc)fail('MFA non attiva.');
    if(!await verify(String(input?.password||''),user.password_hash))fail('Password attuale non corretta.');
    if(!verifyTotp(decryptMfa(user.mfa_secret_enc),input?.code))fail('Codice di verifica non valido.');
    await tx.query('UPDATE users SET mfa_enabled=false,mfa_secret_enc=NULL,mfa_recovery=\'[]\'::jsonb WHERE id=$1',[actor.id]);
    await tx.query('DELETE FROM mfa_challenges WHERE user_id=$1',[actor.id]);
    await tx.query('DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2',[actor.id,actor.tokenHash]);
    return {ok:true};
  });
}

export async function authenticate(store,cookie='') {
  const token=cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith('luviq_session='))?.slice(14);
  if(!token)return null;
  const user=await one(store,'SELECT u.*,s.csrf,s.token_hash,s.active_tenant_id FROM sessions s JOIN users u ON u.id=s.user_id JOIN tenants t ON t.id=u.tenant_id WHERE s.token_hash=$1 AND s.expires>$2 AND u.active=true AND t.active=true',[digest(token),Date.now()]);
  return user?{...publicUser(user),csrf:user.csrf,tokenHash:user.token_hash}:null;
}

export const team=async(store,actor)=>rows(store,'SELECT id,name,email,role,active FROM users WHERE tenant_id=$1 ORDER BY name',[actor.tenantId]);

export async function manageUser(store,actor,input) {
  if(!['manager','platform_admin'].includes(actor.role))fail('Operazione riservata al responsabile.',403);
  const passwordHash=input.password?await hashPassword(input.password):null;
  return store.transaction(async tx=>{
    await tx.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE',[actor.tenantId]);
    let before=null,after;
    if(input.id) {
      before=await one(tx,'SELECT id,name,email,role,active FROM users WHERE tenant_id=$1 AND id=$2',[actor.tenantId,input.id]);
      if(!before)fail('Utente non trovato.',404);
      if(before.role==='platform_admin')fail('Gli amministratori della piattaforma si gestiscono dal pannello luviqAI.',403);
      if(input.id===actor.id)fail('Gestisci il tuo account dalla sezione personale.');
      if(input.mode==='update') {
        const name=required(input.name),email=required(input.email).toLowerCase();
        if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('Email non valida.');
        if(!['manager','operator'].includes(input.role))fail('Ruolo non valido.');
        if(await one(tx,'SELECT id FROM users WHERE tenant_id=$1 AND email=$2 AND id<>$3',[actor.tenantId,email,input.id]))fail('Email già presente in questa azienda.');
        after=await one(tx,'UPDATE users SET name=$3,email=$4,role=$5 WHERE tenant_id=$1 AND id=$2 RETURNING id,name,email,role,active',[actor.tenantId,input.id,name,email,input.role]);
        await tx.query('DELETE FROM sessions WHERE user_id=$1',[input.id]);
      } else if(input.mode==='reset-password') {
        if(!passwordHash)fail('Inserire una nuova password.');
        after=await one(tx,'UPDATE users SET password_hash=$3 WHERE tenant_id=$1 AND id=$2 RETURNING id,name,email,role,active',[actor.tenantId,input.id,passwordHash]);
        await tx.query('DELETE FROM sessions WHERE user_id=$1',[input.id]);
        await tx.query('DELETE FROM resets WHERE user_id=$1',[input.id]);
      } else {
        if(typeof input.active!=='boolean')fail('Stato utente non valido.');
        after=await one(tx,'UPDATE users SET active=$3 WHERE tenant_id=$1 AND id=$2 RETURNING id,name,email,role,active',[actor.tenantId,input.id,input.active]);
        await tx.query('DELETE FROM sessions WHERE user_id=$1',[input.id]);
      }
    } else {
      const email=required(input.email).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('Email non valida.');
      if(!['manager','operator'].includes(input.role))fail('Ruolo non valido.');
      if(!passwordHash)fail('Inserire una password iniziale.');
      if(await one(tx,'SELECT id FROM users WHERE tenant_id=$1 AND email=$2',[actor.tenantId,email]))fail('Email già presente in questa azienda.');
      after=await one(tx,'INSERT INTO users(id,tenant_id,name,email,role,password_hash,created) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,name,email,role,active',[randomUUID(),actor.tenantId,required(input.name),email,input.role,passwordHash,now()]);
    }
    await insert(tx,actor.tenantId,'audit',{date:now(),author:actor.name,authorId:actor.id,action:'user',clientId:null,interventionId:null,beforeValue:JSON.stringify(before),afterValue:JSON.stringify(after),reason:input.id?(input.mode==='update'?'Profilo account modificato':input.mode==='reset-password'?'Password account reimpostata':'Stato account modificato'):'Account creato'});
    return {ok:true,user:after,created:!before};
  });
}

export async function changePassword(store,actor,input) {
  const hash=await hashPassword(input.password);
  await store.transaction(async tx=>{
    const user=await one(tx,'SELECT * FROM users WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[actor.id,actor.homeTenantId||actor.tenantId]);
    if(!user||!await verify(input.currentPassword,user.password_hash))fail('Password attuale non corretta.');
    await tx.query('UPDATE users SET password_hash=$2 WHERE id=$1',[actor.id,hash]);
    await tx.query('DELETE FROM sessions WHERE user_id=$1',[actor.id]);
    await tx.query('DELETE FROM resets WHERE user_id=$1',[actor.id]);
  });
}

async function useResetRate(tx,key,limit,time=Date.now()){
  const windowMs=60*60*1000;
  let row=await one(tx,'SELECT * FROM password_reset_rate WHERE key=$1 FOR UPDATE',[key]);
  if(!row){
    await tx.query('INSERT INTO password_reset_rate(key,window_start,count) VALUES($1,$2,1)',[key,time]);
    return true;
  }
  const expired=time-Number(row.window_start)>=windowMs;
  const count=expired?1:Number(row.count)+1;
  await tx.query('UPDATE password_reset_rate SET window_start=$2,count=$3 WHERE key=$1',[key,expired?time:Number(row.window_start),count]);
  return count<=limit;
}

export async function requestPasswordReset(store,input,ip='') {
  const slug=String(input?.slug||'').trim().toLowerCase().slice(0,100);
  const email=String(input?.email||'').trim().toLowerCase().slice(0,300);
  const time=Date.now();
  return store.transaction(async tx=>{
    const ipAllowed=await useResetRate(tx,digest('reset-ip:'+String(ip||'')),20,time);
    const accountAllowed=await useResetRate(tx,digest('reset-account:'+slug+'\0'+email),3,time);
    if(!ipAllowed||!accountAllowed)return null;
    if(!/^[a-z0-9-]{3,50}$/.test(slug)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return null;
    const user=await one(tx,`SELECT u.id,u.tenant_id,u.email,u.name,t.name AS tenant_name,t.slug AS tenant_slug
      FROM users u JOIN tenants t ON t.id=u.tenant_id
      WHERE t.slug=$1 AND u.email=$2 AND u.active=true AND t.active=true
      FOR UPDATE OF u`,[slug,email]);
    if(!user)return null;
    const token=secret();
    await tx.query('DELETE FROM resets WHERE user_id=$1',[user.id]);
    await tx.query('INSERT INTO resets(token_hash,user_id,expires) VALUES($1,$2,$3)',[digest(token),user.id,time+30*60000]);
    return {token,tenantId:user.tenant_id,email:user.email,name:user.name,tenantName:user.tenant_name,slug:user.tenant_slug};
  });
}

export async function createReset(store,slug,email) {
  const token=secret();
  await store.transaction(async tx=>{
    const user=await one(tx,'SELECT u.* FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE t.slug=$1 AND u.email=$2 AND u.active=true FOR UPDATE OF u',[slug,email.toLowerCase()]);
    if(!user)fail('Account non trovato.');
    await tx.query('DELETE FROM resets WHERE user_id=$1',[user.id]);
    await tx.query('INSERT INTO resets VALUES($1,$2,$3)',[digest(token),user.id,Date.now()+30*60000]);
  });
  return token;
}

export async function resetPassword(store,input) {
  const hash=await hashPassword(input.password);
  await store.transaction(async tx=>{
    const reset=await one(tx,'SELECT * FROM resets WHERE token_hash=$1 AND expires>$2 FOR UPDATE',[digest(String(input.token||'')),Date.now()]);
    if(!reset)fail('Link scaduto o già utilizzato.');
    await tx.query('UPDATE users SET password_hash=$2 WHERE id=$1',[reset.user_id,hash]);
    await tx.query('DELETE FROM sessions WHERE user_id=$1',[reset.user_id]);
    await tx.query('DELETE FROM resets WHERE user_id=$1',[reset.user_id]);
  });
}
