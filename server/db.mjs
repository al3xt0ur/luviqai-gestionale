import { DatabaseSync } from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
export function openDB(path){
 if(path!==':memory:') mkdirSync(dirname(path),{recursive:true});
 const db=new DatabaseSync(path); db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
 db.exec(`CREATE TABLE IF NOT EXISTS clients(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL,address TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS packages(id INTEGER PRIMARY KEY,clientId INTEGER NOT NULL REFERENCES clients(id),tier TEXT NOT NULL,original INTEGER NOT NULL,initial INTEGER NOT NULL,rule TEXT NOT NULL,paid INTEGER NOT NULL DEFAULT 0,renewedFrom INTEGER REFERENCES packages(id),created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS interventions(id INTEGER PRIMARY KEY,packageId INTEGER NOT NULL REFERENCES packages(id),date TEXT NOT NULL,service TEXT NOT NULL,team TEXT NOT NULL,duration INTEGER NOT NULL,operators INTEGER NOT NULL,notes TEXT NOT NULL,status TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,date TEXT NOT NULL,author TEXT NOT NULL,action TEXT NOT NULL,clientId INTEGER,interventionId INTEGER,beforeValue TEXT,afterValue TEXT,reason TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS requests(key TEXT PRIMARY KEY,payload TEXT NOT NULL,response TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);return db;
}
const fail=(message)=>{throw new Error(message)};
const integer=(n,min,max)=>{n=Number(n);if(!Number.isSafeInteger(n)||n<min||n>max)fail(`Inserire un numero intero tra ${min} e ${max}.`);return n};
const str=(v,max=300)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail('Compilare i campi obbligatori con valori validi.');return v.trim()};
export function snapshot(db){
 const clients=db.prepare('SELECT * FROM clients ORDER BY name').all();
 const interventions=db.prepare('SELECT i.*,p.clientId,p.rule FROM interventions i JOIN packages p ON p.id=i.packageId ORDER BY date DESC,id DESC').all().map(i=>({...i,cost:i.duration*(i.rule==='operator'?i.operators:1)}));
 const packages=db.prepare('SELECT * FROM packages ORDER BY id DESC').all().map(p=>{const items=interventions.filter(i=>i.packageId===p.id);const consumed=items.filter(i=>i.status==='approved').reduce((s,i)=>s+i.cost,0);const committed=items.filter(i=>['planned','pending'].includes(i.status)).reduce((s,i)=>s+i.cost,0);return {...p,consumed,committed,remaining:p.initial-consumed,free:p.initial-consumed-committed}});
 return {clients,packages,interventions,audit:db.prepare('SELECT * FROM audit ORDER BY id DESC').all()};
}
export function mutate(db,action,input,key){
 str(key,150);const payload=JSON.stringify({action,input});db.exec('BEGIN IMMEDIATE');
 try{
 const cached=db.prepare('SELECT * FROM requests WHERE key=?').get(key);if(cached){if(cached.payload!==payload)fail('Identificativo richiesta già utilizzato.');db.exec('COMMIT');return JSON.parse(cached.response)}
 let before=null,after=null,clientId=null,interventionId=null;let reason=String(input.reason||'').trim();
 const getP=id=>snapshot(db).packages.find(p=>p.id===Number(id))||fail('Pacchetto non trovato.');
 if(action==='client'){
 const values=[str(input.name),String(input.email||'').trim(),String(input.phone||'').trim(),String(input.address||'').trim()];
 if(values.slice(1).some(x=>x.length>500))fail('Uno dei campi è troppo lungo.');if(values[1]&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values[1]))fail('Indirizzo email non valido.');
 if(input.id){before=db.prepare('SELECT * FROM clients WHERE id=?').get(Number(input.id));if(!before)fail('Cliente non trovato.');clientId=before.id;db.prepare('UPDATE clients SET name=?,email=?,phone=?,address=? WHERE id=?').run(...values,clientId)}else clientId=Number(db.prepare('INSERT INTO clients(name,email,phone,address) VALUES(?,?,?,?)').run(...values).lastInsertRowid);
 after=db.prepare('SELECT * FROM clients WHERE id=?').get(clientId);
 }else if(action==='package'){
 clientId=integer(input.clientId,1,1e9);if(!db.prepare('SELECT id FROM clients WHERE id=?').get(clientId))fail('Selezionare un cliente valido.');
 const original={Star:1200,Love:2400,Luxury:3600}[input.tier];if(!original)fail('Taglio non valido.');const initial=integer(input.initial,1,original);if(!['operator','team'].includes(input.rule))fail('Regola di conteggio non valida.');
 const renewedFrom=input.renewedFrom?getP(input.renewedFrom):null;if(renewedFrom&&renewedFrom.clientId!==clientId)fail('Il rinnovo deve appartenere allo stesso cliente.');
 const id=Number(db.prepare('INSERT INTO packages(clientId,tier,original,initial,rule,paid,renewedFrom,created) VALUES(?,?,?,?,?,?,?,?)').run(clientId,input.tier,original,initial,input.rule,input.paid===true?1:0,renewedFrom?.id||null,new Date().toISOString()).lastInsertRowid);after=getP(id);
 }else if(action==='pay'){
 before=getP(input.id);clientId=before.clientId;if(before.paid)fail('Pagamento già confermato.');db.prepare('UPDATE packages SET paid=1 WHERE id=?').run(before.id);after=getP(before.id);
 }else if(action==='intervention'){
 const p=getP(input.packageId);clientId=p.clientId;if(!p.paid)fail('Confermare il pagamento prima di inserire interventi.');
 const duration=integer(input.duration,1,3600),operators=integer(input.operators,1,100);const date=new Date(input.date);if(!Number.isFinite(date.getTime()))fail('Data non valida.');const status=input.status;if(!['planned','pending'].includes(status))fail('Stato non valido.');if(status==='pending'&&date.getTime()>Date.now())fail('Un intervento futuro può essere solo pianificato.');
 const cost=duration*(p.rule==='operator'?operators:1);if(cost>p.free)fail('Ore libere insufficienti per questo intervento.');
 interventionId=Number(db.prepare('INSERT INTO interventions(packageId,date,service,team,duration,operators,notes,status) VALUES(?,?,?,?,?,?,?,?)').run(p.id,date.toISOString(),str(input.service),str(input.team),duration,operators,String(input.notes||'').slice(0,3000),status).lastInsertRowid);after=db.prepare('SELECT * FROM interventions WHERE id=?').get(interventionId);
 }else if(['complete','approve','rectify','cancel'].includes(action)){
 before=db.prepare('SELECT * FROM interventions WHERE id=?').get(Number(input.id));if(!before)fail('Intervento non trovato.');interventionId=before.id;const p=getP(before.packageId);clientId=p.clientId;if(!p.paid)fail('Pacchetto non pagato.');if(before.status==='cancelled')fail('Intervento già annullato.');
 if(action==='cancel'){
 str(reason,2000);db.prepare("UPDATE interventions SET status='cancelled' WHERE id=?").run(before.id);
 }else{
 if(new Date(before.date).getTime()>Date.now())fail('Non è possibile completare o approvare un intervento futuro.');
 if(action==='approve'){
 if(before.status!=='pending')fail('Solo un intervento da approvare può essere approvato.');db.prepare("UPDATE interventions SET status='approved' WHERE id=?").run(before.id);
 }else{
 if(action==='complete'&&before.status!=='planned')fail('Solo un intervento pianificato può essere completato.');if(action==='rectify'&&before.status!=='approved')fail('Solo un intervento approvato può essere rettificato.');if(action==='rectify')str(reason,2000);
 const duration=integer(input.duration,1,3600),operators=integer(input.operators,1,100);const factor=n=>p.rule==='operator'?n:1;const oldCost=before.duration*factor(before.operators),newCost=duration*factor(operators);if(newCost>p.free+oldCost)fail('Ore libere insufficienti per la nuova durata e il numero di operatori.');
 db.prepare('UPDATE interventions SET duration=?,operators=?,status=? WHERE id=?').run(duration,operators,action==='complete'?'pending':'approved',before.id);
 }}after=db.prepare('SELECT * FROM interventions WHERE id=?').get(before.id);
 }else fail('Operazione sconosciuta.');
 db.prepare('INSERT INTO audit(date,author,action,clientId,interventionId,beforeValue,afterValue,reason) VALUES(?,?,?,?,?,?,?,?)').run(new Date().toISOString(),'Responsabile locale',action,clientId,interventionId,JSON.stringify(before),JSON.stringify(after),reason);
 const result={ok:true,value:after};const response=JSON.stringify(result);db.prepare('INSERT INTO requests VALUES(?,?,?)').run(key,payload,response);db.exec('COMMIT');return JSON.parse(response);
 }catch(e){db.exec('ROLLBACK');throw e}
}
export function seed(db){
 if(db.prepare("SELECT value FROM metadata WHERE key='seeded'").get())return;
 db.exec('BEGIN IMMEDIATE');try{
 const names=['Casa Aurora','Studio Levante','Condominio Magnolia','Dimora del Sole'];
 names.forEach((name,i)=>db.prepare('INSERT INTO clients(name,email,phone,address) VALUES(?,?,?,?)').run(name,`demo${i+1}@example.com`,'',`Via Esempio ${i+1} · Cliente fittizio`));
 const now=new Date().toISOString();
 [[1,'Star',1200,480,'operator',1],[2,'Love',2400,2400,'team',1],[3,'Luxury',3600,3600,'operator',0],[4,'Love',2400,1800,'operator',1]].forEach(p=>db.prepare('INSERT INTO packages(clientId,tier,original,initial,rule,paid,created) VALUES(?,?,?,?,?,?,?)').run(...p,now));
 const date=days=>new Date(Date.now()+days*86400000).toISOString();
 [[1,date(-3),'Pulizia appartamento','Anna e Marco',120,2,'Esempio approvato','approved'],[2,date(-1),'Pulizia uffici','Squadra Levante',150,2,'Durata effettiva da verificare','pending'],[4,date(1),'Pulizia ordinaria','Sara',120,1,'Appuntamento dimostrativo','planned'],[2,date(2),'Sanificazione uffici','Squadra Levante',180,2,'Appuntamento dimostrativo','planned']].forEach(i=>db.prepare('INSERT INTO interventions(packageId,date,service,team,duration,operators,notes,status) VALUES(?,?,?,?,?,?,?,?)').run(...i));
 db.prepare('INSERT INTO audit(date,author,action,beforeValue,afterValue,reason) VALUES(?,?,?,?,?,?)').run(now,'Sistema demo','seed','null',JSON.stringify(snapshot(db)),'Dati fittizi iniziali; saldi importati e intervento approvato dimostrativo.');db.exec("INSERT INTO metadata VALUES('seeded','1'); COMMIT");
 }catch(e){db.exec('ROLLBACK');throw e}
}
