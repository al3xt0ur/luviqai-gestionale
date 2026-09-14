import {createServer} from 'node:http';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openDB,snapshot,mutate,seed} from './db.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const db=openDB(process.env.DB_PATH||resolve(root,'data/myclean.sqlite'));seed(db);
const port=Number(process.env.PORT||3000);
const server=createServer(async(req,res)=>{
 const send=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value))};
 try{
 if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host))return send(403,{error:'Host non consentito.'});
 const url=new URL(req.url,`http://localhost:${port}`);
 if(req.method==='GET'&&url.pathname==='/api/state')return send(200,snapshot(db));
 if(req.method==='POST'&&url.pathname.startsWith('/api/')){
 if(req.headers.origin&&!['http://localhost:'+port,'http://127.0.0.1:'+port].includes(req.headers.origin))return send(403,{error:'Origine non consentita.'});
 if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'Formato richiesta non valido.'});
 let body='';for await(const chunk of req){body+=chunk;if(body.length>20000)return send(413,{error:'Richiesta troppo grande.'})}let input;try{input=JSON.parse(body)}catch{return send(400,{error:'Richiesta non valida.'})}
 return send(200,mutate(db,url.pathname.slice(5),input,req.headers['idempotency-key']));
 }
 if(req.method==='GET'&&url.pathname==='/api/export'){
 const state=snapshot(db);const rows=[['Tipo','ID','Cliente','Dati']];for(const type of ['clients','packages','interventions','audit'])for(const item of state[type])rows.push([type,item.id,item.clientId||'',JSON.stringify(item)]);
 const cell=v=>'"'+String(v).replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="myclean-esportazione.csv"'});return res.end('\ufeff'+rows.map(r=>r.map(cell).join(';')).join('\r\n'));
 }
 if(req.method!=='GET')return send(404,{error:'Risorsa non trovata.'});
 const file=resolve(root,'dist','.'+decodeURIComponent(url.pathname));const base=resolve(root,'dist');if(file!==base&&!file.startsWith(base+ '\\')&&!file.startsWith(base+'/'))return send(403,{error:'Percorso non consentito.'});
 const target=extname(file)?file:resolve(base,'index.html');if(!existsSync(target))return send(404,{error:'Eseguire prima la build.'});res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(target)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(readFileSync(target));
 }catch(e){send(400,{error:e.message||'Operazione non riuscita.'})}
});server.listen(port,'127.0.0.1',()=>console.log(`My Clean · Pacchetti ore — http://localhost:${port}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{db.close();process.exit(0)}));
