import '../scripts/test-isolation.mjs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {connectStore,migrate} from '../server/storage.mjs';
import {provision} from '../server/auth.mjs';
import {mutate} from '../server/domain.mjs';
import {today} from '../server/quotes.mjs';
const dir=await mkdtemp(join(tmpdir(),'luviq-browser-ops-')),path=join(dir,'db'),port=3142;
const db=await connectStore({path});let actor;
try{
 await migrate(db);actor=await provision(db,{slug:'browser-ops',name:'Impresa test',email:'test@example.com',password:'Password-browser-2026!'});
 let n=0;const run=(a,i)=>mutate(db,actor,a,i,'seed-'+(++n));
 const c=(await run('client',{name:'Cliente prova'})).value;
 await run('template',{name:'Pacchetto prova',minutes:1200,rule:'team'});
 let q=(await run('quote',{clientId:c.id,title:'Pulizie prova',issueDate:today(),validUntil:'2099-12-31',lines:[{description:'Servizio',quantity:100,unitPrice:10000,vat:2200}]})).value;
 q=(await run('quote-status',{id:q.id,revision:q.revision,status:'sent',reason:'Test'})).value;
 await run('quote-status',{id:q.id,revision:q.revision,status:'accepted',reason:'Test'});
}finally{await db.close()}
const child=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,PORT:String(port),PGLITE_PATH:path},stdio:['ignore','pipe','pipe']});
let browser;let logs='';child.stderr.on('data',d=>logs+=d.toString());
try{
 await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('Avvio fallito: '+logs)}),new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('Timeout avvio')),15000);t.unref()})]);
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000},locale:'it-IT',timezoneId:'Europe/Rome'});page.setDefaultTimeout(12000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:'+port);const loginForm=page.locator('form:visible').filter({has:page.locator('input[name="slug"]')}).first();await loginForm.locator('input[name="slug"]').fill('browser-ops');await loginForm.locator('input[name="email"]').fill('test@example.com');await loginForm.locator('input[name="password"]').fill('Password-browser-2026!');await loginForm.getByRole('button',{name:'Accedi',exact:true}).click();
 await page.getByText('Cruscotto operativo',{exact:true}).waitFor();await page.getByText('Totale emesso',{exact:true}).waitFor();
 const nav=name=>page.locator('aside nav').getByRole('button',{name:new RegExp(name)});
 await nav('Flussi operativi').click();await page.getByRole('button',{name:'＋ Squadra',exact:true}).click();await page.getByLabel('Nome squadra').fill('Squadra test');await page.getByRole('button',{name:'Conferma',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
 await page.getByRole('button',{name:'Converti preventivo',exact:true}).click();const conversionDialog=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Converti preventivo',exact:true})});await conversionDialog.waitFor();await conversionDialog.locator('select[name="quoteId"]').selectOption({index:1});await conversionDialog.locator('select[name="templateId"]').selectOption({index:1});await conversionDialog.locator('textarea[name="reason"]').fill('Abbinamento verificato');await conversionDialog.locator('input[type="checkbox"]').check();await conversionDialog.getByRole('button',{name:'Conferma',exact:true}).click();await conversionDialog.waitFor({state:'hidden'});
 await nav('Pacchetti ore').click();await page.getByRole('button',{name:'Conferma pagamento',exact:true}).click();await page.getByRole('button',{name:'Conferma operazione',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
 await nav('Flussi operativi').click();await page.getByRole('button',{name:'＋ Serie di interventi',exact:true}).click();const recurrenceDialog=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Serie di interventi',exact:true})});await recurrenceDialog.waitFor();await recurrenceDialog.locator('select[name="packageId"]').selectOption({index:1});await recurrenceDialog.locator('input[name="startDate"]').fill('2099-01-05');await recurrenceDialog.locator('input[name="localTime"]').fill('10:00');await recurrenceDialog.locator('input[name="weekdays"][value="1"]').check();await recurrenceDialog.locator('input[name="occurrenceCount"]').fill('3');await recurrenceDialog.locator('select[name="teamId"]').selectOption({index:1});await recurrenceDialog.locator('input[name="service"]').fill('Pulizia ricorrente');await recurrenceDialog.getByRole('button',{name:'Conferma',exact:true}).click();await recurrenceDialog.waitFor({state:'hidden'});
 const state=await page.evaluate(async()=>{const me=await(await fetch('/api/me')).json();return(await fetch('/api/state',{headers:{'X-Tenant-Context':me.user.tenantId}})).json()});assert.equal(state.interventions.length,3);assert.equal(state.packages[0].free,1020);
 await nav('Calendario').click();await page.locator('.calendar-shell').waitFor();await page.locator('.calendar-portal-top').getByRole('button',{name:'Chiudi'}).click();
 await nav('Avvisi').click();await page.getByText('Configura soglie',{exact:true}).click();await page.getByLabel('Saldo basso (minuti)').fill('1200');await page.getByRole('button',{name:'Salva soglie',exact:true}).click();await page.getByRole('heading',{name:'Saldo ore basso',exact:true}).waitFor();await page.getByRole('button',{name:'Segna come letto'}).click();await page.getByText('Letto',{exact:true}).waitFor();
 await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/operations-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'test-results/operations-mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('Browser operazioni OK: conversione, pagamento separato, serie, calendario, avvisi, KPI e mobile.');
}finally{if(browser)await browser.close();if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}await rm(dir,{recursive:true,force:true})}
