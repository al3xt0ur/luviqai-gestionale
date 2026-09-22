import '../scripts/test-isolation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {connectStore,migrate,initializeStore,tenantTransaction} from '../server/storage.mjs';
import {provision} from '../server/auth.mjs';
import {mutate,snapshot} from '../server/domain.mjs';
import {backupStore,restoreStore} from '../server/backup.mjs';
import {recurrenceDates,localInstant,syncAlerts,dashboard} from '../server/operations.mjs';
import {today} from '../server/quotes.mjs';
async function fixture(){
 const db=await connectStore();await migrate(db);
 const a=await provision(db,{slug:'operazioni-a',name:'A',email:'a@example.com',password:'Password-test-2026!'}),b=await provision(db,{slug:'operazioni-b',name:'B',email:'b@example.com',password:'Password-test-2026!'});
 let seq=0;const run=(action,input,key,actor=a)=>mutate(db,actor,action,input,key||`op-${++seq}`);
 const c=(await run('client',{name:'Cliente'})).value;
 const model=(await run('template',{name:'Ore',minutes:1200,rule:'team'})).value;
 let q=(await run('quote',{clientId:c.id,title:'Servizi',issueDate:today(),validUntil:'2099-12-31',lines:[{description:'Ore',quantity:100,unitPrice:10000,discount:0,vat:2200}]})).value;
 q=(await run('quote-status',{id:q.id,revision:q.revision,status:'sent',reason:'Test'})).value;
 q=(await run('quote-status',{id:q.id,revision:q.revision,status:'accepted',reason:'Test'})).value;
 return {db,a,b,run,c,model,q};
}
const conversion=f=>({quoteId:f.q.id,revision:f.q.revision,templateId:f.model.id,templateRevision:f.model.revision,reason:'Abbinamento verificato'});
const series=(p,t,extra={})=>({packageId:p.id,teamId:t.id,startDate:'2099-01-05',localTime:'10:00',weekdays:[1],frequencyWeeks:1,occurrenceCount:3,duration:60,operators:1,service:'Pulizia',...extra});
test('conversione: concorrenza, conferma pagamento separata, permessi e isolamento',async()=>{
 const f=await fixture();try{
 const r=await Promise.all(Array.from({length:4},()=>f.run('quote-convert',conversion(f),'convert')));
 assert(r.every(x=>x.value.id===r[0].value.id));assert.equal(r[0].value.paid,0);
 await assert.rejects(f.run('quote-convert',conversion(f)),/già convertito/);
 await assert.rejects(f.run('quote-convert',conversion(f),undefined,f.b),/accettato/);
 await assert.rejects(f.run('quote-convert',conversion(f),undefined,{...f.a,role:'operator'}),/account/);
 const t=(await f.run('team',{name:'Squadra'})).value;
 await assert.rejects(f.run('recurrence',series(r[0].value,t)),/pagato/);
 const other=await snapshot(f.db,f.b);assert.equal(other.packages.length,0);assert.equal(other.teams.length,0);
 }finally{await f.db.close()}
});
test('ricorrenze: atomicità, saldo, sovrapposizioni, annullamento, backup e RLS',async()=>{
 const f=await fixture(),dir=await mkdtemp(join(tmpdir(),'luviq-ops-'));
 try{
 const p=(await f.run('quote-convert',conversion(f))).value;await f.run('pay',{id:p.id});
 const t=(await f.run('team',{name:'Squadra A'})).value;
 const result=await f.run('recurrence',series(p,t),'series');
 assert.equal(result.value.interventions.length,3);
 assert.equal((await f.run('recurrence',series(p,t),'series')).value.id,result.value.id);
 let s=await snapshot(f.db,f.a);assert.equal(s.packages[0].free,1020);
 await assert.rejects(f.run('recurrence',series(p,t)),/impegnato/);
 await assert.rejects(f.run('recurrence',series(p,t,{localTime:'12:00',occurrenceCount:52})),/insufficienti/);
 assert.equal((await snapshot(f.db,f.a)).interventions.length,3);
 await assert.rejects(f.run('recurrence-cancel',{id:result.value.id,reason:'Test'},undefined,f.b),/trovata/);
 await tenantTransaction(f.db,f.b.tenantId,async tx=>{for(const table of ['teams','recurrence_series','alerts'])assert.equal((await tx.query('SELECT * FROM '+table)).rows.length,0)});
 const first=s.interventions[0];await assert.rejects(f.run('reschedule',{id:first.id,date:s.interventions[1].date,reason:'Collisione'}),/impegnato/);
 await f.run('alert-settings',{lowBalanceMinutes:1200,quoteFollowupDays:7,pendingApprovalHours:24});
 s=await snapshot(f.db,f.a);assert.equal(s.alerts.length,1);
 await f.run('alert-read',{id:s.alerts[0].id});
 const path=join(dir,'backup.json');await backupStore(f.db,path);
 const restored=await connectStore();try{await migrate(restored);await restoreStore(restored,path);assert.deepEqual(await snapshot(restored,f.a),await snapshot(f.db,f.a));}finally{await restored.close()}
 await f.run('recurrence-cancel',{id:result.value.id,reason:'Cliente indisponibile'});
 s=await snapshot(f.db,f.a);assert(s.interventions.every(i=>i.status==='cancelled'));assert.equal(s.packages[0].free,1200);assert.equal(s.recurrenceSeries[0].active,false);
 // New backups must fail closed if a required new table is missing.
 const broken=JSON.parse(await readFile(path,'utf8'));delete broken.data.teams;broken.checksum=createHash('sha256').update(JSON.stringify(broken.data)).digest('hex');await writeFile(path,JSON.stringify(broken));
 await assert.rejects(restoreStore(f.db,path),/incompleto/);
 }finally{await f.db.close();await rm(dir,{recursive:true,force:true})}
});
test('orari Europe/Rome: ora legale, bisettimanale, date invalide e ore ambigue',()=>{
 const dates=recurrenceDates({startDate:'2026-03-23',localTime:'10:00',weekdays:[1],frequencyWeeks:1,occurrenceCount:2});
 assert.deepEqual(dates,['2026-03-23T09:00:00.000Z','2026-03-30T08:00:00.000Z']);
 assert.equal(recurrenceDates({startDate:'2026-03-23',localTime:'10:00',weekdays:[1],frequencyWeeks:2,occurrenceCount:2})[1],'2026-04-06T08:00:00.000Z');
 assert.throws(()=>localInstant('2026-03-29','02:30'),/ambiguo/);assert.throws(()=>localInstant('2026-10-25','02:30'),/ambiguo/);assert.throws(()=>localInstant('2026-02-30','10:00'),/valida/);
});
test('avvisi: quattro soglie, deduplica, lettura, risoluzione e riapertura',async()=>{
 const f=await fixture();try{
 const config={low_balance_minutes:300,quote_followup_days:7,pending_approval_hours:24};
 const state={packages:[{id:1,paid:1,remaining:300}],quotes:[{id:1,status:'sent',updated:'2026-01-01T10:00:00Z',number:'PRE-1'}],invoices:[{id:1,status:'issued',dueDate:'2026-01-09',number:'FAT-1'}],interventions:[{id:1,status:'pending',date:'2026-01-01T10:00:00Z',service:'Pulizia'}],audit:[]};
 const clock=new Date('2026-01-10T12:00:00Z');
 const sync=s=>tenantTransaction(f.db,f.a.tenantId,tx=>syncAlerts(tx,f.a.tenantId,s,config,clock));
 let alerts=await sync(state);assert.equal(alerts.length,4);const ids=alerts.map(a=>a.id).sort();
 await f.run('alert-read',{id:alerts[0].id});alerts=await sync(state);assert.deepEqual(alerts.map(a=>a.id).sort(),ids);assert(alerts.some(a=>a.read_at));
 const empty={packages:[],quotes:[],invoices:[],interventions:[],audit:[]};assert((await sync(empty)).every(a=>a.resolved_at));
 alerts=await sync(state);assert(alerts.every(a=>!a.resolved_at&&!a.read_at));
 }finally{await f.db.close()}
});
test('KPI: filtri temporali e stati, incassi per data pagamento',()=>{
 const state={invoices:[{status:'issued',issueDate:'2026-01-01',total:100},{status:'paid',issueDate:'2025-12-01',payment:{date:'2026-01-02'},total:200},{status:'draft',issueDate:'2026-01-01',total:300},{status:'cancelled',issueDate:'2026-01-01',total:400}],interventions:[{status:'approved',date:'2026-01-03T09:00:00Z',cost:120},{status:'planned',date:'2026-01-03T09:00:00Z',cost:60}]};
 assert.deepEqual(dashboard(state,{from:'2026-01-01',to:'2026-01-31'}),{issuedTotal:100,paidTotal:200,approvedMinutes:120,plannedCount:1});
});
test('avvio PostgreSQL non esegue DDL; schema mancante o futuro blocca avvio',async()=>{
 for(const version of [0,19,20,21]){
 const queries=[];const store={kind:'PostgreSQL',query:async sql=>{queries.push(sql);return {rows:[sql.includes('to_regclass')?{name:version?'schema_version':null}:{version}]}}};
 if(version===20)await initializeStore(store);else await assert.rejects(initializeStore(store),/incompatibile/);
 assert(queries.every(q=>q.startsWith('SELECT')));
 }
});
test('migrazione da v19 popolato e backup pre-migrazione senza cambi schema',async()=>{
 const db=await connectStore(),dir=await mkdtemp(join(tmpdir(),'luviq-migration-'));try{
 const sql=await readFile(new URL('../server/schema.sql',import.meta.url),'utf8');
 await db.transaction(async tx=>{for(const statement of sql.split('-- next'))if(statement.trim())await tx.query(statement);await tx.query('INSERT INTO schema_version(version) VALUES(3) ON CONFLICT DO NOTHING')});
 const actor=await provision(db,{slug:'legacy',name:'Legacy',email:'legacy@example.com',password:'Password-legacy-2026!'});
 await db.query('INSERT INTO clients(tenant_id,id,name,email,phone,address) VALUES($1,1,$2,$3,$4,$5)',[actor.tenantId,'Cliente esistente','','','']);
 const before=(await db.query('SELECT * FROM clients')).rows;
 const path=join(dir,'pre.json');await backupStore(db,path);
 assert.equal((await db.query("SELECT to_regclass('teams') AS name")).rows[0].name,null);
 await migrate(db);await migrate(db);assert.deepEqual((await db.query('SELECT * FROM clients')).rows,before);
 const target=await connectStore();try{await migrate(target);await restoreStore(target,path);assert.deepEqual((await target.query('SELECT * FROM clients')).rows,before);}finally{await target.close()}
 }finally{await db.close();await rm(dir,{recursive:true,force:true})}
});
