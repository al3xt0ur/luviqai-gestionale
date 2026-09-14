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
const child=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,PORT:'3138',DB_PATH:join(dir,'test.sqlite')},stdio:['ignore','pipe','pipe']});
let browser;
try{
await once(child.stdout,'data');browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1100},locale:'it-IT'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://localhost:3138');await page.getByText('Ore residue pagate',{exact:true}).waitFor();
mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/desktop.png',fullPage:true});
const nav=label=>page.locator('nav').getByRole('button',{name:new RegExp(label)});
await nav('Clienti').click();await page.getByRole('button',{name:'Nuovo cliente'}).click();await page.getByLabel('Nome cliente').fill('Cliente prova browser');await page.getByLabel('Email',{exact:true}).fill('prova@example.com');await page.getByLabel('Telefono').fill('000 000000');await page.getByLabel('Indirizzo').fill('Via Fittizia 99');await page.getByRole('button',{name:'Salva',exact:true}).click();await page.getByRole('heading',{name:'Cliente prova browser',exact:true}).waitFor();
await page.getByLabel('Cerca cliente').fill('Cliente prova browser');await page.getByRole('button',{name:'Apri scheda'}).click();await page.getByRole('button',{name:'Modifica cliente'}).click();await page.getByLabel('Telefono').fill('000 111111');await page.getByRole('button',{name:'Salva',exact:true}).click();await page.locator('.contact-panel').filter({hasText:'000 111111'}).waitFor();
await page.getByRole('button',{name:'＋ Pacchetto',exact:true}).click();await page.getByLabel('Saldo iniziale').fill('60');await page.getByLabel('Confermo che il pagamento').check();await page.getByRole('button',{name:'Salva',exact:true}).click();await page.locator('.package').waitFor();
await page.getByRole('button',{name:'Stampa riepilogo'}).waitFor();await page.emulateMedia({media:'print'});await page.pdf({path:'test-results/riepilogo.pdf',format:'A4',printBackground:true});await page.emulateMedia({media:'screen'});
await nav('Interventi').click();await page.getByRole('button',{name:'Nuovo intervento'}).click();await page.getByLabel('Cliente *').selectOption({label:'Cliente prova browser'});const select=page.getByLabel('Pacchetto pagato');const options=await select.locator('option').allTextContents();await select.selectOption({label:options[1]});await page.getByLabel('Data e ora').fill(new Date(Date.now()-86400000).toISOString().slice(0,16));await page.getByLabel('Servizio').fill('Pulizia test browser');await page.getByLabel('Operatore o squadra').fill('Squadra demo');await page.getByLabel('Durata in minuti').fill('120');await page.getByRole('button',{name:'Salva',exact:true}).click();await page.getByRole('alert').filter({hasText:'Ore libere insufficienti'}).waitFor();await page.getByLabel('Durata in minuti').fill('20');await page.getByLabel('Numero operatori').fill('2');await page.getByRole('button',{name:'Salva',exact:true}).click();
const row=page.locator('tr').filter({hasText:'Pulizia test browser'});await row.getByRole('button',{name:'Completa',exact:true}).click();await page.getByLabel('Durata in minuti').fill('20');await page.getByRole('button',{name:'Salva',exact:true}).click();await row.getByRole('button',{name:'Approva',exact:true}).click();assert((await page.locator('.approval').innerText()).includes('0,67 h'));await page.getByRole('button',{name:'Conferma operazione'}).click();await row.getByRole('button',{name:'Rettifica'}).click();await page.getByLabel('Durata in minuti').fill('15');await page.getByLabel('Motivazione obbligatoria').fill('Verifica durata effettiva');await page.getByRole('button',{name:'Conferma operazione'}).click();await row.getByRole('button',{name:'Annulla',exact:true}).click();await page.getByLabel('Motivazione obbligatoria').fill('Annullamento test browser');await page.getByRole('button',{name:'Conferma operazione'}).click();await row.getByText('Annullato',{exact:true}).waitFor();
await nav('Pacchetti ore').click();const card=page.locator('.package').filter({hasText:'Cliente prova browser'});assert((await card.locator('.balance').innerText()).includes('1 h'));await card.getByRole('button',{name:'Rinnova'}).click();await page.getByRole('button',{name:'Salva',exact:true}).click();await page.waitForFunction(()=>Array.from(document.querySelectorAll('.package')).filter(el=>el.textContent.includes('Cliente prova browser')).length===2);
await nav('Storico attività').click();await page.getByText('Verifica durata effettiva',{exact:true}).waitFor();const download=page.waitForEvent('download');await page.getByRole('link',{name:'Esporta CSV'}).click();assert.equal((await download).suggestedFilename(),'myclean-esportazione.csv');
await nav('Panoramica').click();await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/mobile.png',fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await page.getByRole('button',{name:'Nuovo intervento'}).click();await page.screenshot({path:'test-results/mobile-form.png',fullPage:true});await page.getByRole('button',{name:'Chiudi',exact:true}).click();assert.deepEqual(errors,[]);console.log('Browser OK: creazione/modifica cliente, pacchetto importato, disponibilità, completamento, approvazione, rettifica, annullamento, rinnovo, CSV, stampa, mobile.');
}finally{if(browser)await browser.close();const done=once(child,'exit');child.kill();await done;rmSync(dir,{recursive:true,force:true})}




