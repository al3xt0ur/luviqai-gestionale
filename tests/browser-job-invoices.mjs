import '../scripts/test-isolation.mjs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {connectStore,migrate} from '../server/storage.mjs';
import {provision} from '../server/auth.mjs';
import {mutate} from '../server/domain.mjs';
import {today} from '../server/quotes.mjs';
const {chromium}=await import(process.argv[2]?pathToFileURL(resolve(process.argv[2])).href:'playwright');
const dir=mkdtempSync(join(tmpdir(),'luviq-job-invoices-'));
const db=await connectStore({path:join(dir,'pg')});await migrate(db);
const actor=await provision(db,{slug:'billing',name:'Billing test',email:'admin@example.com',password:'Password-browser-2026!'});
const run=(action,input)=>mutate(db,actor,action,input,crypto.randomUUID());
const client=(await run('client',{name:'Cliente fatturazione'})).value;
let quote=(await run('quote',{clientId:client.id,title:'Oggetto preventivo',issueDate:today(),validUntil:today(),lines:[{description:'Pulizia concordata',quantity:250,unitPrice:12345,vat:2200,discount:1000}]})).value;
for(const status of ['sent','accepted'])quote=(await run('quote-status',{id:quote.id,revision:quote.revision,status,reason:'Conferma'})).value;
let unrelatedQuote=(await run('quote',{clientId:client.id,title:'Altro preventivo',issueDate:today(),validUntil:today(),lines:[{description:'Altro servizio',quantity:100,unitPrice:999,vat:2200}]})).value;
for(const status of ['sent','accepted'])unrelatedQuote=(await run('quote-status',{id:unrelatedQuote.id,revision:unrelatedQuote.revision,status,reason:'Conferma'})).value;
async function job(title,quoteId){
 let j=(await run('job',{clientId:client.id,title,quoteId})).value;
 for(const status of ['planned','active','completed'])j=(await run('job-status',{id:j.id,revision:j.revision,status,reason:'Avanzamento'})).value;
 return j;
}
const quoted=await job('Lavoro preventivato',quote.id),manual=await job('Lavoro manuale',null);
await db.close();
const port='3147',origin='http://localhost:'+port;
const child=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,PORT:port,PGLITE_PATH:join(dir,'pg'),BOOTSTRAP_DEMO:'0',MAIL_MODE:'preview',PUBLIC_APP_URL:origin},stdio:['ignore','pipe','pipe']});
let browser,page;
try{
 await once(child.stdout,'data');browser=await chromium.launch({channel:'chrome',headless:true});
 page=await browser.newPage({viewport:{width:1440,height:1100},locale:'it-IT'});
 page.setDefaultTimeout(10000);
 const invoiceRequests=[];page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/invoice')invoiceRequests.push(r.postDataJSON());});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);await page.getByLabel('Codice azienda').first().fill('billing');await page.getByLabel('Email',{exact:true}).first().fill('admin@example.com');await page.getByLabel('Password',{exact:true}).fill('Password-browser-2026!');await page.getByRole('button',{name:'Accedi',exact:true}).click();
 await page.getByText('Ore residue pagate',{exact:true}).waitFor();
 const jobs=()=>page.locator('nav').getByRole('button',{name:/Lavori/}).click();
 const row=title=>page.locator('tr').filter({hasText:title});
 await jobs();await row(quoted.title).getByRole('button',{name:'Crea fattura →',exact:true}).click();
 await page.getByRole('heading',{name:'Nuova fattura',exact:true}).waitFor();
 await page.getByText(`Da lavoro #${quoted.id} · ${quoted.title}`,{exact:true}).waitFor();
 assert.equal(await page.getByRole('combobox',{name:/^Cliente/}).inputValue(),String(client.id));
 assert.equal(await page.getByRole('combobox',{name:/^Da preventivo accettato/}).inputValue(),String(quote.id));
 assert.equal(await page.getByLabel('Oggetto *',{exact:true}).inputValue(),quote.document.title);
 assert.equal(await page.getByLabel('Descrizione *').inputValue(),'Pulizia concordata');
 assert.equal(await page.getByLabel('Quantità',{exact:true}).inputValue(),'2.5');
 assert.equal(await page.getByLabel('Prezzo unitario €',{exact:true}).inputValue(),'123.45');
 assert.equal(await page.getByLabel('Sconto %',{exact:true}).inputValue(),'10');
 // Regression: real select changes must preserve the job through rejection, clearing and reselection.
 const quoteSelect=page.getByRole('combobox',{name:/^Da preventivo accettato/});
 async function changeJobQuote(){
  const title=await page.getByLabel('Oggetto *',{exact:true}).inputValue();
  await quoteSelect.selectOption(String(unrelatedQuote.id));
  await page.getByText('Il preventivo selezionato non è compatibile con questo lavoro. Il collegamento al lavoro è stato mantenuto.',{exact:true}).waitFor();
  assert.equal(await quoteSelect.inputValue(),String(quote.id));
  assert.equal(await page.getByLabel('Oggetto *',{exact:true}).inputValue(),title);
  await quoteSelect.selectOption('');
  await page.getByText(`Da lavoro #${quoted.id} · ${quoted.title}`,{exact:true}).waitFor();
  await quoteSelect.selectOption(String(quote.id));
  await page.getByText(`Da lavoro #${quoted.id} · ${quoted.title}`,{exact:true}).waitFor();
  assert.equal(await page.locator('.alert.error').count(),0);
 }
 await changeJobQuote();
 const customDueDate=new Date(Date.now()+45*86400000).toISOString().slice(0,10);
 await page.getByLabel('Scadenza *',{exact:true}).fill(customDueDate);
 await changeJobQuote();
 assert.equal(await page.getByLabel('Scadenza *',{exact:true}).inputValue(),customDueDate);
 await page.getByRole('button',{name:'Salva bozza',exact:true}).click();await page.locator('.quote-document').waitFor();
 assert.equal(invoiceRequests.at(-1).jobId,quoted.id);assert.equal(invoiceRequests.at(-1).quoteId,quote.id);
 await page.getByText(`Da lavoro #${quoted.id} · ${quoted.title}`,{exact:true}).waitFor();
 const number=await page.locator('.quote-document h2').first().innerText();
 await jobs();await row(quoted.title).getByRole('button',{name:'Apri fattura →',exact:true}).click();
 await page.getByRole('heading',{name:number,exact:true}).waitFor();assert.equal(await page.locator('.quote-editor').count(),0);
 // Repeat on a saved invoice: the request must update the same invoice, retaining its job.
 const createdState=await (await page.request.get(origin+'/api/state',{headers:{'X-Tenant-Context':actor.tenantId}})).json();
 const createdInvoice=createdState.invoices.find(i=>i.jobId===quoted.id);
 await page.locator('.action-menu summary').click();await page.getByRole('button',{name:'Modifica',exact:true}).click();
 await changeJobQuote();
 await page.getByLabel('Motivazione modifica *').fill('Verifica cambio preventivo');
 await page.getByRole('button',{name:'Salva bozza',exact:true}).click();await page.locator('.quote-document').waitFor();
 assert.equal(invoiceRequests.at(-1).jobId,quoted.id);assert.equal(invoiceRequests.at(-1).id,createdInvoice.id);
 assert.equal(invoiceRequests.at(-1).revision,createdInvoice.revision);

 // The consumed navigation must not reopen the editor on a subsequent ordinary visit.
 await jobs();await row(manual.title).getByRole('button',{name:'Crea fattura →',exact:true}).click();
 await page.getByRole('heading',{name:'Nuova fattura',exact:true}).waitFor();
 assert.equal(await page.getByLabel('Oggetto *',{exact:true}).inputValue(),manual.title);
 assert.equal(await page.getByLabel('Descrizione *').inputValue(),manual.title);
 assert.equal(await page.getByRole('combobox',{name:/^Da preventivo accettato/}).inputValue(),'');
 await quoteSelect.selectOption(String(unrelatedQuote.id));
 await page.getByText('Il preventivo selezionato non è compatibile con questo lavoro. Il collegamento al lavoro è stato mantenuto.',{exact:true}).waitFor();
 assert.equal(await quoteSelect.inputValue(),'');
 await page.getByText(`Da lavoro #${manual.id} · ${manual.title}`,{exact:true}).waitFor();

 await page.getByLabel('Descrizione *').fill('Descrizione modificata');await page.getByLabel('Prezzo unitario €',{exact:true}).fill('80');
 await page.getByRole('button',{name:'Salva bozza',exact:true}).click();await page.locator('.quote-document').waitFor();await page.getByText('Descrizione modificata',{exact:true}).waitFor();
 await page.locator('.action-menu summary').click();await page.getByRole('button',{name:'Modifica',exact:true}).click();
 await page.getByText(`Da lavoro #${manual.id} · ${manual.title}`,{exact:true}).waitFor();
 await page.getByLabel('Oggetto *',{exact:true}).fill('Lavoro manuale aggiornato');await page.getByLabel('Motivazione modifica *').fill('Aggiornamento oggetto');await page.getByRole('button',{name:'Salva bozza',exact:true}).click();await page.locator('.quote-document').waitFor();
 await jobs();await page.locator('nav').getByRole('button',{name:/Amministrazione/}).click();
 await page.getByRole('button',{name:'＋ Nuova fattura',exact:true}).click();
 assert.equal(await page.getByRole('combobox',{name:/^Cliente/}).isEnabled(),true);
 assert.equal(await page.getByRole('combobox',{name:/^Cliente/}).inputValue(),'');
 assert.equal(await page.getByText(/Da lavoro #/).count(),0);
 const state=await (await page.request.get(origin+'/api/state',{headers:{'X-Tenant-Context':actor.tenantId}})).json();
 assert.equal(state.invoices.find(i=>i.id===createdInvoice.id).jobId,quoted.id);assert.deepEqual(state.invoices.find(i=>i.id===createdInvoice.id).document.job,{id:quoted.id,title:quoted.title});assert.equal(state.invoices.filter(i=>i.jobId===quoted.id).length,1);assert.equal(state.invoices.filter(i=>i.jobId===manual.id).length,1);
 assert.deepEqual(errors,[]);console.log('Browser OK: lavoro con preventivo, bozza manuale, modifica, apertura esistente, consumo navigazione e jobId preservato dopo cambio preventivo in creazione/modifica.');
}catch(error){
 console.error(error);if(page)console.error(await page.locator('body').innerText());throw error;
}finally{
 if(browser)await browser.close();const done=once(child,'exit');child.kill();await done;
 const target=resolve(dir);assert(target.startsWith(resolve(tmpdir())+String.fromCharCode(92))||target.startsWith(resolve(tmpdir())+'/'));rmSync(target,{recursive:true,force:true});
}
