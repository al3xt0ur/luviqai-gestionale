import {randomUUID} from 'node:crypto';
import {one,rows} from './storage.mjs';
import {fail,required} from './domain.mjs';

const stamp=()=>new Date().toISOString();
const admin=actor=>{if(actor?.role!=='platform_admin')fail('Accesso riservato agli amministratori luviqAI.',403);};
const email=value=>{const v=String(value||'').trim().toLowerCase();if(v&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))fail('Email non valida.');return v;};
const dueDate=()=>{const d=new Date();const day=d.getUTCDate();d.setUTCMonth(d.getUTCMonth()+1);if(d.getUTCDate()!==day)d.setUTCDate(0);return d.toISOString();};
const statuses=new Set(['received','verified','preparing','ready','delivered','closed','rejected']);
const requestTypes=new Set(['access','export','rectification','erasure','restriction','objection']);

async function audit(store,actor,action,tenantId,details){
 await store.query('INSERT INTO platform_audit(id,date,author_id,author,action,tenant_id,details) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),stamp(),actor.id,actor.name,action,tenantId,JSON.stringify(details)]);
}

export async function privacyState(store,actor){
 admin(actor);
 return rows(store,`SELECT p.*,t.name AS company_name,t.slug AS company_slug
  FROM privacy_requests p JOIN tenants t ON t.id=p.tenant_id
  ORDER BY p.created DESC LIMIT 200`);
}

export async function privacySubjects(store,actor,companyId){
 admin(actor);
 const tenant=await one(store,'SELECT id,name FROM tenants WHERE id=$1 AND is_platform=false',[companyId]);
 if(!tenant)fail('Azienda non trovata.',404);
 const [clients,users]=await Promise.all([
  rows(store,'SELECT id,name,email,archived FROM clients WHERE tenant_id=$1 ORDER BY name LIMIT 500',[companyId]),
  rows(store,"SELECT id,name,email,role,active FROM users WHERE tenant_id=$1 AND role<>'platform_admin' ORDER BY name LIMIT 500",[companyId])
 ]);
 return {company:tenant,clients,users};
}

export async function createPrivacyRequest(store,actor,input){
 admin(actor);
 const tenant=await one(store,'SELECT id,name FROM tenants WHERE id=$1 AND is_platform=false',[input.tenantId]);
 if(!tenant)fail('Azienda non trovata.',404);
 const subjectType=input.subjectType==='user'?'user':input.subjectType==='client'?'client':null;if(!subjectType)fail('Tipo interessato non valido.');
 const subjectId=required(String(input.subjectId||''),100);
 const subject=subjectType==='client'
  ?await one(store,'SELECT id,name,email FROM clients WHERE tenant_id=$1 AND id=$2',[tenant.id,Number(subjectId)])
  :await one(store,"SELECT id,name,email FROM users WHERE tenant_id=$1 AND id=$2 AND role<>'platform_admin'",[tenant.id,subjectId]);
 if(!subject)fail('Interessato non trovato.',404);
 const requestType=String(input.requestType||'access');if(!requestTypes.has(requestType))fail('Tipo richiesta non valido.');
 const requesterName=required(input.requesterName||subject.name,200),requesterEmail=email(input.requesterEmail||subject.email);
 const notes=String(input.notes||'').trim();if(notes.length>3000)fail('Note troppo lunghe.');
 const id=randomUUID(),created=stamp();
 await store.query(`INSERT INTO privacy_requests(id,created,updated,tenant_id,subject_type,subject_id,subject_name,subject_email,requester_name,requester_email,request_type,status,due_at,notes,created_by)
  VALUES($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,$10,'received',$11,$12,$13)`,
  [id,created,tenant.id,subjectType,String(subject.id),subject.name,subject.email||'',requesterName,requesterEmail,requestType,dueDate(),notes,actor.id]);
 await audit(store,actor,'privacy_request_create',tenant.id,{id,subjectType,subjectId:String(subject.id),requestType});
 return {ok:true,id};
}

export async function updatePrivacyRequest(store,actor,input){
 admin(actor);const status=String(input.status||'');if(!statuses.has(status))fail('Stato richiesta non valido.');
 const current=await one(store,'SELECT * FROM privacy_requests WHERE id=$1',[input.id]);if(!current)fail('Richiesta privacy non trovata.',404);
 const notes=String(input.notes??current.notes??'').trim();if(notes.length>3000)fail('Note troppo lunghe.');
 const delivered=status==='delivered'||status==='closed'?(current.delivered_at||stamp()):current.delivered_at;
 await store.query('UPDATE privacy_requests SET status=$2,notes=$3,updated=$4,delivered_at=$5 WHERE id=$1',[current.id,status,notes,stamp(),delivered]);
 await audit(store,actor,'privacy_request_status',current.tenant_id,{id:current.id,before:current.status,after:status});
 return {ok:true};
}

const cleanMail=m=>({id:m.id,kind:m.kind,status:m.status,recipient:m.recipient,subject:m.subject,created:m.created,updated:m.updated,error:m.error||'',text:m.content?.text||'',attachments:(m.content?.attachments||[]).map(a=>a.filename)});
const cleanAudit=a=>({id:a.id,date:a.date,action:a.action,clientId:a.client_id,interventionId:a.intervention_id});

export async function privacyExport(store,actor,id){
 admin(actor);
 const request=await one(store,`SELECT p.*,t.name AS company_name,t.slug AS company_slug FROM privacy_requests p JOIN tenants t ON t.id=p.tenant_id WHERE p.id=$1`,[id]);
 if(!request)fail('Richiesta privacy non trovata.',404);
 if(!['verified','preparing','ready','delivered','closed'].includes(request.status))fail('Verifica prima l’identità del richiedente e assicurati che la richiesta sia gestibile.',409);
 const t=request.tenant_id;let subject,data;
 if(request.subject_type==='client'){
  subject=await one(store,'SELECT id,name,email,phone,address,archived FROM clients WHERE tenant_id=$1 AND id=$2',[t,Number(request.subject_id)]);
  if(!subject)fail('Interessato non più disponibile.',404);
  const [packages,interventions,quotes,invoices,auditRows,mails,notifications]=await Promise.all([
   rows(store,'SELECT * FROM packages WHERE tenant_id=$1 AND client_id=$2 ORDER BY id',[t,subject.id]),
   rows(store,`SELECT i.id,i.package_id,i.job_id,i.date,i.service,i.duration,i.operators,i.notes,i.status FROM interventions i LEFT JOIN packages p ON p.tenant_id=i.tenant_id AND p.id=i.package_id LEFT JOIN jobs j ON j.tenant_id=i.tenant_id AND j.id=i.job_id WHERE i.tenant_id=$1 AND coalesce(p.client_id,j.client_id)=$2 ORDER BY i.date,i.id`,[t,subject.id]),
   rows(store,'SELECT * FROM quotes WHERE tenant_id=$1 AND client_id=$2 ORDER BY id',[t,subject.id]),
   rows(store,'SELECT * FROM invoices WHERE tenant_id=$1 AND client_id=$2 ORDER BY id',[t,subject.id]),
   rows(store,'SELECT * FROM audit WHERE tenant_id=$1 AND client_id=$2 ORDER BY id',[t,subject.id]),
   rows(store,`SELECT * FROM mail_messages WHERE tenant_id=$1 AND (lower(recipient)=lower($2) OR quote_id IN (SELECT id FROM quotes WHERE tenant_id=$1 AND client_id=$3) OR invoice_id IN (SELECT id FROM invoices WHERE tenant_id=$1 AND client_id=$3)) ORDER BY created`,[t,subject.email||'',subject.id]),
   rows(store,'SELECT * FROM notifications WHERE tenant_id=$1 AND quote_id IN (SELECT id FROM quotes WHERE tenant_id=$1 AND client_id=$2) ORDER BY created',[t,subject.id])
  ]);
  data={profile:subject,packages,interventions,quotes,invoices,audit:auditRows.map(cleanAudit),emails:mails.map(cleanMail),notifications};
 }else{
  subject=await one(store,"SELECT id,name,email,role,active,created FROM users WHERE tenant_id=$1 AND id=$2 AND role<>'platform_admin'",[t,request.subject_id]);
  if(!subject)fail('Interessato non più disponibile.',404);
  const [assigned,auditRows,technical,mails]=await Promise.all([
   rows(store,'SELECT id,date,duration,operators,status FROM interventions WHERE tenant_id=$1 AND assigned_user_id=$2 ORDER BY date,id',[t,subject.id]),
   rows(store,'SELECT * FROM audit WHERE tenant_id=$1 AND author_id=$2 ORDER BY id',[t,subject.id]),
   rows(store,'SELECT date,method,path,status,duration_ms,error FROM technical_log WHERE tenant_id=$1 AND user_id=$2 ORDER BY date DESC LIMIT 5000',[t,subject.id]),
   rows(store,'SELECT * FROM mail_messages WHERE tenant_id=$1 AND lower(recipient)=lower($2) ORDER BY created',[t,subject.email||''])
  ]);
  data={profile:subject,assignedInterventions:assigned,audit:auditRows.map(cleanAudit),technicalLog:technical,emails:mails.map(cleanMail)};
 }
 const generatedAt=stamp();
 await store.query('UPDATE privacy_requests SET export_generated_at=$2,updated=$2 WHERE id=$1',[request.id,generatedAt]);
 await audit(store,actor,'privacy_export_generate',t,{id:request.id,subjectType:request.subject_type,subjectId:request.subject_id});
 return {
  exportVersion:1,generatedAt,reviewRequired:true,
  notice:'Verificare il contenuto prima della consegna per evitare la divulgazione di dati riferiti a terzi.',
  request:{id:request.id,company:{id:t,name:request.company_name,slug:request.company_slug},type:request.request_type,status:request.status,created:request.created,dueAt:request.due_at},
  subject:{type:request.subject_type,id:request.subject_id,name:request.subject_name,email:request.subject_email},
  data
 };
}
