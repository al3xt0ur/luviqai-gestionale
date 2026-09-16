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

const root=fileURLToPath(new URL('../',import.meta.url));
const production=process.env.NODE_ENV==='production';
const port=Number(process.env.PORT||3000);
const origin=process.env.APP_ORIGIN||`http://localhost:${port}`;
if(production&&(!process.env.DATABASE_URL||!origin.startsWith('https://')))throw Error('In produzione sono obbligatori DATABASE_URL e APP_ORIGIN HTTPS.');
const dataDir=resolve(root,'data');
const store=await connectStore({url:process.env.DATABASE_URL,path:process.env.PGLITE_PATH||resolve(dataDir,'postgres')});
await migrate(store);
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
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  try {
    if(!allowedHosts.has(req.headers.host))return send(403,{error:'Host non consentito.'});
    const url=new URL(req.url,origin);
    if(req.method==='GET'&&url.pathname==='/api/health')return send(200,{ok:true});
    let input;
    if(req.method==='POST') {
      if(req.headers.origin&&!allowedOrigins.has(req.headers.origin))fail('Origine non consentita.',403);
      if(req.headers['sec-fetch-site']==='cross-site')fail('Origine non consentita.',403);
      if(!req.headers['content-type']?.startsWith('application/json'))fail('Formato richiesta non valido.',415);
      let body='';
      for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>100000)fail('Richiesta troppo grande.',413);}
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
    if(url.pathname.startsWith('/api/')) {
      const actor=await authenticate(store,req.headers.cookie);
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
        if(req.method==='POST') {
          if(action==='switch')return send(200,await switchCompany(store,actor,input));
          if(action==='create')return send(200,await createCompany(store,actor,input,req.headers['idempotency-key']));
          if(action==='status')return send(200,await suspendCompany(store,actor,input));
          if(action==='profile')return send(200,await adminProfile(store,actor,input));
          if(action==='reset-user')return send(200,await resetCompanyUser(store,actor,input));
        }
        fail('Risorsa non trovata.',404);
      }
      if(actor.role==='platform_admin') {
        const context=req.headers['x-tenant-context']||url.searchParams.get('company');
        if(actor.tenantId===actor.homeTenantId||context!==actor.tenantId)fail('Seleziona l’azienda dal pannello amministrativo. Se hai cambiato azienda in un’altra scheda, ricarica questa pagina.',409);
      }
      if(req.method==='GET'&&url.pathname==='/api/state') {
        const state=await snapshot(store,actor);
        return send(200,{...state,team:actor.role!=='operator'?await team(store,actor):[]});
      }
      if(req.method==='POST'&&url.pathname==='/api/user')return send(200,await manageUser(store,actor,input));
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
        for(const type of ['clients','packages','interventions','audit','catalog','quotes'])for(const item of state[type])csv.push([type,item.id,item.clientId||'',JSON.stringify(item)]);
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
    if(status===500)console.error('Errore interno:',error.code||error.name);
    if(!res.headersSent)send(status,{error:status===500?'Operazione non riuscita. Riprova o contatta il responsabile.':error.message});
    else res.end();
  }
});
server.listen(port,production?'0.0.0.0':'127.0.0.1',()=>console.log(`luviqAI · Gestionale servizi — ${origin} — ${store.kind}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{clearInterval(backupTimer);server.close(async()=>{await store.close();process.exit(0);});});
