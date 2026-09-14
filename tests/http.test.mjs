import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
test('HTTP: approvazioni concorrenti, collisione disponibilità, export e riavvio processo',async()=>{
const dir=mkdtempSync(join(tmpdir(),'myclean-http-'));const port=3137;let child;
async function start(){child=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,PORT:String(port),DB_PATH:join(dir,'test.sqlite')},stdio:['ignore','pipe','pipe']});await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('Avvio fallito')}),new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('Timeout avvio')),10000);t.unref()})])}
async function stop(){const done=once(child,'exit');child.kill();await done}
const get=async()=>await(await fetch(`http://localhost:${port}/api/state`)).json();
const post=async(a,b,k=crypto.randomUUID())=>{const r=await fetch(`http://localhost:${port}/api/${a}`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':k},body:JSON.stringify(b)});return{status:r.status,body:await r.json()}};
try{await start();let state=await get();const i=state.interventions.find(i=>i.status==='pending');const before=state.packages.find(p=>p.id===i.packageId);const same=await Promise.all(Array.from({length:12},()=>post('approve',{id:i.id},'concurrent-key')));assert(same.every(r=>r.status===200));state=await get();assert.equal(state.packages.find(p=>p.id===i.packageId).remaining,before.remaining-i.cost);assert.equal(state.audit.filter(a=>a.action==='approve'&&a.interventionId===i.id).length,1);
const distinct=await Promise.all(Array.from({length:8},()=>post('approve',{id:i.id})));assert(distinct.every(r=>r.status===400));
const client=(await post('client',{name:'Concurrent'})).body.value;const p=(await post('package',{clientId:client.id,tier:'Star',initial:60,rule:'team',paid:true})).body.value;const attempts=await Promise.all(Array.from({length:6},()=>post('intervention',{packageId:p.id,date:new Date().toISOString(),service:'Test',team:'T',duration:60,operators:1,status:'planned'})));assert.equal(attempts.filter(r=>r.status===200).length,1);assert.equal(attempts.filter(r=>r.status===400).length,5);
const csv=await fetch(`http://localhost:${port}/api/export`);assert.equal(csv.status,200);assert((await csv.text()).includes('Casa Aurora'));const denied=await fetch(`http://localhost:${port}/api/client`,{method:'POST',headers:{'Content-Type':'application/json','Origin':'https://invalid.example','Idempotency-Key':'attack'},body:JSON.stringify({name:'Attacco'})});assert.equal(denied.status,403);
const persisted=await get();await stop();await start();assert.deepEqual(await get(),persisted);assert.equal((await post('approve',{id:i.id},'concurrent-key')).status,200);assert.deepEqual(await get(),persisted);
}finally{if(child&&child.exitCode===null)await stop();rmSync(dir,{recursive:true,force:true})}
});
