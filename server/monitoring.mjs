import {randomUUID} from 'node:crypto';
import {one,rows} from './storage.mjs';
import {fail} from './domain.mjs';

let lastPrune=0;
const now=()=>new Date().toISOString();
const normalizePath=value=>String(value||'')
  .replace(/\/api\/public\/quotes\/[A-Za-z0-9_-]{20,}/g,'/api/public/quotes/:token')
  .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,':id')
  .replace(/\/(\d+)(?=\/|$)/g,'/:id')
  .slice(0,300);

export async function recordTechnicalLog(store,event){
 try{
  const date=now();
  await store.query(
   'INSERT INTO technical_log(id,date,method,path,status,duration_ms,tenant_id,user_id,error) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
   [randomUUID(),date,String(event.method||'GET').slice(0,12),normalizePath(event.path),Number(event.status)||0,Math.max(0,Number(event.durationMs)||0),event.tenantId||null,event.userId||null,String(event.error||'').slice(0,1000)]
  );
  if(Date.now()-lastPrune>3600000){
   lastPrune=Date.now();
   const cutoff=new Date(Date.now()-14*86400000).toISOString();
   void store.query('DELETE FROM technical_log WHERE date<$1',[cutoff]).catch(()=>{});
  }
 }catch(error){console.error('Datalog tecnico non riuscito:',error.code||error.name);}
}

export async function platformMonitoring(store,actor,{mail,storeKind}={}){
 if(actor.role!=='platform_admin')fail('Operazione riservata all’amministratore della piattaforma.',403);
 const since24=new Date(Date.now()-86400000).toISOString(),sinceHour=new Date(Date.now()-3600000).toISOString();
 const [db,companies,sessions,requests,mailStats,recentErrors,endpoints]=await Promise.all([
  one(store,'SELECT 1 AS ok'),
  one(store,'SELECT count(*)::int AS total,count(*) FILTER (WHERE active=true)::int AS active FROM tenants WHERE is_platform=false'),
  one(store,'SELECT count(*)::int AS active FROM sessions WHERE expires>$1',[Date.now()]),
  one(store,"SELECT count(*)::int AS total, count(*) FILTER (WHERE status>=500)::int AS errors, count(*) FILTER (WHERE date>=$2)::int AS last_hour, coalesce(round(avg(duration_ms))::int,0) AS avg_ms, coalesce(max(duration_ms),0)::int AS max_ms FROM technical_log WHERE date>=$1",[since24,sinceHour]),
  one(store,"SELECT count(*)::int AS total, count(*) FILTER (WHERE status='sent')::int AS sent, count(*) FILTER (WHERE status='uncertain')::int AS uncertain, count(*) FILTER (WHERE status='queued')::int AS queued FROM mail_messages WHERE created>=$1",[since24]),
  rows(store,"SELECT date,method,path,status,duration_ms,error FROM technical_log WHERE date>=$1 AND (status>=500 OR error<>'') ORDER BY date DESC LIMIT 20",[since24]),
  rows(store,"SELECT path,count(*)::int AS calls, count(*) FILTER (WHERE status>=500)::int AS errors, coalesce(round(avg(duration_ms))::int,0) AS avg_ms FROM technical_log WHERE date>=$1 GROUP BY path ORDER BY calls DESC LIMIT 10",[since24])
 ]);
 return {
  checkedAt:now(),
  uptimeSeconds:Math.floor(process.uptime()),
  database:{ok:db?.ok===1,kind:storeKind||'PostgreSQL'},
  email:{ok:['resend','smtp','preview'].includes(mail?.mode),mode:mail?.mode||'unknown',from:mail?.from||''},
  companies,
  sessions,
  requests,
  mail24h:mailStats,
  recentErrors:recentErrors.map(r=>({date:r.date,method:r.method,path:r.path,status:Number(r.status),durationMs:Number(r.duration_ms),error:r.error})),
  endpoints:endpoints.map(r=>({path:r.path,calls:Number(r.calls),errors:Number(r.errors),avgMs:Number(r.avg_ms)}))
 };
}
