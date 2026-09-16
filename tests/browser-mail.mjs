import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
// Modulo Playwright opzionale: percorso assoluto come primo argomento, oppure installazione locale.
const {chromium}=await import(process.argv[2]?pathToFileURL(resolve(process.argv[2])).href:'playwright');
const dir=mkdtempSync(join(tmpdir(),'myclean-browser-'));
const {connectStore,migrate}=await import('../server/storage.mjs');
const {provision}=await import('../server/auth.mjs');
const testStore=await connectStore({path:join(dir,'pg')});await migrate(testStore);await provision(testStore,{slug:'test-azienda',name:'Impresa test',email:'admin@example.com',password:'Password-browser-2026!'});await provision(testStore,{slug:'altra-azienda',name:'Altra impresa',email:'admin@example.com',password:'Password-browser-2026!'});await testStore.close();
const child=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,PORT:'3138',PGLITE_PATH:join(dir,'pg'),BOOTSTRAP_DEMO:'0',MAIL_MODE:'preview',PUBLIC_APP_URL:'http://localhost:3138'},stdio:['ignore','pipe','pipe']});
let browser;
try{
await once(child.stdout,'data');browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1100},locale:'it-IT'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://localhost:3138');await page.getByLabel('Codice azienda').fill('test-azienda');await page.getByLabel('Email',{exact:true}).fill('admin@example.com');await page.getByLabel('Password',{exact:true}).fill('Password-browser-2026!');await page.getByRole('button',{name:'Accedi',exact:true}).click();await page.getByText('Ore residue pagate',{exact:true}).waitFor();
mkdirSync('test-results',{recursive:true});
const nav=label=>page.locator('nav').getByRole('button',{name:new RegExp(label)});
await nav('Azienda e account').click();await page.getByLabel('Email aziendale',{exact:true}).fill('responsabile@example.com');await page.getByRole('button',{name:'Salva identità',exact:true}).click();await page.getByText('Modifiche salvate.',{exact:true}).waitFor();
await nav('Clienti').click();await page.getByRole('button',{name:'Nuovo cliente'}).click();await page.getByLabel('Nome cliente').fill('Cliente email browser');await page.getByLabel('Email',{exact:true}).fill('cliente@example.com');await page.getByRole('button',{name:'Salva',exact:true}).click();await page.getByRole('heading',{name:'Cliente email browser',exact:true}).waitFor();
await nav('Preventivi').click();await page.getByRole('button',{name:'Nuovo preventivo'}).click();await page.getByLabel('Cliente del preventivo').selectOption({label:'Cliente email browser'});await page.getByLabel('Oggetto').fill('Proposta con risposta online');await page.getByLabel('Descrizione voce 1').fill('Pulizia concordata');await page.getByLabel('Prezzo unitario voce 1',{exact:true}).fill('100');await page.getByLabel('IVA voce 1',{exact:true}).fill('22');await page.getByRole('button',{name:'Salva bozza',exact:true}).click();await page.locator('.quote-total').filter({hasText:'122,00'}).waitFor();
await page.getByRole('button',{name:'Invia via email',exact:true}).click();await page.getByLabel('Motivazione o riferimento').fill('Invio concordato');await page.getByRole('button',{name:'Conferma invio email',exact:true}).click();await page.getByRole('status').filter({hasText:'Email simulata'}).waitFor().catch(()=>page.getByText('Email simulata preparata.',{exact:false}).waitFor());
await nav('Email e notifiche').click();await page.getByText('Simulazione pronta',{exact:true}).waitFor();await page.getByRole('button',{name:'Apri email',exact:true}).click();const link=await page.getByRole('link',{name:'Apri pagina cliente'}).getAttribute('href');assert(link.startsWith('http://localhost:3138/#/risposta/'));
const emlDownload=page.waitForEvent('download');await page.getByRole('link',{name:'Scarica email con allegati (.eml)'}).click();await (await emlDownload).saveAs('test-results/email-preventivo.eml');
const customerContext=await browser.newContext({viewport:{width:390,height:844},locale:'it-IT'});const customer=await customerContext.newPage();customer.on('pageerror',e=>errors.push(e.message));await customer.goto(link+'?scelta=accepted');await customer.getByRole('heading',{name:'La tua risposta'}).waitFor();assert.equal((await customerContext.cookies()).length,0);
const download=customer.waitForEvent('download');await customer.getByRole('link',{name:'Scarica preventivo PDF'}).click();await (await download).saveAs('test-results/preventivo-cliente-email.pdf');
await customer.getByLabel('Nome e cognome').fill('Cliente prova');await customer.getByLabel('Note per l’impresa').fill('Accetto, concordiamo lunedì mattina.');await customer.getByLabel('Confermo di aver letto').check();await customer.screenshot({path:'test-results/risposta-cliente-mobile.png',fullPage:true});assert(await customer.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await customer.getByRole('button',{name:'Conferma e invia risposta'}).click();await customer.getByRole('heading',{name:'Risposta registrata'}).waitFor();await customer.reload();await customer.getByRole('heading',{name:'Risposta registrata'}).waitFor();
await page.getByRole('button',{name:'Chiudi anteprima'}).click();await page.locator('.notification-card').filter({hasText:'accettato'}).waitFor();await page.locator('.notification-card').getByText(/Accetto, concordiamo/).waitFor();await page.locator('.notification-card').getByRole('button',{name:'Segna come letta'}).click();await page.locator('.notification-card').getByText('Letta',{exact:true}).waitFor();await page.screenshot({path:'test-results/email-notifiche.png',fullPage:true});
await nav('Preventivi').click();await page.getByRole('button',{name:'Apri preventivo'}).click();await page.locator('.quote-document').getByText('Accettato',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Invia via email',exact:true}).count(),0);
await customerContext.close();assert.deepEqual(errors,[]);console.log('Browser email OK: simulazione, EML con PDF, collegamento anonimo, scelta preselezionata, conferma e note, aggiornamento app e notifica letta.');
}finally{if(browser)await browser.close();const done=once(child,'exit');child.kill();await done;rmSync(dir,{recursive:true,force:true})}
