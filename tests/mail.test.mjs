import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {connectStore,migrate,tenantTransaction,rows} from '../server/storage.mjs';
import {provision} from '../server/auth.mjs';
import {mutate,snapshot} from '../server/domain.mjs';
import {mailConfig,queueQuote,dispatchOne,mailState,messageDetail,messageEML,publicQuote,publicPDF,respondQuote,readNotification,cancelAttempt} from '../server/mail.mjs';
import {backupStore,restoreStore} from '../server/backup.mjs';
import {today} from '../server/quotes.mjs';

test('configurazione email: nessun invio reale senza SMTP e URL pubblico',()=>{
 assert.equal(mailConfig({}).mode,'preview');
 assert.throws(()=>mailConfig({MAIL_MODE:'smtp'}),/HTTPS/);
 assert.throws(()=>mailConfig({MAIL_MODE:'smtp',PUBLIC_APP_URL:'https://app.example.com'}),/incompleta/);
 assert.throws(()=>mailConfig({PUBLIC_APP_URL:'https://app.example.com/#token'}),/origine/);
});
test('email e risposte: duplicati, isolamento, validità, notifiche e ripristino',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'luviq-mail-'));let db=await connectStore({path:join(dir,'pg')});
 const config=mailConfig({});
 try{
  await migrate(db);
  const a=await provision(db,{slug:'posta-a',name:'Impresa A',email:'a@example.com',password:'Password-posta-2026!'}),b=await provision(db,{slug:'posta-b',name:'Impresa B',email:'b@example.com',password:'Password-posta-2026!'});
  const run=(action,input)=>mutate(db,a,action,input,crypto.randomUUID());
  await run('company',{name:'Impresa A',logoText:'IA',brandColor:'#176653',email:'responsabile@example.com'});
  const c=(await run('client',{name:'Cliente email',email:'cliente@example.com'})).value;
  const make=async()=> (await run('quote',{clientId:c.id,title:'Proposta email',issueDate:today(),validUntil:'2099-12-31',lines:[{description:'Servizio',quantity:100,unitPrice:10000,vat:2200}]})).value;
  let q=await make(),message,token;
  await t.test('coda idempotente, allegato autentico, nessuna risposta tramite GET',async()=>{
   const values=await Promise.all(Array.from({length:8},()=>queueQuote(db,a,{id:q.id,revision:1},'email-key',config)));message=values[0].mailId;
   assert(values.every(x=>x.mailId===message));assert.equal((await mailState(db,a,config)).messages.length,1);
   await assert.rejects(run('quote-status',{id:q.id,revision:2,status:'sent',reason:'Salto'}),/in corso/);
   await assert.rejects(queueQuote(db,a,{id:q.id,revision:2},'different-key',config),/già un invio/);
   const detail=await messageDetail(db,a,message);token=detail.content.link.split('/').pop();assert.equal(detail.content.attachments.length,1);
   assert(!JSON.stringify(await snapshot(db,a)).includes(token));assert(!JSON.stringify(await mailState(db,a,config)).includes(token));
   await assert.rejects(publicQuote(db,token),/non disponibile/);
   let sends=0;await dispatchOne(db,config,{sendMail(){sends++}});assert.equal(sends,0);
   assert.equal((await mailState(db,a,config)).messages[0].status,'preview');
   await publicQuote(db,token);await publicQuote(db,token);assert.equal((await snapshot(db,a)).quotes[0].status,'sent');
   const pdf=await publicPDF(db,token);assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
   const eml=await messageEML(db,a,message,config);assert(eml.toString().includes('application/pdf'));assert(eml.toString().includes('text/html'));
  });
  await t.test('risposte concorrenti, conferma obbligatoria e una sola notifica',async()=>{
   await assert.rejects(respondQuote(db,token,{name:'Cliente',decision:'accepted',notes:''},config),/Conferma/);
   const input={name:'Cliente',decision:'accepted',notes:'Concordiamo il prossimo lunedì',confirm:true};
   const all=await Promise.all(Array.from({length:10},()=>respondQuote(db,token,input,config)));assert(all.every(r=>r.ok));
   const state=await snapshot(db,a);assert.equal(state.quotes[0].status,'accepted');assert.equal(state.unreadNotifications,1);assert.equal(state.audit.filter(x=>x.action==='quote-response').length,1);
   await assert.rejects(respondQuote(db,token,{...input,decision:'rejected'},config),/già stata/);
   const mail=await mailState(db,a,config);assert.equal(mail.messages.filter(m=>m.kind==='response').length,1);assert(mail.notifications[0].body.includes(input.notes));
   await readNotification(db,a,mail.notifications[0].id);await readNotification(db,a,mail.notifications[0].id);assert.equal((await snapshot(db,a)).unreadNotifications,0);
   await dispatchOne(db,config);assert.equal((await mailState(db,a,config)).messages.filter(m=>m.status==='preview').length,2);
  });
  await t.test('isolamento e revoca: operatori, altre imprese, link scaduti e preventivi annullati',async()=>{
   assert.equal((await mailState(db,b,config)).messages.length,0);
   await assert.rejects(messageDetail(db,b,message),/non trovata/);
   await assert.rejects(mailState(db,{...a,role:'operator'},config),/responsabile/);
   await tenantTransaction(db,b.tenantId,async tx=>{assert.equal((await rows(tx,'SELECT * FROM quote_links')).length,0);assert.equal((await rows(tx,'SELECT * FROM notifications')).length,0);});
   await assert.rejects(publicQuote(db,'not-a-token'),/non valido/);
   const cancelled=await make();const m=await queueQuote(db,a,{id:cancelled.id,revision:1},'cancel-email',config);await dispatchOne(db,config);
   const link=(await messageDetail(db,a,m.mailId)).content.link.split('/').pop();await run('quote-status',{id:cancelled.id,revision:2,status:'cancelled',reason:'Proposta ritirata'});await assert.rejects(publicQuote(db,link),/non è più/);
   const expired=await make();const e=await queueQuote(db,a,{id:expired.id,revision:1},'expired-email',config);await dispatchOne(db,config);const eToken=(await messageDetail(db,a,e.mailId)).content.link.split('/').pop();
   await db.query("UPDATE quotes SET valid_until='2000-01-01' WHERE tenant_id=$1 AND id=$2",[a.tenantId,expired.id]);assert((await publicQuote(db,eToken)).expired);await assert.rejects(respondQuote(db,eToken,{name:'Cliente',decision:'accepted',confirm:true},config),/scaduto/);
  });
  await t.test('errore SMTP incerto senza retry automatico e chiusura motivata',async()=>{
   const smtp={...config,mode:'smtp',from:'a@example.com',smtp:{}};const next=await make();const m=await queueQuote(db,a,{id:next.id,revision:1},'smtp-key',smtp);
   let sends=0;await dispatchOne(db,smtp,{async sendMail(){sends++;throw Error('timeout con dati riservati');}});
   assert.equal((await mailState(db,a,config)).messages.find(x=>x.id===m.mailId).status,'uncertain');assert.equal(await dispatchOne(db,smtp),false);assert.equal(sends,1);
   await cancelAttempt(db,a,{id:m.mailId,reason:'Verificata la casella mittente'});const detail=await messageDetail(db,a,m.mailId);await assert.rejects(publicQuote(db,detail.content.link.split('/').pop()),/non valido/);
   assert(!JSON.stringify(await mailState(db,a,config)).includes('dati riservati'));
  });
  await t.test('trasporto SMTP accettato una sola volta e rifiuto cliente con note',async()=>{
   const smtp={...config,mode:'smtp',from:'a@example.com',smtp:{}},next=await make();
   const m=await queueQuote(db,a,{id:next.id,revision:1},'smtp-success',smtp);
   let calls=0;const transport={async sendMail(content){calls++;assert.equal(content.to,'cliente@example.com');assert.equal(content.attachments.length,1);assert(content.html.includes('scelta=rejected'));return {accepted:['cliente@example.com']};}};
   await Promise.all([dispatchOne(db,smtp,transport),dispatchOne(db,smtp,transport)]);assert.equal(calls,1);
   const mToken=(await messageDetail(db,a,m.mailId)).content.link.split('/').pop();
   assert.equal((await publicQuote(db,mToken)).mode,'smtp');
   await respondQuote(db,mToken,{name:'Cliente',decision:'rejected',notes:'Tempistiche non compatibili',confirm:true},smtp);
   assert.equal((await snapshot(db,a)).quotes.find(x=>x.id===next.id).status,'rejected');
   // Consuma solo il riepilogo tramite trasporto di prova, senza rete.
   await dispatchOne(db,smtp,{async sendMail(content){assert.equal(content.to,'responsabile@example.com');return {accepted:[content.to]};}});
  });
  await t.test('backup e riavvio conservano risposta; il ripristino non spedisce email pendenti',async()=>{
   const pending=await make();await queueQuote(db,a,{id:pending.id,revision:1},'pending-email',config);
   const file=join(dir,'backup.json');await backupStore(db,file);const target=await connectStore();try{await migrate(target);await restoreStore(target,file);assert.equal(await dispatchOne(target,config),false);assert.equal((await publicQuote(target,token)).response.decision,'accepted');}finally{await target.close();}
   await db.close();db=await connectStore({path:join(dir,'pg')});await migrate(db);assert.equal((await publicQuote(db,token)).response.decision,'accepted');
  });
 }finally{await db.close();assert.equal(resolve(dir,'..'),resolve(tmpdir()));await rm(dir,{recursive:true,force:true});}
});
