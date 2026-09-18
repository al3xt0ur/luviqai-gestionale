import {randomUUID} from 'node:crypto';
import {one,rows} from './storage.mjs';
import {hashPassword,secret,publicUser} from './auth.mjs';
import {fail,required} from './domain.mjs';

export const requireAdmin=actor=>{if(actor?.role!=='platform_admin')fail('Accesso riservato agli amministratori luviqAI.',403);};
const timestamp=()=>new Date().toISOString();
const emailValue=value=>{const email=required(value).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('Email non valida.');return email;};
async function log(tx,actor,action,tenantId,details){await tx.query('INSERT INTO platform_audit(id,date,author_id,author,action,tenant_id,details) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),timestamp(),actor.id,actor.name,action,tenantId,JSON.stringify(details)]);}

export async function provisionAdmins(store,accounts) {
  if(accounts.length!==2)fail('Fornire i due amministratori iniziali.');
  const prepared=await Promise.all(accounts.map(async a=>({name:required(a.name),email:emailValue(a.email),hash:await hashPassword(a.password)})));
  return store.transaction(async tx=>{
    await tx.query('SELECT pg_advisory_xact_lock(736282)');
    if(await one(tx,"SELECT id FROM users WHERE role='platform_admin' LIMIT 1"))fail('Amministratori già configurati.');
    if(await one(tx,"SELECT id FROM tenants WHERE slug='luviqai'"))fail('Codice luviqai già occupato.');
    const tenantId=randomUUID(),result=[];
    await tx.query('INSERT INTO tenants(id,slug,name,created,is_platform) VALUES($1,$2,$3,$4,true)',[tenantId,'luviqai','luviqAI · Amministrazione',timestamp()]);
    for(const account of prepared){
      const user=await one(tx,"INSERT INTO users(id,tenant_id,email,name,role,password_hash,created) VALUES($1,$2,$3,$4,'platform_admin',$5,$6) RETURNING *",[randomUUID(),tenantId,account.email,account.name,account.hash,timestamp()]);
      result.push(publicUser(user));
    }
    await log(tx,result[0],'admin_setup',tenantId,{administrators:result.map(u=>({id:u.id,name:u.name,email:u.email}))});
    return result;
  });
}

export async function platformState(store,actor) {
  requireAdmin(actor);
  return {
    companies:await rows(store,`SELECT t.id,t.slug,t.name,t.active,t.created,
      (SELECT count(*)::integer FROM users u WHERE u.tenant_id=t.id) AS users,
      (SELECT count(*)::integer FROM clients c WHERE c.tenant_id=t.id) AS clients
      FROM tenants t WHERE is_platform=false ORDER BY name`),
    administrators:await rows(store,"SELECT id,name,email,active FROM users WHERE role='platform_admin' ORDER BY created,id"),
    audit:await rows(store,'SELECT * FROM platform_audit ORDER BY date DESC,id DESC LIMIT 200'),
  };
}

export async function switchCompany(store,actor,input) {
  requireAdmin(actor);
  return store.transaction(async tx=>{
    const session=await one(tx,'SELECT * FROM sessions WHERE token_hash=$1 AND csrf=$2 AND user_id=$3 FOR UPDATE',[actor.tokenHash,actor.csrf,actor.id]);
    if(!session)fail('La sessione è cambiata. Ricarica la pagina.',409);
    const target=input.id?await one(tx,'SELECT * FROM tenants WHERE id=$1 AND is_platform=false',[input.id]):null;
    if(input.id&&!target)fail('Azienda non trovata.',404);
    const csrf=secret();
    await tx.query('UPDATE sessions SET active_tenant_id=$2,csrf=$3 WHERE token_hash=$1',[actor.tokenHash,target?.id||null,csrf]);
    await log(tx,actor,target?'company_enter':'company_leave',target?.id||null,{company:target?.name||null});
    return {user:{id:actor.id,tenantId:target?.id||actor.homeTenantId,homeTenantId:actor.homeTenantId,name:actor.name,email:actor.email,role:actor.role},csrf};
  });
}

export async function createCompany(store,actor,input,key) {
  requireAdmin(actor);required(key,150);
  const slug=required(input.slug,50).toLowerCase();if(!/^[a-z0-9-]{3,50}$/.test(slug)||slug==='luviqai')fail('Codice azienda non valido.');
  const name=required(input.name),email=emailValue(input.email),userName=required(input.userName);
  const hash=await hashPassword(input.password);
  return store.transaction(async tx=>{
    await tx.query('SELECT pg_advisory_xact_lock(736282)');
    // Non si memorizzano password nella cache di idempotenza o nello storico.
    if(await one(tx,'SELECT id FROM tenants WHERE slug=$1',[slug]))fail('Codice azienda già presente.');
    const tenantId=randomUUID();
    await tx.query('INSERT INTO tenants(id,slug,name,created) VALUES($1,$2,$3,$4)',[tenantId,slug,name,timestamp()]);
    const user=await one(tx,"INSERT INTO users(id,tenant_id,email,name,role,password_hash,created) VALUES($1,$2,$3,$4,'manager',$5,$6) RETURNING id,name,email,role,active",[randomUUID(),tenantId,email,userName,hash,timestamp()]);
    await log(tx,actor,'company_create',tenantId,{name,slug,email,userName});
    return {ok:true,tenantId,user};
  });
}

export async function suspendCompany(store,actor,input) {
  requireAdmin(actor);if(typeof input.active!=='boolean')fail('Stato non valido.');const reason=required(input.reason,2000);
  return store.transaction(async tx=>{
    const target=await one(tx,'SELECT * FROM tenants WHERE id=$1 AND is_platform=false FOR UPDATE',[input.id]);if(!target)fail('Azienda non trovata.',404);
    await tx.query('UPDATE tenants SET active=$2 WHERE id=$1',[target.id,input.active]);
    if(!input.active)await tx.query('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE tenant_id=$1)',[target.id]);
    await log(tx,actor,input.active?'company_activate':'company_suspend',target.id,{name:target.name,before:target.active,after:input.active,reason});
    return {ok:true};
  });
}

export async function adminProfile(store,actor,input) {
  requireAdmin(actor);const name=required(input.name),email=emailValue(input.email);
  return store.transaction(async tx=>{
    const before=await one(tx,"SELECT id,name,email FROM users WHERE id=$1 AND role='platform_admin' FOR UPDATE",[actor.id]);
    if(await one(tx,'SELECT id FROM users WHERE tenant_id=$1 AND email=$2 AND id<>$3',[actor.homeTenantId,email,actor.id]))fail('Email già utilizzata.');
    await tx.query('UPDATE users SET name=$2,email=$3 WHERE id=$1',[actor.id,name,email]);
    await log(tx,actor,'admin_profile',null,{before,after:{id:actor.id,name,email}});
    return {ok:true};
  });
}

export async function resetCompanyUser(store,actor,input) {
  requireAdmin(actor);const reason=required(input.reason,2000),hash=await hashPassword(input.password);
  return store.transaction(async tx=>{
    const user=await one(tx,"SELECT id,name,email FROM users WHERE id=$1 AND tenant_id=$2 AND role<>'platform_admin' FOR UPDATE",[input.id,input.companyId]);
    if(!user)fail('Utente aziendale non trovato.',404);
    await tx.query('UPDATE users SET password_hash=$2 WHERE id=$1',[user.id,hash]);
    await tx.query('DELETE FROM sessions WHERE user_id=$1',[user.id]);await tx.query('DELETE FROM resets WHERE user_id=$1',[user.id]);
    await log(tx,actor,'user_password_reset',input.companyId,{user,reason});return {ok:true};
  });
}
