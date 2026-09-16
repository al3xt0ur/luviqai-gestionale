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
  clients: ['name','email','phone','address','archived'],
  packages: ['clientId','tier','original','initial','rule','paid','renewedFrom','created'],
  interventions: ['packageId','date','service','team','duration','operators','notes','status','assignedUserId'],
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
  const interventions=(await rows(tx,'SELECT i.*,p.client_id,p.rule FROM interventions i JOIN packages p ON p.tenant_id=i.tenant_id AND p.id=i.package_id WHERE i.tenant_id=$1 ORDER BY i.date DESC,i.id DESC',[tenantId])).map(camel).map(i=>({...i,cost:i.duration*(i.rule==='operator'?i.operators:1)}));
  const packages=(await rows(tx,'SELECT * FROM packages WHERE tenant_id=$1 ORDER BY id DESC',[tenantId])).map(camel).map(p=>{
    const list=interventions.filter(i=>i.packageId===p.id);
    const consumed=list.filter(i=>i.status==='approved').reduce((s,i)=>s+i.cost,0);
    const committed=list.filter(i=>['planned','pending'].includes(i.status)).reduce((s,i)=>s+i.cost,0);
    return {...p,consumed,committed,remaining:p.initial-consumed,free:p.initial-consumed-committed};
  });
  const audit=(await rows(tx,'SELECT * FROM audit WHERE tenant_id=$1 ORDER BY id DESC',[tenantId])).map(camel);
  return {clients,packages,interventions,audit};
}

export async function snapshot(store,actor) {
  return tenantTransaction(store,actor.tenantId,async(tx,tenant)=>{
    const state=await snapshotTx(tx,actor.tenantId);
    if(actor.role==='operator') {
      state.interventions=state.interventions.filter(i=>i.assignedUserId===actor.id);
      state.packages=state.packages.filter(p=>state.interventions.some(i=>i.packageId===p.id));
      state.clients=state.clients.filter(c=>state.packages.some(p=>p.clientId===c.id));
      state.audit=[];
    }
    return {...state,company:camel(tenant)};
  });
}

export async function mutate(store,actor,action,input,key) {
  if(!input||Array.isArray(input)||typeof input!=='object')fail('Richiesta non valida.');
  required(key,150);
  if(!['manager','platform_admin'].includes(actor.role)&&action!=='complete')fail('Il tuo account non può eseguire questa operazione.',403);
  // L'azienda deriva esclusivamente dalla sessione, mai dal corpo della richiesta.
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
    const active=c=>{if(c.archived)fail('Il cliente è archiviato: ripristinalo prima di aggiungere attività.');};
    let before=null,after=null,clientId=null,interventionId=null;
    const reason=String(input.reason||'').trim();
    if(action==='client') {
      const value={name:required(input.name),email:String(input.email||'').trim(),phone:String(input.phone||'').trim(),address:String(input.address||'').trim()};
      if(Object.values(value).some(v=>v.length>500))fail('Uno dei campi è troppo lungo.');
      if(value.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email))fail('Indirizzo email non valido.');
      if(input.id){before=getC(input.id);after=await update(tx,t,'clients',before.id,value);}
      else after=await insert(tx,t,'clients',value);
      clientId=after.id;
    } else if(action==='archive'||action==='restore') {
      before=getC(input.id);clientId=before.id;required(reason,2000);
      if(action==='archive') {
        if(before.archived)fail('Cliente già archiviato.');
        if(state.packages.some(p=>p.clientId===clientId&&p.remaining>0)||state.interventions.some(i=>i.clientId===clientId&&['planned','pending'].includes(i.status)))fail('Il cliente ha ore residue o interventi aperti. Completa la gestione prima di archiviarlo.');
      } else if(!before.archived)fail('Il cliente è già attivo.');
      after=await update(tx,t,'clients',clientId,{archived:action==='archive'});
    } else if(action==='package') {
      clientId=integer(input.clientId,1,1e9);active(getC(clientId));
      const original={Star:1200,Love:2400,Luxury:3600}[input.tier];if(!original)fail('Taglio non valido.');
      const initial=integer(input.initial,0,original);if(!['operator','team'].includes(input.rule))fail('Regola di conteggio non valida.');
      const previous=input.renewedFrom?getP(input.renewedFrom):null;
      if(previous&&previous.clientId!==clientId)fail('Il rinnovo deve appartenere allo stesso cliente.');
      after=await insert(tx,t,'packages',{clientId,tier:input.tier,original,initial,rule:input.rule,paid:input.paid===true?1:0,renewedFrom:previous?.id||null,created:new Date().toISOString()});
    } else if(action==='pay') {
      before=getP(input.id);clientId=before.clientId;active(getC(clientId));if(before.paid)fail('Pagamento già confermato.');
      after=await update(tx,t,'packages',before.id,{paid:1});
    } else if(action==='intervention') {
      const p=getP(input.packageId);clientId=p.clientId;active(getC(clientId));
      if(!p.paid)fail('Confermare il pagamento prima di inserire interventi.');
      const duration=integer(input.duration,1,3600),operators=integer(input.operators,1,100);
      const date=new Date(required(input.date));if(!Number.isFinite(date.getTime()))fail('Data non valida.');
      if(!['planned','pending'].includes(input.status))fail('Stato non valido.');
      if(input.status==='pending'&&date.getTime()>Date.now())fail('Un intervento futuro può essere solo pianificato.');
      if(duration*(p.rule==='operator'?operators:1)>p.free)fail('Ore libere insufficienti per questo intervento.');
      // L'assegnazione viene validata dal server prima della transazione e dal vincolo composto.
      if(input.assignedUserId&&!actor.assignableUserIds?.includes(input.assignedUserId))fail('Operatore non disponibile per questa azienda.');
      after=await insert(tx,t,'interventions',{packageId:p.id,date:date.toISOString(),service:required(input.service),team:required(input.team),duration,operators,notes:String(input.notes||'').slice(0,3000),status:input.status,assignedUserId:input.assignedUserId||null});
      interventionId=after.id;
    } else if(['complete','approve','rectify','cancel','reschedule'].includes(action)) {
      before=state.interventions.find(i=>i.id===Number(input.id))||fail('Intervento non trovato.',404);
      if(actor.role==='operator'&&before.assignedUserId!==actor.id)fail('Intervento non assegnato al tuo account.',403);
      interventionId=before.id;clientId=before.clientId;const p=getP(before.packageId);
      if(!p.paid)fail('Pacchetto non pagato.');if(before.status==='cancelled')fail('Intervento già annullato.');
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
          if(duration*(p.rule==='operator'?operators:1)>p.free+before.cost)fail('Ore libere insufficienti per la nuova durata e il numero di operatori.');
          after=await update(tx,t,'interventions',before.id,{duration,operators,status:action==='complete'?'pending':'approved'});
        }
      }
    } else if(action==='company') {
      const name=required(input.name),logoText=required(input.logoText,10),color=required(input.brandColor,7);
      if(!/^#[0-9a-f]{6}$/i.test(color))fail('Colore non valido.');
      const address=String(input.address||'').slice(0,500),email=String(input.email||'').slice(0,300);
      before=camel(tenant);
      after=camel(await one(tx,'UPDATE tenants SET name=$2,logo_text=$3,brand_color=$4,address=$5,email=$6 WHERE id=$1 RETURNING *',[t,name,logoText,color,address,email]));
    } else fail('Operazione sconosciuta.');
    await insert(tx,t,'audit',{date:new Date().toISOString(),author:actor.name,authorId:actor.id,action,clientId,interventionId,beforeValue:JSON.stringify(before),afterValue:JSON.stringify(after),reason});
    const result={ok:true,value:after};
    await tx.query('INSERT INTO requests(tenant_id,user_id,key,payload,response) VALUES($1,$2,$3,$4,$5)',[t,actor.id,key,payload,JSON.stringify(result)]);
    return result;
  });
}
