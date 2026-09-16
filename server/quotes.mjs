import {fail,integer,required,camel} from './domain.mjs';
import {one} from './storage.mjs';

export const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Rome'}).format(new Date());
function day(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)fail('Data del preventivo non valida.');return value;}
const round=(n,d)=>Number((BigInt(n)+BigInt(d)/2n)/BigInt(d));
export function calculateLines(items){
  if(!Array.isArray(items)||items.length<1||items.length>30)fail('Inserisci da 1 a 30 voci nel preventivo.');
  const lines=items.map(l=>{
    if(!l||typeof l!=='object')fail('Voce non valida.');
    const description=required(l.description,500),quantity=integer(l.quantity,1,1000000),unitPrice=integer(l.unitPrice,0,10000000),vat=integer(l.vat,0,10000),discount=integer(l.discount??0,0,10000);
    const gross=round(quantity*unitPrice,100),net=round(gross*(10000-discount),10000),tax=round(net*vat,10000);
    return {description,quantity,unitPrice,vat,discount,net,tax,total:net+tax};
  });
  const net=lines.reduce((s,l)=>s+l.net,0),tax=lines.reduce((s,l)=>s+l.tax,0),total=net+tax;
  if(total>1000000000)fail('Il totale massimo per preventivo è 10 milioni di euro.');
  return {lines,net,tax,total};
}
export async function changeQuote({tx,t,state,input,action,tenant,insert,update}){
  let before=null,after;
  if(input.id){before=state.quotes.find(q=>q.id===Number(input.id))||fail('Preventivo non trovato.',404);if(integer(input.revision,1,1e9)!==before.revision)fail('Il preventivo è stato modificato. Ricarica i dati prima di continuare.',409);}
  if(before&&await one(tx,"SELECT id FROM mail_messages WHERE tenant_id=$1 AND quote_id=$2 AND kind='quote' AND status IN ('queued','sending','uncertain')",[t,before.id]))fail('Invio email in corso o da verificare. Controlla Email e notifiche prima di modificare il preventivo.');
  const now=new Date().toISOString();
  if(action==='quote'){
    if(before&&before.status!=='draft')fail('Solo le bozze sono modificabili. Duplica il preventivo per preparare una nuova proposta.');
    const clientId=integer(input.clientId,1,1e9),client=state.clients.find(c=>c.id===clientId)||fail('Cliente non trovato.',404);
    if(client.archived)fail('Ripristina il cliente prima di preparare un preventivo.');
    const issueDate=day(input.issueDate),validUntil=day(input.validUntil);if(validUntil<issueDate)fail('La scadenza non può precedere la data del preventivo.');
    const {lines,net,tax,total}=calculateLines(input.lines);
    const title=required(input.title,200),notes=String(input.notes||'').trim(),terms=String(input.terms||'').trim();
    if(notes.length>2000||terms.length>2000)fail('Note e condizioni possono contenere al massimo 2000 caratteri ciascuna.');
    const document=JSON.stringify({title,notes,terms,lines,client,company:camel(tenant)});
    const value={clientId,issueDate,validUntil,document,net,tax,total,updated:now,revision:before?before.revision+1:1};
    if(before){required(input.reason,2000);after=await update(tx,t,'quotes',before.id,value);}
    else {
      let source=null;if(input.sourceId)source=state.quotes.find(q=>q.id===Number(input.sourceId))||fail('Preventivo di origine non trovato.',404);
      const id=(await one(tx,'SELECT coalesce(max(id),0)+1 AS id FROM quotes WHERE tenant_id=$1',[t])).id;
      after=await insert(tx,t,'quotes',{...value,number:`PRE-${issueDate.slice(0,4)}-${String(id).padStart(4,'0')}`,status:'draft',sourceId:source?.id||null,created:now},id);
    }
  } else {
    if(!before)fail('Preventivo non trovato.',404);
    required(input.reason,2000);
    const transitions={draft:['sent','cancelled'],sent:['accepted','rejected','cancelled'],accepted:['cancelled'],rejected:[],cancelled:[]};
    if(!transitions[before.status].includes(input.status))fail('Passaggio di stato non consentito.');
    if(['sent','accepted'].includes(input.status)&&state.clients.find(c=>c.id===before.clientId)?.archived)fail('Ripristina il cliente prima di inviare o accettare un preventivo.');
    if(['sent','accepted'].includes(input.status)&&(before.validUntil<today()||before.issueDate>today()))fail('Verifica la data e la validità del preventivo: non può essere futuro o scaduto. Duplica la proposta per aggiornarla.');
    after=await update(tx,t,'quotes',before.id,{status:input.status,revision:before.revision+1,updated:now});
  }
  return {before,after,clientId:after.clientId};
}
