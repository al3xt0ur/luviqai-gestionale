import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {connectStore,migrate} from '../server/storage.mjs';
import {provision} from '../server/auth.mjs';

test('HTTP autenticato: isolamento, CSRF, duplicati concorrenti, cookie, export e riavvio',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'luviq-http-')),path=join(dir,'pg'),port=3137;
  const password='Prova-password-lunga-2026';let child;
  const db=await connectStore({path});await migrate(db);
  for(const slug of ['prima','seconda'])await provision(db,{slug,name:slug,email:'admin@example.com',password});
  await db.close();
  async function start(){child=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,PORT:String(port),PGLITE_PATH:path,BOOTSTRAP_DEMO:'0'},stdio:['ignore','pipe','pipe']});await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('Avvio fallito');}),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Timeout avvio')),15000);timer.unref();})]);}
  async function stop(){const done=once(child,'exit');child.kill();await done;}
  const url=`http://localhost:${port}`;
  const request=async(action,body,session,key=crypto.randomUUID(),csrf=true)=>{
    const res=await fetch(url+'/api/'+action,{method:'POST',headers:{'Content-Type':'application/json','Origin':url,'Idempotency-Key':key,...(session?{'Cookie':session.cookie,...(csrf?{'X-CSRF-Token':session.csrf}:{})}:{})},body:JSON.stringify(body)});
    return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')};
  };
  const get=async(path,session)=>{const res=await fetch(url+'/api/'+path,{headers:session?{Cookie:session.cookie}:{}});return{status:res.status,text:await res.text()};};
  try {
    await start();assert.equal((await get('state')).status,401);assert.equal((await get('export')).status,401);
    const authA=await request('login',{slug:'prima',email:'admin@example.com',password});
    assert.equal(authA.status,200);assert(authA.cookie.includes('HttpOnly'));assert(authA.cookie.includes('SameSite=Strict'));
    const a={cookie:authA.cookie.split(';')[0],csrf:authA.body.csrf};
    const authB=await request('login',{slug:'seconda',email:'admin@example.com',password});
    const b={cookie:authB.cookie.split(';')[0],csrf:authB.body.csrf};
    assert.equal((await request('client',{name:'Senza CSRF'},a,undefined,false)).status,403);
    const c=await request('client',{name:'Privato A'},a);assert.equal(c.status,200);
    assert.equal(JSON.parse((await get('state',b)).text).clients.length,0);
    assert.equal((await request('client',{id:c.body.value.id,name:'Attacco'},b)).status,404);
    assert.equal((await request('client',{name:'Attacco',tenantId:authA.body.user.tenantId},b)).status,403);
    const model=(await request('template',{name:'Offerta HTTP',minutes:1200,rule:'team'},a)).body.value;
    const p=(await request('package',{clientId:c.body.value.id,templateId:model.id,templateRevision:model.revision,initial:120,paid:true},a)).body.value;
    const item={packageId:p.id,date:new Date(Date.now()-10000).toISOString(),duration:120,operators:2,status:'pending',service:'Test',team:'T'};
    const attempts=await Promise.all(Array.from({length:6},()=>request('intervention',item,a)));
    assert.equal(attempts.filter(r=>r.status===200).length,1);assert.equal(attempts.filter(r=>r.status===400).length,5);
    const id=attempts.find(r=>r.status===200).body.value.id;
    const approvals=await Promise.all(Array.from({length:12},()=>request('approve',{id},a,'approve-key')));
    assert(approvals.every(r=>r.status===200));assert.equal((await request('approve',{id},a)).status,400);
    const state=JSON.parse((await get('state',a)).text);assert.equal(state.packages[0].remaining,0);assert.equal(state.audit.filter(e=>e.action==='approve').length,1);
    assert((await get('export',a)).text.includes('Privato A'));assert(!(await get('export',b)).text.includes('Privato A'));
    await stop();await start();assert.deepEqual(JSON.parse((await get('state',a)).text),state);
    assert.equal((await request('approve',{id},a,'approve-key')).status,200);
    await request('logout',{},a);assert.equal((await get('state',a)).status,401);
  } finally {if(child&&child.exitCode===null)await stop();rmSync(dir,{recursive:true,force:true});}
});
