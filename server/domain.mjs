import {normalizeLogo} from './logo.mjs';
import {changeQuote,calculateLines,today} from './quotes.mjs';
import { one, rows, tenantTransaction } from './storage.mjs';

export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const fail = (message, status = 400) => { throw new AppError(message, status); };
export function integer(value, min, max) {
  if (!['string','number'].includes(typeof value) || String(value).trim()==='') fail('Inserire un numero intero valido.');
  const n=Number(value);
  if (!Number.isSafeInteger(n)||n<min||n>max) fail(`Inserire un numero intero tra ${min} e ${max}.`);
  return n;
}
export function required(value, max=300) {
  if(typeof value!=='string'||!value.trim()||value.length>max) fail('Compilare i campi obbligatori con valori validi.');
  return value.trim();
}
export const camel = record => Object.fromEntries(Object.entries(record).filter(([k])=>k!=='tenant_id').map(([k,v])=>[k.replace(/_([a-z])/g,(_,c)=>c.toUpperCase()),v]));
const fields = {
  quotes: ['clientId','number','revision','status','issueDate','validUntil','document','net','tax','total','sourceId','created','updated'],
  invoices: ['clientId','quoteId','number','revision','status','issueDate','dueDate','document','net','tax','total','payment','paidAt','created','updated'],
  clients: ['name','email','phone','address','archived'],
  packages: ['clientId','tier','original','initial','rule','paid','renewedFrom','created','templateId','templateRevision','description'],
  package_templates: ['name','description','minutes','rule','active','revision'],
  jobs: ['clientId','quoteId','packageId','title','description','status','dueDate','revision','created','updated'],
  interventions: ['packageId','jobId','date','service','team','duration','operators','notes','status','assignedUserId'],
  audit: ['date','author','authorId','action','clientId','interventionId','beforeValue','afterValue','reason'],
};
const snake=s=>s.replace(/[A-Z]/g,c=>'_'+c.toLowerCase());

export async function insert(tx,tenantId,table,value,existingId) {
  if(!fields[table]) throw new Error('Tabella non valida');
  const id=existingId ?? (await one(tx,`SELECT coalesce(max(id),0)+1 AS id FROM ${table} WHERE tenant_id=$1`,[tenantId])).id;
  const keys=fields[table].filter(k=>value[k]!==undefined);
  const params=[tenantId,id,...keys.map(k=>value[k])];
  return camel(await one(tx,`INSERT INTO ${table}(tenant_id,id,${keys.map(snake).join(',')}) VALUES(${params.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`,params));
}

async function update(tx,tenantId,table,id,value) {
  const keys=fields[table].filter(k=>value[k]!==undefined);
  const result=await one(tx,`UPDATE ${table} SET ${keys.map((k,i)=>`${snake(k)}=$${i+3}`).join(',')} WHERE tenant_id=$1 AND id=$2 RETURNING *`,[tenantId,id,...keys.map(k=>value[k])]);
  if(!result)fail('Elemento non trovato.',404);
  return camel(result);
}

export async function snapshotTx(tx,tenantId) {
  const clients=(await rows(tx,'SELECT * FROM clients WHERE tenant_id=$1 ORDER BY name',[tenantId])).map(camel);
  const jobs=(await rows(tx,'SELECT * FROM jobs WHERE tenant_id=$1 ORDER BY id DESC',[tenantId])).map(camel);
  const interventions=(await rows(tx,'SELECT i.*,coalesce(p.client_id,j.client_id) AS client_id,p.rule FROM interventions i LEFT JOIN packages p ON p.tenant_id=i.tenant_id AND p.id=i.package_id LEFT JOIN jobs j ON j.tenant_id=i.tenant_id AND j.id=i.job_id WHERE i.tenant_id=$1 ORDER BY i.date DESC,i.id DESC',[tenantId])).map(camel).map(i=>({...i,cost:i.duration*(i.packageId?(i.rule==='operator'?i.operators:1):i.operators)}));
  const packages=(await rows(tx,'SELECT * FROM packages WHERE tenant_id=$1 ORDER BY id DESC',[tenantId])).map(camel).map(p=>{
    const list=interventions.filter(i=>i.packageId===p.id);
    const consumed=list.filter(i=>i.status==='approved').reduce((s,i)=>s+i.cost,0);
    const committed=list.filter(i=>['planned','pending'].includes(i.status)).reduce((s,i)=>s+i.cost,0);
    return {...p,consumed,committed,remaining:p.initial-consumed,free:p.initial-consumed-committed};
  });
  const audit=(await rows(tx,'SELECT * FROM audit WHERE tenant_id=$1 ORDER BY id DESC',[tenantId])).map(camel);
  const catalog=(await rows(tx,'SELECT * FROM package_templates WHERE tenant_id=$1 ORDER BY active DESC,name,id',[tenantId])).map(camel);
  const quotes=(await rows(tx,'SELECT * FROM quotes WHERE tenant_id=$1 ORDER BY id DESC',[tenantId])).map(camel);
  const invoices=(await rows(tx,'SELECT * FROM invoices WHERE tenant_id=$1 ORDER BY id DESC',[tenantId])).map(camel);
  const mail=(await rows(tx,"SELECT quote_id,status,mode FROM mail_messages WHERE tenant_id=$1 AND kind='quote' AND status<>'cancelled' ORDER BY created DESC",[tenantId]));
  for(const q of quotes){const m=mail.find(m=>m.quote_id===q.id);q.emailStatus=m?.status||null;q.emailMode=m?.mode||null;}
  const unreadNotifications=Number((await one(tx,'SELECT count(*) AS count FROM notifications WHERE tenant_id=$1 AND read_at IS NULL',[tenantId])).count);
  return {clients,packages,jobs,interventions,audit,catalog,quotes,invoices,unreadNotifications};
}

export async function snapshot(store,actor) {
  return tenantTransaction(store,actor.tenantId,async(tx,tenant)=>{
    const state=await snapshotTx(tx,actor.tenantId);
    if(actor.role==='operator') {
      state.interventions=state.interventions.filter(i=>i.assignedUserId===actor.id);
      state.packages=state.packages.filter(p=>state.interventions.some(i=>i.packageId===p.id));
      state.jobs=state.jobs.filter(j=>state.interventions.some(i=>i.jobId===j.id));
      state.clients=state.clients.filter(c=>state.packages.some(p=>p.clientId===c.id)||state.jobs.some(j=>j.clientId===c.id));
      state.audit=[];
      state.catalog=[];state.quotes=[];state.invoices=[];state.unreadNotifications=0;
    }
    return {...state,company:camel(tenant)};
  });
}

export async function mutate(store,actor,action,input,key) {
  if(!input||Array.isArray(input)||typeof input!=='object')fail('Richiesta non valida.');
  required(key,150);
  if(!['manager','platform_admin'].includes(actor.role)&&action!=='complete')fail('Il tuo account non può eseguire questa operazione.',403);
  if('tenantId' in input || 'tenant_id' in input) fail('L’azienda non può essere modificata nella richiesta.',403);
  return tenantTransaction(store,actor.tenantId,async(tx,tenant)=>{
    if(!tenant.active&&actor.role!=='platform_admin')fail('Azienda sospesa.',403);
    const t=actor.tenantId;
    const payload=JSON.stringify({action,input});
    const cached=await one(tx,'SELECT * FROM requests WHERE tenant_id=$1 AND user_id=$2 AND key=$3',[t,actor.id,key]);
    if(cached){if(cached.payload!==payload)fail('Identificativo richiesta già utilizzato.');return JSON.parse(cached.response);}
    const state=await snapshotTx(tx,t);
    const getC=id=>state.clients.find(c=>c.id===Number(id))||fail('Cliente non trovato.',404);
    const getP=id=>state.packages.find(p=>p.id===Number(id))||fail('Pacchetto non trovato.',404);
    const getJ=id=>state.jobs.find(j=>j.id===Number(id))||fail('Commessa non trovata.',404);
    const active=c=>{if(c.archived)fail('Il cliente è archiviato: ripristinalo prima di aggiungere attività.');};
    let before=null,after=null,clientId=null,interventionId=null;
    const reason=String(input.reason||'').trim();
    if(action==='job'||action==='job-status') {
      before=input.id?getJ(input.id):null;
      if(before&&integer(input.revision,1,1e9)!==before.revision)fail('La commessa è stata modificata. Ricarica i dati prima di continuare.',409);
      const now=new Date().toISOString();
      if(action==='job') {
        if(before&&!['draft','planned'].includes(before.status))fail('Solo le commesse in bozza o pianificate sono modificabili.');
        clientId=integer(input.clientId,1,1e9);const client=getC(clientId);active(client);
        let quote=null,pkg=null;
        if(input.quoteId){quote=state.quotes.find(q=>q.id===Number(input.quoteId))||fail('Preventivo non trovato.',404);if(quote.clientId!==clientId||quote.status!=='accepted')fail('La commessa può essere collegata solo a un preventivo accettato dello stesso cliente.');if(state.jobs.some(j=>j.quoteId===quote.id&&j.id!==before?.id&&j.status!=='cancelled'))fail('Esiste già una commessa attiva collegata a questo preventivo.');}
        if(input.packageId){pkg=getP(input.packageId);if(pkg.clientId!==clientId)fail('Il pacchetto deve appartenere allo stesso cliente.');}
        const title=required(input.title,200),description=String(input.description||'').trim();if(description.length>3000)fail('La descrizione non può superare 3000 caratteri.');
        let dueDate=null;if(input.dueDate){if(typeof input.dueDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)||!Number.isFinite(Date.parse(input.dueDate)))fail('Data scadenza commessa non valida.');dueDate=input.dueDate;}
        const value={clientId,quoteId:quote?.id||null,packageId:pkg?.id||null,title,description,dueDate,updated:now,revision:before?before.revision+1:1};
        after=before?await update(tx,t,'jobs',before.id,value):await insert(tx,t,'jobs',{...value,status:'draft',created:now});
      } else {
        if(!before)fail('Commessa non trovata.',404);required(reason,2000);clientId=before.clientId;
        const transitions={draft:['planned','cancelled'],planned:['active','cancelled'],active:['completed','cancelled'],completed:[],cancelled:[]};
        if(!transitions[before.status].includes(input.status))fail('Passaggio di stato commessa non consentito.');
        if(input.status==='completed'&&state.interventions.some(i=>i.jobId===before.id&&['planned','pending'].includes(i.status)))fail('Completa o annulla gli interventi aperti prima di chiudere la commessa.');
        after=await update(tx,t,'jobs',before.id,{status:input.status,revision:before.revision+1,updated:now});
      }
    } else if(action==='quote'||action==='quote-status') {
      ({before,after,clientId}=await changeQuote({tx,t,state,input,action,tenant,insert,update}));
    } else if(action==='client') {
      const value={name:required(input.name),email:String(input.email||'').trim(),phone:String(input.phone||'').trim(),address:String(input.address||'').trim()};
      if(Object.values(value).some(v=>v.length>500))fail('Uno dei campi è troppo lungo.');
      if(value.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email))fail('Indirizzo email non valido.');
      if(input.id){before=getC(input.id);after=await update(tx,t,'clients',before.id,value);} else after=await insert(tx,t,'clients',value);
      clientId=after.id;
    } else if(action==='archive'||action==='restore') {
      before=getC(input.id);clientId=before.id;required(reason,2000);
      if(action==='archive') {
        if(before.archived)fail('Cliente già archiviato.');
        if(state.packages.some(p=>p.clientId===clientId&&p.remaining>0)||state.interventions.some(i=>i.clientId===clientId&&['planned','pending'].includes(i.status)))fail('Il cliente ha ore residue o interventi aperti. Completa la gestione prima di archiviarlo.');
      } else if(!before.archived)fail('Il cliente è già attivo.');
      after=await update(tx,t,'clients',clientId,{archived:action==='archive'});
    } else if(action==='template'||action==='template-status') {
      if(input.id) {
        before=state.catalog.find(p=>p.id===Number(input.id))||fail('Modello non trovato.',404);
        if(integer(input.revision,1,1e9)!==before.revision)fail('Il modello è stato modificato. Chiudi e riapri il catalogo per aggiornare i dati.',409);
      }
      if(action==='template-status') {
        if(!before||typeof input.active!=='boolean')fail('Stato del modello non valido.');
        required(reason,2000);
        if(input.active===before.active)fail('Il modello ha già questo stato.');
        after=await update(tx,t,'package_templates',before.id,{active:input.active,revision:before.revision+1});
      } else {
        const name=required(input.name,120),minutes=integer(input.minutes,1,600000);
        if(!['operator','team'].includes(input.rule))fail('Regola di conteggio non valida.');
        if(state.catalog.some(p=>p.id!==before?.id&&p.name.toLocaleLowerCase()===name.toLocaleLowerCase()))fail('Esiste già un modello con questo nome, anche tra quelli disattivati.');
        const description=String(input.description||'').trim();if(description.length>1000)fail('La descrizione non può superare 1000 caratteri.');
        const value={name,minutes,rule:input.rule,description,revision:before?before.revision+1:1};
        if(before){required(reason,2000);after=await update(tx,t,'package_templates',before.id,value);} else after=await insert(tx,t,'package_templates',value);
      }
    } else if(action==='package') {
      clientId=integer(input.clientId,1,1e9);active(getC(clientId));
      const template=state.catalog.find(p=>p.id===Number(input.templateId))||fail('Seleziona un modello del catalogo aziendale.');
      if(!template.active)fail('Il modello è disattivato. Seleziona un’offerta attiva.');
      if(integer(input.templateRevision,1,1e9)!==template.revision)fail('Il modello è cambiato. Chiudi e riapri il modulo per verificare le nuove condizioni.',409);
      const original=template.minutes,initial=integer(input.initial,0,original);
      const previous=input.renewedFrom?getP(input.renewedFrom):null;
      if(previous&&previous.clientId!==clientId)fail('Il rinnovo deve appartenere allo stesso cliente.');
      after=await insert(tx,t,'packages',{clientId,tier:template.name,original,initial,rule:template.rule,description:template.description,templateId:template.id,templateRevision:template.revision,paid:input.paid===true?1:0,renewedFrom:previous?.id||null,created:new Date().toISOString()});
    } else if(action==='pay') {
      before=getP(input.id);clientId=before.clientId;active(getC(clientId));if(before.paid)fail('Pagamento già confermato.');
      after=await update(tx,t,'packages',before.id,{paid:1});
    } else if(action==='intervention') {
      let job=input.jobId?getJ(input.jobId):null,p=input.packageId?getP(input.packageId):null;
      if(job&&['completed','cancelled'].includes(job.status))fail('La commessa non è aperta.');
      if(!p&&job?.packageId)p=getP(job.packageId);
      if(!p&&!job)fail('Seleziona una commessa o un pacchetto.');
      clientId=job?.clientId||p.clientId;active(getC(clientId));
      if(job&&p&&job.clientId!==p.clientId)fail('Commessa e pacchetto devono appartenere allo stesso cliente.');
      if(job?.packageId&&p&&job.packageId!==p.id)fail('La commessa è collegata a un altro pacchetto.');
      if(p&&!p.paid)fail('Confermare il pagamento prima di inserire interventi.');
      const duration=integer(input.duration,1,3600),operators=integer(input.operators,1,100);
      const date=new Date(required(input.date));if(!Number.isFinite(date.getTime()))fail('Data non valida.');
      if(!['planned','pending'].includes(input.status))fail('Stato non valido.');
      if(input.status==='pending'&&date.getTime()>Date.now())fail('Un intervento futuro può essere solo pianificato.');
      if(p&&duration*(p.rule==='operator'?operators:1)>p.free)fail('Ore libere insufficienti per questo intervento.');
      if(input.assignedUserId&&!actor.assignableUserIds?.includes(input.assignedUserId))fail('Operatore non disponibile per questa azienda.');
      after=await insert(tx,t,'interventions',{packageId:p?.id||null,jobId:job?.id||null,date:date.toISOString(),service:required(input.service),team:required(input.team),duration,operators,notes:String(input.notes||'').slice(0,3000),status:input.status,assignedUserId:input.assignedUserId||null});
      interventionId=after.id;
    } else if(['complete','approve','rectify','cancel','reschedule'].includes(action)) {
      before=state.interventions.find(i=>i.id===Number(input.id))||fail('Intervento non trovato.',404);
      if(actor.role==='operator'&&before.assignedUserId!==actor.id)fail('Intervento non assegnato al tuo account.',403);
      interventionId=before.id;clientId=before.clientId;const p=before.packageId?getP(before.packageId):null;
      if(p&&!p.paid)fail('Pacchetto non pagato.');if(before.status==='cancelled')fail('Intervento già annullato.');
      if(action==='cancel') {
        required(reason,2000);after=await update(tx,t,'interventions',before.id,{status:'cancelled'});
      } else if(action==='reschedule') {
        if(before.status!=='planned')fail('Puoi ripianificare solo un intervento pianificato.');required(reason,2000);
        const date=new Date(required(input.date));if(!Number.isFinite(date.getTime()))fail('Data non valida.');
        after=await update(tx,t,'interventions',before.id,{date:date.toISOString()});
      } else {
        if(new Date(before.date).getTime()>Date.now())fail('Non è possibile completare o approvare un intervento futuro.');
        if(action==='approve') {
          if(before.status!=='pending')fail('Solo un intervento da approvare può essere approvato.');
          after=await update(tx,t,'interventions',before.id,{status:'approved'});
        } else {
          if(action==='complete'&&before.status!=='planned')fail('Solo un intervento pianificato può essere completato.');
          if(action==='rectify'&&before.status!=='approved')fail('Solo un intervento approvato può essere rettificato.');
          if(action==='rectify')required(reason,2000);
          const duration=integer(input.duration,1,3600),operators=integer(input.operators,1,100);
          if(p&&duration*(p.rule==='operator'?operators:1)>p.free+before.cost)fail('Ore libere insufficienti per la nuova durata e il numero di operatori.');
          after=await update(tx,t,'interventions',before.id,{duration,operators,status:action==='complete'?'pending':'approved'});
        }
      }
    } else if(action==='invoice'||action==='invoice-status'||action==='invoice-payment') {
      const invoiceDay=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)fail('Data fattura non valida.');return value;};
      before=input.id?state.invoices.find(i=>i.id===Number(input.id))||fail('Fattura non trovata.',404):null;
      if(before&&integer(input.revision,1,1e9)!==before.revision)fail('La fattura è stata modificata. Ricarica i dati prima di continuare.',409);
      const now=new Date().toISOString();
      if(action==='invoice') {
        if(before&&before.status!=='draft')fail('Solo le fatture in bozza sono modificabili.');
        clientId=integer(input.clientId,1,1e9);const client=getC(clientId);active(client);
        const issueDate=invoiceDay(input.issueDate),dueDate=invoiceDay(input.dueDate);if(dueDate<issueDate)fail('La scadenza non può precedere la data di emissione.');
        const {lines,net,tax,total}=calculateLines(input.lines);
        const title=required(input.title,200),notes=String(input.notes||'').trim();if(notes.length>2000)fail('Le note possono contenere al massimo 2000 caratteri.');
        let quote=null;
        if(input.quoteId){quote=state.quotes.find(q=>q.id===Number(input.quoteId))||fail('Preventivo non trovato.',404);if(quote.clientId!==clientId||quote.status!=='accepted')fail('La fattura può essere collegata solo a un preventivo accettato dello stesso cliente.');if(state.invoices.some(i=>i.quoteId===quote.id&&i.id!==before?.id&&i.status!=='cancelled'))fail('Esiste già una fattura attiva collegata a questo preventivo.');}
        const document=JSON.stringify({title,notes,lines,client,company:camel(tenant)});
        const value={clientId,quoteId:quote?.id||null,issueDate,dueDate,document,net,tax,total,updated:now,revision:before?before.revision+1:1};
        if(before){required(reason,2000);after=await update(tx,t,'invoices',before.id,value);}else{const id=(await one(tx,'SELECT coalesce(max(id),0)+1 AS id FROM invoices WHERE tenant_id=$1',[t])).id;after=await insert(tx,t,'invoices',{...value,number:`FAT-${issueDate.slice(0,4)}-${String(id).padStart(4,'0')}`,status:'draft',payment:JSON.stringify({}),paidAt:null,created:now},id);}
      } else if(action==='invoice-status') {
        if(!before)fail('Fattura non trovata.',404);required(reason,2000);
        const allowed=before.status==='draft'?['issued','cancelled']:before.status==='issued'?['cancelled']:[];
        if(!allowed.includes(input.status))fail('Passaggio di stato fattura non consentito.');
        if(input.status==='issued'&&before.issueDate>today())fail('Non puoi emettere una fattura con data futura.');
        after=await update(tx,t,'invoices',before.id,{status:input.status,revision:before.revision+1,updated:now});clientId=before.clientId;
      } else {
        if(!before||before.status!=='issued')fail('Puoi registrare il pagamento solo su una fattura emessa.');
        const paymentDate=invoiceDay(input.paymentDate);if(paymentDate>today())fail('La data del pagamento non può essere futura.');
        const method=required(input.method,80),reference=String(input.reference||'').trim();if(reference.length>300)fail('Riferimento pagamento troppo lungo.');
        after=await update(tx,t,'invoices',before.id,{status:'paid',revision:before.revision+1,payment:JSON.stringify({date:paymentDate,method,reference}),paidAt:new Date(paymentDate+'T12:00:00Z').toISOString(),updated:now});clientId=before.clientId;
      }
    } else if(action==='company') {
      const name=required(input.name),logoText=required(input.logoText,10),color=required(input.brandColor,7);
      if(!/^#[0-9a-f]{6}$/i.test(color))fail('Colore non valido.');
      const address=String(input.address||'').slice(0,500),email=String(input.email||'').slice(0,300);
      const logoData=input.logoData===undefined?tenant.logo_data:await normalizeLogo(input.logoData);
      const phone=String(input.phone??tenant.phone).trim(),website=String(input.website??tenant.website).trim(),taxId=String(input.taxId??tenant.tax_id).trim();
      if(phone.length>80||website.length>200||taxId.length>100)fail('Recapiti aziendali troppo lunghi.');
      before=camel(tenant);
      after=camel(await one(tx,'UPDATE tenants SET name=$2,logo_text=$3,brand_color=$4,address=$5,email=$6,logo_data=$7,phone=$8,website=$9,tax_id=$10 WHERE id=$1 RETURNING *',[t,name,logoText,color,address,email,logoData,phone,website,taxId]));
    } else fail('Operazione sconosciuta.');
    await insert(tx,t,'audit',{date:new Date().toISOString(),author:actor.name,authorId:actor.id,action,clientId,interventionId,beforeValue:JSON.stringify(before),afterValue:JSON.stringify(after),reason});
    const result={ok:true,value:after};
    await tx.query('INSERT INTO requests(tenant_id,user_id,key,payload,response) VALUES($1,$2,$3,$4,$5)',[t,actor.id,key,payload,JSON.stringify(result)]);
    return result;
  });
}
