import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
const text=readFileSync('data/accessi-locali.txt','utf8');
const accounts=[...text.matchAll(/Azienda: (.+)\nEmail: (.+)\nPassword: (.+)/g)];
const origin=process.env.APP_ORIGIN||'http://localhost:3000';
for(const [,slug,email,password] of accounts) {
  const login=await fetch(origin+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug,email,password})});
  assert.equal(login.status,200);const auth=await login.json(),cookie=login.headers.get('set-cookie').split(';')[0];
  const state=await(await fetch(origin+'/api/state',{headers:{Cookie:cookie}})).json();
  if(slug==='my-clean'&&email==='responsabile@example.com') {
    const old=new DatabaseSync('data/myclean.sqlite',{readOnly:true});
    assert.equal(state.clients.length,old.prepare('SELECT count(*) AS count FROM clients').get().count);
    assert.equal(state.packages.length,old.prepare('SELECT count(*) AS count FROM packages').get().count);old.close();
  }
  if(slug==='impresa-demo')assert.equal(state.clients.length,0);
  if(email==='operatore@example.com')assert.equal(state.interventions.length,0);
  console.log(`${slug} · ${auth.user.role}: accesso verificato; ${state.clients.length} clienti, ${state.interventions.length} interventi visibili.`);
  await fetch(origin+'/api/logout',{method:'POST',headers:{'Content-Type':'application/json','Cookie':cookie,'X-CSRF-Token':auth.csrf},body:'{}'});
}
