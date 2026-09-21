import {mailConfig,queueQuote,queueInvoice,queueAccountWelcome,mailState,mailSettings as getMailSettings,saveMailSettings,queueMailTest,platformMailState,queuePlatformMail,messageDetail,messageEML,readNotification,cancelAttempt,dispatchOne,publicQuote,publicPDF,respondQuote} from './mail.mjs';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectStore, migrate } from './storage.mjs';
import { snapshot, mutate, fail } from './domain.mjs';
import { authenticate, login, team, manageUser, changePassword, resetPassword } from './auth.mjs';
import { bootstrapLocal } from './bootstrap.mjs';
import { backupStore } from './backup.mjs';
import {requireAdmin,platformState,switchCompany,createCompany,suspendCompany,adminProfile,resetCompanyUser} from './platform.mjs';
import {quotePDF} from './quote-pdf.mjs';
import {invoicePDF} from './invoice-pdf.mjs';
import {createAssistant} from './ai.mjs';
import {recordTechnicalLog,platformMonitoring} from './monitoring.mjs';
import {privacyState,privacySubjects,createPrivacyRequest,updatePrivacyRequest,privacyExport} from './privacy.mjs';
const assistant=createAssistant();

const root=fileURLToPath(new URL('../',import.meta.url));
const production=process.env.NODE_ENV==='production';
const port=Number(process.env.PORT||3000);
const origin=process.env.APP_ORIGIN||`http://localhost:${port}`;
if(production&&(!process.env.DATABASE_URL||!origin.startsWith('https://')))throw Error('In produzione sono obbligatori DATABASE_URL e APP_ORIGIN HTTPS.');
const dataDir=resolve(root,'data');
const store=await connectStore({url:process.env.DATABASE_URL,path:process.env.PGLITE_PATH||resolve(dataDir,'postgres')});
await migrate(store);
const mailSettings=mailConfig(process.env,origin);
let mailWorking=false;
async function mailTick(){if(mailWorking)return;mailWorking=true;try{await store.query("UPDATE mail_messages SET status='uncertain',error='Invio interrotto: verificare la casella del mittente.' WHERE status='sending' AND updated<$1",[new Date(Date.now()-120000).toISOString()]);for(let n=0;n<5&&await dispatchOne(store,mailSettings);n++);}catch(error){console.error('Elaborazione email non riuscita:',error.code||error.name);}finally{mailWorking=false;}}
const mailTimer=setInterval(()=>void mailTick(),2000);mailTimer.unref();
if(!production&&!process.env.DATABASE_URL&&process.env.BOOTSTRAP_DEMO!=='0')await bootstrapLocal(store,dataDir,resolve(dataDir,'myclean.sqlite'));
let backupTimer;
if(process.env.BOOTSTRAP_DEMO!=='0') {
  const backup=()=>backupStore(store,resolve(dataDir,'backups',`backup-${new Date().toISOString().replace(/[:.]/g,'-')}.json`)).catch(error=>console.error('Backup non riuscito:',error.code||error.name));
  await backup();backupTimer=setInterval(backup,24*3600000);backupTimer.unref();
}
const allowedOrigins=new Set([origin,...(!production?[`http://127.0.0.1:${port}`,`http://localhost:${port}`]:[])]);
const allowedHosts=new Set([...allowedOrigins].map(o=>new URL(o).host));
const cookie=(token,clear=false)=>`luviq_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${clear?0:28800}${production?'; Secure':''}`;

const server=createServer(async(req,res)=>{
  const requestStarted=Date.now();let requestPath='';let requestActor=null;let requestError='';
  res.on('finish',()=>{if(requestPath.startsWith('/api/')&&requestPath!=='/api/health')void recordTechnicalLog(store,{method:req.method,path:requestPath,status:res.statusCode,durationMs:Date.now()-requestStarted,tenantId:requestActor?.tenantId,userId:requestActor?.id,error:requestError});});
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  try {
    if(!allowedHosts.has(req.headers.host))return send(403,{error:'Host non consentito.'});
    const url=new URL(req.url,origin);requestPath=url.pathname;
    if(req.method==='GET'&&url.pathname==='/api/health')return send(200,{ok:true});
    let input;
    if(req.method==='POST') {
      if(req.headers.origin&&!allowedOrigins.has(req.headers.origin))fail('Origine non consentita.',403);
      if(req.headers['sec-fetch-site']==='cross-site')fail('Origine non consentita.',403);
      if(!req.headers['content-type']?.startsWith('application/json'))fail('Formato richiesta non valido.',415);
      let body='';
      for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>(url.pathname==='/api/company'?800000:100000))fail('Richiesta troppo grande.',413);}
      try {input=JSON.parse(body);}catch{fail('Richiesta non valida.');}
      if(!input||Array.isArray(input)||typeof input!=='object')fail('Richiesta non valida.');
    }
    if(req.method==='POST'&&url.pathname==='/api/login') {
      const result=await login(store,input,req.socket.remoteAddress);
      res.setHeader('Set-Cookie',cookie(result.token));
      return send(200,{user:result.user,csrf:result.csrf});
    }
    if(req.method==='POST'&&url.pathname==='/api/reset-password') {
      await resetPassword(store,input);res.setHeader('Set-Cookie',cookie('',true));return send(200,{ok:true});
    }
    const publicMatch=url.pathname.match(/^\/api\/public\/quotes\/([A-Za-z0-9_-]{43})(\/pdf)?$/);
    if(publicMatch){
      if(req.method==='GET'&&publicMatch[2]){const pdf=await publicPDF(store,publicMatch[1]);res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="preventivo.pdf"','Cache-Control':'no-store'});return res.end(pdf);}
      if(req.method==='GET')return send(200,await publicQuote(store,publicMatch[1]));
      if(req.method==='POST'&&!publicMatch[2])return send(200,await respondQuote(store,publicMatch[1],input,mailSettings));
      fail('Risorsa non trovata.',404);
    }
    if(url.pathname.startsWith('/api/public/quotes/'))fail('Collegamento non valido o scaduto.',404);
    if(url.pathname.startsWith('/api/')) {
      const actor=await authenticate(store,req.headers.cookie);requestActor=actor;
      if(!actor)fail('Accedi per continuare.',401);
      if(req.method==='POST'&&req.headers['x-csrf-token']!==actor.csrf)fail('Sessione non valida. Ricarica la pagina.',403);
      if(req.method==='GET'&&url.pathname==='/api/me')return send(200,{user:{id:actor.id,tenantId:actor.tenantId,homeTenantId:actor.homeTenantId,name:actor.name,email:actor.email,role:actor.role},csrf:actor.csrf});
      if(req.method==='POST'&&url.pathname==='/api/logout') {
        await store.query('DELETE FROM sessions WHERE token_hash=$1',[actor.tokenHash]);
        res.setHeader('Set-Cookie',cookie('',true));return send(200,{ok:true});
      }
      if(req.method==='POST'&&url.pathname==='/api/password') {
        await changePassword(store,actor,input);res.setHeader('Set-Cookie',cookie('',true));return send(200,{ok:true});
      }
      if(url.pathname.startsWith('/api/platform/')) {
        requireAdmin(actor);
        const action=url.pathname.slice('/api/platform/'.length);
        if(req.method==='GET'&&action==='state')return send(200,await platformState(store,actor));
        if(req.method==='GET'&&action==='users')return send(200,await team(store,{tenantId:url.searchParams.get('company')}));
        if(req.method==='GET'&&action==='mail')return send(200,await platformMailState(store,actor,mailSettings));
        if(req.method==='GET'&&action==='monitoring')return send(200,await platformMonitoring(store,actor,{mail:mailSettings,storeKind:store.kind}));
        if(req.method==='GET'&&action==='privacy')return send(200,await privacyState(store,actor));
        if(req.method==='GET'&&action==='privacy-subjects')return send(200,await privacySubjects(store,actor,url.searchParams.get('company')));
        if(req.method==='POST') {
          if(action==='switch')return send(200,await switchCompany(store,actor,input));
          if(action==='create'){const result=await createCompany(store,actor,input,req.headers['idempotency-key']);const welcome=await queueAccountWelcome(store,actor,result.user,mailSettings,result.tenantId);return send(200,{...result,welcome});}
          if(action==='status')return send(200,await suspendCompany(store,actor,input));
          if(action==='profile')return send(200,await adminProfile(store,actor,input));
          if(action==='reset-user')return send(200,await resetCompanyUser(store,actor,input));
          if(action==='mail')return send(200,await queuePlatformMail(store,actor,input,mailSettings));
          if(action==='privacy')return send(200,await createPrivacyRequest(store,actor,input));
          if(action==='privacy-status')return send(200,await updatePrivacyRequest(store,actor,input));
          if(action==='privacy-export'){const data=await privacyExport(store,actor,input.id);const body=JSON.stringify(data,null,2);res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="luviqai-privacy-${input.id}.json"`,'Cache-Control':'no-store'});return res.end(body);}
        }
        fail('Risorsa non trovata.',404);
      }
      if(actor.role==='platform_admin') {
        const context=req.headers['x-tenant-context']||url.searchParams.get('company');
        if(actor.tenantId===actor.homeTenantId||context!==actor.tenantId)fail('Seleziona l’azienda dal pannello amministrativo. Se hai cambiato azienda in un’altra scheda, ricarica questa pagina.',409);
      }
      if(req.method==='GET'&&url.pathname==='/api/ai/status')return send(200,assistant.status(actor));
      if(req.method==='POST'&&url.pathname==='/api/ai/chat')return send(200,await assistant.ask(store,actor,input));
      if(req.method==='POST'&&url.pathname==='/api/ai/confirm')return send(200,await assistant.confirm(store,actor,input));
      if(req.method==='POST'&&url.pathname==='/api/quote-email')return send(200,await queueQuote(store,actor,input,req.headers['idempotency-key'],mailSettings));
      if(req.method==='POST'&&url.pathname==='/api/invoice-email')return send(200,await queueInvoice(store,actor,input,req.headers['idempotency-key'],mailSettings));
      if(req.method==='GET'&&url.pathname==='/api/mail')return send(200,await mailState(store,actor,mailSettings));
      if(req.method==='GET'&&url.pathname==='/api/mail-settings')return send(200,await getMailSettings(store,actor,mailSettings));
      if(req.method==='POST'&&url.pathname==='/api/mail-settings')return send(200,await saveMailSettings(store,actor,input));
      if(req.method==='POST'&&url.pathname==='/api/mail-settings/test')return send(200,await queueMailTest(store,actor,input,mailSettings));
      if(req.method==='POST'&&url.pathname==='/api/notification-read')return send(200,await readNotification(store,actor,input.id));
      if(req.method==='POST'&&url.pathname==='/api/mail-cancel')return send(200,await cancelAttempt(store,actor,input));
      const messageMatch=url.pathname.match(/^\/api\/mail\/([a-f0-9-]{36})(\/eml)?$/);
      if(req.method==='GET'&&messageMatch){if(messageMatch[2]){const eml=await messageEML(store,actor,messageMatch[1],mailSettings);res.writeHead(200,{'Content-Type':'message/rfc822','Content-Disposition':'attachment; filename="email-preventivo.eml"','Cache-Control':'no-store'});return res.end(eml);}return send(200,await messageDetail(store,actor,messageMatch[1]));}
      if(req.method==='GET'&&url.pathname==='/api/state') {
        const state=await snapshot(store,actor);
        return send(200,{...state,team:actor.role!=='operator'?await team(store,actor):[]});
      }
      if(req.method==='POST'&&url.pathname==='/api/user'){const result=await manageUser(store,actor,input);if(result.created)result.welcome=await queueAccountWelcome(store,actor,result.user,mailSettings);return send(200,result);}
      const invoicePdfMatch=url.pathname.match(/^\/api\/invoices\/(\d+)\/pdf$/);
      if(req.method==='GET'&&invoicePdfMatch){
        if(actor.role==='operator')fail('Esportazione riservata al responsabile.',403);
        const state=await snapshot(store,actor),invoice=state.invoices.find(i=>i.id===Number(invoicePdfMatch[1]));
        if(!invoice)fail('Fattura non trovata.',404);
        const pdf=await invoicePDF(invoice);
        res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${invoice.number.replace(/[^a-zA-Z0-9-]/g,'_')}.pdf"`,'Cache-Control':'no-store','Content-Length':pdf.length});
        return res.end(pdf);
      }
      const pdfMatch=url.pathname.match(/^\/api\/quotes\/(\d+)\/pdf$/);
      if(req.method==='GET'&&pdfMatch){
        if(actor.role==='operator')fail('Esportazione riservata al responsabile.',403);
        const state=await snapshot(store,actor),quote=state.quotes.find(q=>q.id===Number(pdfMatch[1]));
        if(!quote)fail('Preventivo non trovato.',404);
        const pdf=await quotePDF(quote);
        res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${quote.number.replace(/[^a-zA-Z0-9-]/g,'_')}.pdf"`,'Cache-Control':'no-store','Content-Length':pdf.length});
        return res.end(pdf);
      }
      if(req.method==='GET'&&url.pathname==='/api/export') {
        if(actor.role==='operator')fail('Esportazione riservata al responsabile.',403);
        const state=await snapshot(store,actor),csv=[['Tipo','ID','Cliente','Dati']];
        for(const type of ['clients','packages','jobs','interventions','audit','catalog','quotes','invoices'])for(const item of state[type])csv.push([type,item.id,item.clientId||'',JSON.stringify(item)]);
        const cell=v=>'"'+String(v).replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
        res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="myclean-esportazione.csv"','Cache-Control':'no-store'});
        return res.end('\ufeff'+csv.map(r=>r.map(cell).join(';')).join('\r\n'));
      }
      if(req.method==='POST') {
        if(actor.role!=='operator')actor.assignableUserIds=(await team(store,actor)).filter(u=>u.active&&u.role==='operator').map(u=>u.id);
        return send(200,await mutate(store,actor,url.pathname.slice(5),input,req.headers['idempotency-key']));
      }
      fail('Risorsa non trovata.',404);
    }
    if(req.method!=='GET')fail('Risorsa non trovata.',404);
    const base=resolve(root,'dist'),file=resolve(base,'.'+decodeURIComponent(url.pathname));
    if(file!==base&&!file.startsWith(base+sep))fail('Percorso non consentito.',403);
    const target=extname(file)?file:resolve(base,'index.html');
    if(!existsSync(target))fail('Eseguire prima la build.',404);
    res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(target)]||'application/octet-stream','Cache-Control':extname(target)==='.html'?'no-store':'public, max-age=3600'});
    res.end(readFileSync(target));
  } catch(error) {
    const status=error.status||500;
    if(status===500){requestError=String(error?.message||error?.code||error?.name||'Errore interno').slice(0,1000);console.error('Errore interno:',error.code||error.name);}
    if(!res.headersSent)send(status,{error:status===500?'Operazione non riuscita. Riprova o contatta il responsabile.':error.message});
    else res.end();
  }
});
server.listen(port,production?'0.0.0.0':'127.0.0.1',()=>console.log(`luviqAI · Gestionale servizi — ${origin} — ${store.kind}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{clearInterval(backupTimer);clearInterval(mailTimer);server.close(async()=>{await store.close();process.exit(0);});});
