import {randomBytes,randomUUID,createHash} from 'node:crypto';
import nodemailer from 'nodemailer';
import {one,rows,tenantTransaction} from './storage.mjs';
import {fail,required,integer,camel,insert} from './domain.mjs';
import {today} from './quotes.mjs';
import {quotePDF} from './quote-pdf.mjs';

const stamp=()=>new Date().toISOString();
const hash=value=>createHash('sha256').update(value).digest('hex');
const email=value=>typeof value==='string'&&value.length<=254&&/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(v/100);
const manager=actor=>{if(!['manager','platform_admin'].includes(actor.role))fail('Operazione riservata al responsabile.',403);};

export function mailConfig(env=process.env,origin='http://localhost:3000'){
 const mode=env.MAIL_MODE||'preview';if(!['preview','smtp'].includes(mode))throw Error('MAIL_MODE deve essere preview o smtp.');
 const publicOrigin=env.PUBLIC_APP_URL||origin;
 const url=new URL(publicOrigin);if(url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('PUBLIC_APP_URL deve contenere solo origine e porta.');
 if(mode==='smtp'){
  if(url.protocol!=='https:'||['localhost','127.0.0.1','::1','[::1]'].includes(url.hostname))throw Error('Per le email reali serve PUBLIC_APP_URL HTTPS pubblico.');
  if(!env.SMTP_HOST||!env.SMTP_USER||!env.SMTP_PASSWORD||!email(env.MAIL_FROM))throw Error('Configurazione SMTP incompleta.');
 }
 return {mode,publicOrigin:url.origin,from:env.MAIL_FROM||'demo@localhost.invalid',smtp:mode==='smtp'?{host:env.SMTP_HOST,port:Number(env.SMTP_PORT||587),secure:env.SMTP_PORT==='465',requireTLS:env.SMTP_PORT!=='465',auth:{user:env.SMTP_USER,pass:env.SMTP_PASSWORD},connectionTimeout:15000,greetingTimeout:15000,socketTimeout:30000}:null};
}
async function audit(tx,t,actor,action,q,before,after,reason){await insert(tx,t,'audit',{date:stamp(),author:actor.name,authorId:actor.id||null,action,clientId:q.clientId,interventionId:null,beforeValue:JSON.stringify(before),afterValue:JSON.stringify(after),reason});}
async function addMessage(tx,t,q,kind,config,recipient,subject,content){
 const id=randomUUID(),now=stamp();
 await tx.query('INSERT INTO mail_messages(tenant_id,id,quote_id,kind,mode,status,recipient,subject,content,created,updated) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)',[t,id,q.id,kind,config.mode,'queued',recipient,subject,JSON.stringify(content),now]);
 return id;
}

export async function queueQuote(store,actor,input,key,config){
 manager(actor);required(key,150);
 return tenantTransaction(store,actor.tenantId,async(tx,tenant)=>{
  if(!tenant.active)fail('Azienda sospesa.',403);
  const t=actor.tenantId,payload=JSON.stringify({action:'quote-email',input});
  const prior=await one(tx,'SELECT * FROM requests WHERE tenant_id=$1 AND user_id=$2 AND key=$3',[t,actor.id,key]);
  if(prior){if(prior.payload!==payload)fail('Identificativo richiesta già utilizzato.');return JSON.parse(prior.response);}
  const raw=await one(tx,'SELECT * FROM quotes WHERE tenant_id=$1 AND id=$2',[t,integer(input.id,1,1e9)]);if(!raw)fail('Preventivo non trovato.',404);
  const q=camel(raw);if(q.revision!==integer(input.revision,1,1e9))fail('Il preventivo è cambiato. Ricarica i dati.',409);
  if(!['draft','sent'].includes(q.status)||q.validUntil<today()||q.issueDate>today())fail('Il preventivo non è disponibile per l’invio: verifica stato, data e validità.');
  const client=await one(tx,'SELECT archived FROM clients WHERE tenant_id=$1 AND id=$2',[t,q.clientId]);if(client.archived)fail('Ripristina il cliente prima dell’invio.');
  if(await one(tx,"SELECT id FROM mail_messages WHERE tenant_id=$1 AND quote_id=$2 AND kind='quote' AND status<>'cancelled'",[t,q.id]))fail('Esiste già un invio per questo preventivo. Controlla Email e notifiche.');
  const recipient=String(q.document.client.email||'').trim();if(!email(recipient))fail('Aggiungi un’email valida al cliente e salva nuovamente la bozza prima di inviare.');
  const token=randomBytes(32).toString('base64url'),link=config.publicOrigin+'/#/risposta/'+token;
  const version={...q,revision:q.revision+1,status:'sent'};
  const pdf=(await quotePDF(version)).toString('base64');
  const subject=`${q.document.company.name} - Preventivo ${q.number}`;
  const text=`Buongiorno ${q.document.client.name},\n\nin allegato trovi il preventivo ${q.number}: ${q.document.title}.\nTotale: ${money(q.total)}. Valido fino al ${q.validUntil.split('-').reverse().join('/')}.\n\nPer consultarlo e accettare o rifiutare la proposta, con eventuali note, apri questo collegamento personale:\n${link}\n\nIl collegamento è riservato al destinatario e scade entro 30 giorni o alla scadenza del preventivo. Non inoltrarlo.\n\n${q.document.company.name}`;
  const html=`<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#163b43"><h2>${escape(q.document.company.name)}</h2><p>Buongiorno ${escape(q.document.client.name)},</p><p>in allegato il preventivo <b>${escape(q.number)}</b> per ${escape(q.document.title)}.</p><p>Totale: <b>${escape(money(q.total))}</b></p><p>Potrai accettare o rifiutare e aggiungere le tue note nella pagina riservata.</p><p><a href="${escape(link)}" style="display:inline-block;padding:14px 22px;background:#176653;color:white;text-decoration:none;border-radius:6px">Consulta il preventivo</a></p><p><a href="${escape(link)}?scelta=accepted" style="display:inline-block;padding:12px 18px;background:#176653;color:white;text-decoration:none;border-radius:6px;margin-right:10px">Accetta il preventivo</a> <a href="${escape(link)}?scelta=rejected" style="display:inline-block;padding:12px 18px;border:1px solid #163b43;color:#163b43;text-decoration:none;border-radius:6px">Rifiuta il preventivo</a></p><p>La scelta sarà registrata solo dopo la conferma nella pagina, dove potrai aggiungere le note.</p><p>Validità: ${escape(q.validUntil)}. Collegamento personale: non inoltrarlo.</p></div>`;
  const content={text,html,link,replyTo:email(tenant.email)?tenant.email:undefined,companyName:tenant.name,attachments:[{filename:q.number+'.pdf',content:pdf,encoding:'base64',contentType:'application/pdf'}]};
  const id=await addMessage(tx,t,q,'quote',config,recipient,subject,content);
  await tx.query('INSERT INTO quote_links(token_hash,tenant_id,quote_id,mail_id,expires) VALUES($1,$2,$3,$4,$5)',[hash(token),t,q.id,id,Date.now()+30*86400000]);
  await tx.query('UPDATE quotes SET revision=revision+1,updated=$3 WHERE tenant_id=$1 AND id=$2',[t,q.id,stamp()]);
  await audit(tx,t,actor,'quote-email',q,{status:q.status},{mailId:id,mode:config.mode,recipient},config.mode==='preview'?'Preparazione email simulata, nessun invio reale.':'Invio email richiesto.');
  const result={ok:true,mailId:id,mode:config.mode};
  await tx.query('INSERT INTO requests VALUES($1,$2,$3,$4,$5)',[t,actor.id,key,payload,JSON.stringify(result)]);
  return result;
 });
}

export async function mailState(store,actor,config){
 manager(actor);return tenantTransaction(store,actor.tenantId,async tx=>({mode:config.mode,publicOrigin:config.publicOrigin,from:config.from,
  messages:(await rows(tx,'SELECT id,quote_id,kind,mode,status,recipient,subject,created,updated,error FROM mail_messages WHERE tenant_id=$1 ORDER BY created DESC',[actor.tenantId])).map(camel),
  notifications:(await rows(tx,'SELECT * FROM notifications WHERE tenant_id=$1 ORDER BY created DESC',[actor.tenantId])).map(camel)
 }));
}
export async function messageDetail(store,actor,id){
 manager(actor);return tenantTransaction(store,actor.tenantId,async tx=>{
  const m=await one(tx,'SELECT * FROM mail_messages WHERE tenant_id=$1 AND id=$2',[actor.tenantId,id]);if(!m)fail('Email non trovata.',404);
  return {...camel(m),content:{text:m.content.text,link:m.content.link,attachments:m.content.attachments?.map(a=>({filename:a.filename}))||[]}};
 });
}
export async function messageEML(store,actor,id,config){
 manager(actor);const m=await tenantTransaction(store,actor.tenantId,tx=>one(tx,'SELECT * FROM mail_messages WHERE tenant_id=$1 AND id=$2',[actor.tenantId,id]));if(!m)fail('Email non trovata.',404);
 const result=await nodemailer.createTransport({streamTransport:true,buffer:true,newline:'windows'}).sendMail({...m.content,from:{name:m.content.companyName,address:config.from},to:m.recipient,subject:m.subject});return result.message;
}
export async function readNotification(store,actor,id){manager(actor);return tenantTransaction(store,actor.tenantId,async tx=>{const result=await one(tx,'UPDATE notifications SET read_at=coalesce(read_at,$3) WHERE tenant_id=$1 AND id=$2 RETURNING id',[actor.tenantId,id,stamp()]);if(!result)fail('Notifica non trovata.',404);return {ok:true};});}
export async function cancelAttempt(store,actor,input){
 manager(actor);required(input.reason,2000);
 return tenantTransaction(store,actor.tenantId,async tx=>{
  const t=actor.tenantId,m=await one(tx,'SELECT * FROM mail_messages WHERE tenant_id=$1 AND id=$2',[t,input.id]);
  if(!m)fail('Invio non trovato.',404);if(!['uncertain','queued'].includes(m.status))fail('Non è possibile chiudere questo tentativo.');
  await tx.query("UPDATE mail_messages SET status='cancelled',updated=$3 WHERE tenant_id=$1 AND id=$2",[t,m.id,stamp()]);
  await tx.query('UPDATE quote_links SET revoked=true WHERE tenant_id=$1 AND mail_id=$2',[t,m.id]);
  const q=camel(await one(tx,'SELECT * FROM quotes WHERE tenant_id=$1 AND id=$2',[t,m.quote_id]));
  await audit(tx,t,actor,'mail-cancel',q,{mailId:m.id,status:m.status},{status:'cancelled'},input.reason);return {ok:true};
 });
}

// Nessun retry SMTP automatico: un timeout può seguire una consegna riuscita.
// Le richieste rimangono persistenti; i tentativi interrotti vengono segnalati da verificare.
export async function dispatchOne(store,config,transportOverride){
 const candidate=await one(store,"SELECT m.tenant_id,m.id FROM mail_messages m JOIN tenants t ON t.id=m.tenant_id WHERE m.status='queued' AND t.active=true ORDER BY m.created LIMIT 1");
 if(!candidate)return false;
 const claimed=await tenantTransaction(store,candidate.tenant_id,async(tx,tenant)=>tenant.active?one(tx,"UPDATE mail_messages SET status='sending',updated=$3 WHERE tenant_id=$1 AND id=$2 AND status='queued' RETURNING *",[candidate.tenant_id,candidate.id,stamp()]):null);
 if(!claimed)return true;
 let success=false,error='';
 try{
  if(claimed.mode==='smtp'){
   if(config.mode!=='smtp')throw Error('Configurazione SMTP non attiva');
   const transport=transportOverride||nodemailer.createTransport(config.smtp);
   try{const result=await transport.sendMail({...claimed.content,from:{name:claimed.content.companyName,address:config.from},to:claimed.recipient,subject:claimed.subject,messageId:`<${claimed.id}@${config.from.split('@').pop()}>`});if(!result.accepted?.some(a=>String(a).toLowerCase()===claimed.recipient.toLowerCase()))throw Error('Destinatario non accettato');}finally{if(!transportOverride)transport.close();}
  }
  success=true;
 }catch{error='Invio non confermato. Verifica la casella del mittente prima di riprovare: l’email potrebbe essere stata consegnata.';}
 await tenantTransaction(store,claimed.tenant_id,async tx=>{
  const status=success?(claimed.mode==='preview'?'preview':'sent'):'uncertain';
  await tx.query('UPDATE mail_messages SET status=$3,error=$4,updated=$5 WHERE tenant_id=$1 AND id=$2',[claimed.tenant_id,claimed.id,status,error,stamp()]);
  if(success&&claimed.kind==='quote')await tx.query("UPDATE quotes SET status='sent',updated=$3 WHERE tenant_id=$1 AND id=$2 AND status IN ('draft','sent')",[claimed.tenant_id,claimed.quote_id,stamp()]);
 });return true;
}

async function linkRecord(store,token){
 if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))fail('Collegamento non valido o scaduto.',404);
 const link=await one(store,'SELECT l.* FROM quote_links l JOIN tenants t ON t.id=l.tenant_id WHERE l.token_hash=$1 AND t.active=true',[hash(token)]);
 if(!link||link.revoked||Number(link.expires)<Date.now())fail('Collegamento non valido o scaduto.',404);return link;
}
async function usableLink(tx,link){
 const row=await one(tx,'SELECT l.*,m.mode,m.status AS delivery_status FROM quote_links l JOIN mail_messages m ON m.tenant_id=l.tenant_id AND m.id=l.mail_id WHERE l.token_hash=$1',[link.token_hash]);
 if(!row||row.revoked||Number(row.expires)<Date.now()||!['sent','preview'].includes(row.delivery_status))fail('Collegamento non disponibile.',404);
 const q=camel(await one(tx,'SELECT * FROM quotes WHERE tenant_id=$1 AND id=$2',[link.tenant_id,link.quote_id]));
 if(q.status==='cancelled'||(!row.response&&q.status!=='sent'))fail('Il preventivo non è più disponibile per una risposta.',409);
 return {link:row,q};
}
export async function publicQuote(store,token){
 const link=await linkRecord(store,token);return tenantTransaction(store,link.tenant_id,async(tx,tenant)=>{
  if(!tenant.active)fail('Collegamento non disponibile.',404);
  const state=await usableLink(tx,link),q=state.q;
  return {number:q.number,status:q.status,validUntil:q.validUntil,total:q.total,net:q.net,tax:q.tax,title:q.document.title,lines:q.document.lines,terms:q.document.terms,notes:q.document.notes,company:Object.fromEntries(['name','address','email','phone','website','taxId','logoData','brandColor'].map(k=>[k,q.document.company[k]])),clientName:q.document.client.name,response:state.link.response,expired:q.validUntil<today(),mode:state.link.mode};
 });
}
export async function publicPDF(store,token){const link=await linkRecord(store,token);return tenantTransaction(store,link.tenant_id,async(tx,tenant)=>{if(!tenant.active)fail('Collegamento non disponibile.',404);const {link:active}=await usableLink(tx,link);const m=await one(tx,'SELECT content FROM mail_messages WHERE tenant_id=$1 AND id=$2',[link.tenant_id,active.mail_id]);return Buffer.from(m.content.attachments[0].content,'base64');});}
export async function respondQuote(store,token,input,config){
 const link=await linkRecord(store,token),name=required(input.name,150),notes=String(input.notes||'').trim();
 if(notes.length>2000||!['accepted','rejected'].includes(input.decision)||input.confirm!==true)fail('Conferma la scelta e inserisci note di massimo 2000 caratteri.');
 const response={name,notes,decision:input.decision};
 return tenantTransaction(store,link.tenant_id,async(tx,tenant)=>{
  if(!tenant.active)fail('Collegamento non disponibile.',404);
  const t=link.tenant_id,{link:current,q}=await usableLink(tx,link);
  if(current.response){if(JSON.stringify(current.response)!==JSON.stringify(response)&&!(current.response.name===name&&current.response.notes===notes&&current.response.decision===input.decision))fail('Una risposta è già stata registrata. Contatta l’impresa per modificarla.',409);return {ok:true,response:current.response};}
  if(q.validUntil<today())fail('Il preventivo è scaduto. Contatta l’impresa per una nuova proposta.',410);
  if((await one(tx,'SELECT archived FROM clients WHERE tenant_id=$1 AND id=$2',[t,q.clientId])).archived)fail('Il preventivo non è disponibile. Contatta l’impresa.',409);
  await tx.query('UPDATE quote_links SET response=$2,responded_at=$3 WHERE token_hash=$1',[link.token_hash,JSON.stringify(response),stamp()]);
  await tx.query('UPDATE quotes SET status=$3,revision=revision+1,updated=$4 WHERE tenant_id=$1 AND id=$2',[t,q.id,input.decision,stamp()]);
  const outcome=input.decision==='accepted'?'accettato':'rifiutato',title=`Preventivo ${q.number} ${outcome}`,body=`${name} ha ${outcome} il preventivo tramite collegamento email.${notes?'\nNote: '+notes:''}`;
  await tx.query('INSERT INTO notifications(tenant_id,id,quote_id,title,body,created) VALUES($1,$2,$3,$4,$5,$6)',[t,randomUUID(),q.id,title,body,stamp()]);
  await audit(tx,t,{name:`Cliente via link email: ${name}`},'quote-response',q,{status:q.status},{status:input.decision,...response},notes||'Risposta confermata dal collegamento personale.');
  // Il responsabile riceve un riepilogo, senza inoltrare il token del cliente.
  if(email(tenant.email))await addMessage(tx,t,q,'response',{...config,mode:current.mode},tenant.email,title,{text:body,html:`<p>${escape(body).replaceAll('\n','<br>')}</p>`,companyName:tenant.name});
  return {ok:true,response};
 });
}
