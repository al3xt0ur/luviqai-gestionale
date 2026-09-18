import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
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
export const publicUser=u=>({id:u.id,tenantId:u.active_tenant_id||u.tenant_id,homeTenantId:u.tenant_id,name:u.name,email:u.email,role:u.role});

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
    const token=secret(),csrf=secret();
    await tx.query('DELETE FROM sessions WHERE expires<$1',[time]);
    await tx.query('INSERT INTO sessions(token_hash,user_id,csrf,expires) VALUES($1,$2,$3,$4)',[digest(token),user.id,csrf,time+8*3600000]);
    return {token,csrf,user:publicUser(user)};
  });
  if(result.error)fail(result.error,result.status);
  return result;
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
        if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email))fail('Email non valida.');
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
