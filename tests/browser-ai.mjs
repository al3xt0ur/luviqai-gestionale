import '../scripts/test-isolation.mjs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {connectStore,migrate} from '../server/storage.mjs';
import {provision} from '../server/auth.mjs';
const {chromium}=await import(process.argv[2]?pathToFileURL(resolve(process.argv[2])).href:'playwright');
const dir=mkdtempSync(join(tmpdir(),'luviq-ai-browser-'));
const db=await connectStore({path:join(dir,'pg')});await migrate(db);await provision(db,{slug:'ai-test',name:'Impresa AI test',email:'admin@example.com',password:'Password-browser-2026!'});await db.close();
const child=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,DATABASE_URL:'',OPENROUTER_API_KEY:'',PORT:'3139',APP_ORIGIN:'http://localhost:3139',PUBLIC_APP_URL:'http://localhost:3139',MAIL_MODE:'preview',BOOTSTRAP_DEMO:'0',PGLITE_PATH:join(dir,'pg')},stdio:['ignore','pipe','pipe']});
let browser;
try{
 await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('Avvio fallito')})]);
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:3139');await page.getByLabel('Codice azienda').fill('ai-test');await page.getByLabel('Email',{exact:true}).fill('admin@example.com');await page.getByLabel('Password',{exact:true}).fill('Password-browser-2026!');await page.getByRole('button',{name:'Accedi',exact:true}).click();
 await page.getByRole('button',{name:'Apri assistente AI',exact:true}).click();
 await page.getByText('Configura l’AI per il testo libero.',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Invia richiesta',exact:true}).isEnabled(),false);
 mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/ai-widget-desktop.png',fullPage:true,animations:'disabled'});
 await page.getByRole('button',{name:/Fatture scadute/}).click();await page.getByText('Nessun risultato per questa consultazione.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Riduci chat'}).click();assert.equal(await page.getByRole('dialog',{name:'Assistente luviqAI'}).count(),0);
 await page.locator('nav').getByRole('button',{name:/Clienti/}).click();await page.getByRole('button',{name:'Apri assistente AI',exact:true}).click();await page.getByText('Nessun risultato per questa consultazione.',{exact:true}).waitFor();
 await page.getByLabel('La tua richiesta').press('Escape');assert(await page.getByRole('button',{name:'Apri assistente AI',exact:true}).evaluate(el=>el===document.activeElement));
 // Verifica visiva delle proposte con risposte simulate, senza chiamare il provider.
 await page.route('**/api/ai/status',r=>r.fulfill({json:{enabled:true,model:'openrouter/free'}}));
 await page.route('**/api/ai/chat',r=>r.fulfill({json:{text:'Controlla la proposta prima di confermare.',proposal:{token:'test-only',title:'Pulizia ambienti',client:'Cliente fittizio',issueDate:'2026-09-17',validUntil:'2026-10-17',net:5000,tax:1100,total:6100,lines:[{description:'Pulizia ordinaria',quantity:200,unitPrice:2500,vat:2200,discount:0,total:6100}]}}}));
 let confirmations=0;await page.route('**/api/ai/confirm',r=>{confirmations++;return r.fulfill({json:{text:'Bozza PRE-TEST salvata.',quoteId:999}})});
 await page.getByRole('button',{name:'Apri assistente AI',exact:true}).click();await page.locator('.chat-consent input').check();await page.getByLabel('La tua richiesta').fill('Prepara preventivo fittizio');await page.getByRole('button',{name:'Invia richiesta',exact:true}).click();await page.getByRole('button',{name:'Conferma e salva bozza'}).waitFor();assert.equal(confirmations,0);
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'test-results/ai-widget-mobile.png',fullPage:true,animations:'disabled'});
 await page.getByRole('button',{name:'Conferma e salva bozza'}).click();await page.getByText('Bozza PRE-TEST salvata.').waitFor();assert.equal(confirmations,1);assert.deepEqual(errors,[]);
 console.log('Widget: consultazione reale, persistenza tra sezioni, riduzione, Escape/focus, proposta e conferma simulata, desktop/mobile verificati.');
}finally{await browser?.close();if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}rmSync(dir,{recursive:true,force:true});}
