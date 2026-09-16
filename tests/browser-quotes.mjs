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
const child=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,PORT:'3138',PGLITE_PATH:join(dir,'pg'),BOOTSTRAP_DEMO:'0'},stdio:['ignore','pipe','pipe']});
let browser;
try{
await once(child.stdout,'data');browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1100},locale:'it-IT'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://localhost:3138');await page.getByLabel('Codice azienda').fill('test-azienda');await page.getByLabel('Email',{exact:true}).fill('admin@example.com');await page.getByLabel('Password',{exact:true}).fill('Password-browser-2026!');await page.getByRole('button',{name:'Accedi',exact:true}).click();await page.getByText('Ore residue pagate',{exact:true}).waitFor();
mkdirSync('test-results',{recursive:true});
const nav=label=>page.locator('nav').getByRole('button',{name:new RegExp(label)});
await nav('Clienti').click();await page.getByRole('button',{name:'Nuovo cliente'}).click();await page.getByLabel('Nome cliente').fill('Cliente preventivi');await page.getByLabel('Indirizzo').fill('Via Prova 12');await page.getByRole('button',{name:'Salva',exact:true}).click();await page.getByRole('heading',{name:'Cliente preventivi',exact:true}).waitFor();
await nav('Preventivi').click();await page.getByRole('button',{name:'Nuovo preventivo'}).click();await page.getByLabel('Cliente del preventivo').selectOption({label:'Cliente preventivi'});await page.getByLabel('Oggetto').fill('Pulizie uffici');await page.getByLabel('Descrizione voce 1').fill('Pulizia periodica uffici');await page.getByLabel('Quantità voce 1',{exact:true}).fill('2.5');await page.getByLabel('Prezzo unitario voce 1',{exact:true}).fill('19.99');await page.getByLabel('Sconto voce 1',{exact:true}).fill('10');await page.getByLabel('IVA voce 1',{exact:true}).fill('22');await page.getByLabel('Condizioni e modalità').fill('Pagamento alla conferma');await page.getByRole('button',{name:'Salva bozza',exact:true}).click();await page.locator('.quote-total').filter({hasText:'54,88'}).waitFor();
await page.getByRole('button',{name:'Modifica bozza',exact:true}).click();await page.getByLabel('Oggetto').fill('Pulizie uffici e vetrate');await page.getByLabel('Motivazione della modifica').fill('Oggetto precisato');await page.getByRole('button',{name:'Salva bozza',exact:true}).click();await page.getByRole('heading',{name:'Pulizie uffici e vetrate',exact:true}).waitFor();
await page.screenshot({path:'test-results/preventivo-desktop.png',fullPage:true});await page.emulateMedia({media:'print'});assert(await page.locator('.quote-document th').last().isVisible());await page.screenshot({path:'test-results/preventivo-stampa.png',fullPage:true});await page.pdf({path:'test-results/preventivo.pdf',format:'A4',printBackground:true});await page.emulateMedia({media:'screen'});
await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/preventivo-mobile.png',fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
await page.getByRole('button',{name:'Registra invio',exact:true}).click();await page.getByLabel('Motivazione o riferimento').fill('Consegnato a mano');await page.getByRole('button',{name:'Conferma stato'}).click();await page.locator('.quote-document').getByText('Inviato',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Modifica bozza',exact:true}).count(),0);
await page.getByRole('button',{name:'Registra accettazione',exact:true}).click();await page.getByLabel('Motivazione o riferimento').fill('Accettazione telefonica');await page.getByRole('button',{name:'Conferma stato'}).click();await page.locator('.quote-document').getByText('Accettato',{exact:true}).waitFor();
await page.getByRole('button',{name:'Duplica preventivo',exact:true}).click();await page.getByRole('button',{name:'Salva bozza',exact:true}).click();await page.locator('.quote-document').getByText('Bozza',{exact:true}).waitFor();await page.getByRole('heading',{name:/PRE-.*0002/}).waitFor();
await page.getByRole('button',{name:'Annulla preventivo',exact:true}).click();await page.getByLabel('Motivazione o riferimento').fill('Proposta sostituita');await page.getByRole('button',{name:'Conferma stato'}).click();await page.locator('.quote-document').getByText('Annullato',{exact:true}).waitFor();
await page.getByRole('button',{name:'Elenco preventivi'}).click();await page.getByRole('button',{name:'Accettato',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Apri preventivo'}).count(),1);
await nav('Clienti').click();await page.getByRole('button',{name:'Apri scheda'}).click();await page.getByRole('heading',{name:'Preventivi del cliente'}).waitFor();assert.equal(await page.getByRole('button',{name:'Apri preventivo'}).count(),2);
await nav('Storico attività').click();await page.getByText('Accettazione telefonica',{exact:true}).waitFor();assert.deepEqual(errors,[]);console.log('Preventivi browser OK: bozza, righe e totali, modifica, stampa/PDF, mobile, invio, accettazione, copia, annullamento, scheda cliente e storico.');
}finally{if(browser)await browser.close();const done=once(child,'exit');child.kill();await done;rmSync(dir,{recursive:true,force:true})}
