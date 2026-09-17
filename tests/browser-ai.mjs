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
 await page.locator('nav').getByRole('button',{name:/Assistente AI/}).click();await page.getByText('Manca OPENROUTER_API_KEY',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Invia richiesta',exact:true}).isEnabled(),false);
 await page.getByRole('button',{name:'Fatture scadute',exact:true}).click();await page.getByText('Nessun risultato per questa consultazione.',{exact:true}).waitFor();
 mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/ai-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'test-results/ai-mobile.png',fullPage:true});assert.deepEqual(errors,[]);
 console.log('Assistente: accesso, configurazione assente, consultazione reale, desktop e mobile verificati.');
}finally{await browser?.close();if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}rmSync(dir,{recursive:true,force:true});}
