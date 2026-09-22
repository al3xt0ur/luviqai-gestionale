import {randomUUID} from 'node:crypto';
import {one,rows} from './storage.mjs';

const zone='Europe/Rome';
export function localDay(value=new Date()) {
  return new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
}
export function localInstant(day,time) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error('Data o ora non valida.');
  const base=Date.parse(day+'T'+time+':00Z');
  if(!Number.isFinite(base)||new Date(base).toISOString().slice(0,10)!==day)throw Error('Data non valida.');
  const format=new Intl.DateTimeFormat('sv-SE',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const matches=[0,1,2,3].map(h=>new Date(base-h*3600000)).filter(d=>format.format(d)===day+' '+time);
  if(matches.length!==1)throw Error('Orario inesistente o ambiguo nel cambio dell’ora: scegliere un altro orario.');
  return matches[0].toISOString();
}
export function recurrenceDates({startDate,localTime,weekdays,frequencyWeeks,occurrenceCount}) {
  localInstant(startDate,localTime);
  if(![1,2].includes(frequencyWeeks)||!Number.isInteger(occurrenceCount)||occurrenceCount<1||occurrenceCount>52||!Array.isArray(weekdays)||!weekdays.length||weekdays.some(d=>!Number.isInteger(d)||d<1||d>7)||new Set(weekdays).size!==weekdays.length)throw Error('Ricorrenza non valida (massimo 52 appuntamenti).');
  const start=new Date(startDate+'T12:00:00Z'),offset=(start.getUTCDay()+6)%7;
  const result=[];
  for(let n=0;result.length<occurrenceCount&&n<740;n++){
    const day=new Date(start.getTime()+n*86400000),weekday=(day.getUTCDay()+6)%7+1;
    if(Math.floor((offset+n)/7)%frequencyWeeks===0&&weekdays.includes(weekday))result.push(localInstant(day.toISOString().slice(0,10),localTime));
  }
  if(result.length!==occurrenceCount)throw Error('Ricorrenza troppo estesa.');
  return result;
}
export function ensureNoOverlap(interventions,candidate,fail) {
  const users=candidate.assignedUserIds||[candidate.assignedUserId].filter(Boolean);
  if(!candidate.teamId&&!users.length)return;
  const start=Date.parse(candidate.date),end=start+candidate.duration*60000;
  if(interventions.some(i=>i.id!==candidate.id&&i.status!=='cancelled'&&((candidate.teamId&&i.teamId===candidate.teamId)||users.some(id=>i.assignedUserId===id||i.assignedUserIds?.includes(id)))&&start<Date.parse(i.date)+i.duration*60000&&end>Date.parse(i.date)))fail('Squadra o operatore già impegnato in questo orario.',409);
}
export async function operationalChange(ctx) {
  const {tx,t,state,tenant,actor,input,action,insert,update,fail,integer,required}=ctx;
  const now=new Date().toISOString();
  if(action==='team') {
    const before=input.id?state.teams.find(x=>x.id===Number(input.id)):null;
    if(input.id&&!before)fail('Squadra non trovata.',404);
    if(before)required(input.reason,2000);
    const name=required(input.name,120),active=input.active===undefined?true:input.active;
    if(typeof active!=='boolean')fail('Stato squadra non valido.');
    if(state.teams.some(x=>x.id!==before?.id&&x.name.toLowerCase()===name.toLowerCase()))fail('Nome squadra già utilizzato.');
    const value={name,active,created:before?.created||now};
    return {before,after:before?await update(tx,t,'teams',before.id,value):await insert(tx,t,'teams',value)};
  }
  if(action==='quote-convert') {
    const quote=state.quotes.find(q=>q.id===Number(input.quoteId));
    if(!quote||quote.status!=='accepted')fail('Seleziona un preventivo accettato della tua azienda.');
    if(integer(input.revision,1,1e9)!==quote.revision)fail('Preventivo modificato: ricarica i dati.',409);
    const client=state.clients.find(c=>c.id===quote.clientId);
    if(!client||client.archived)fail('Cliente archiviato.');
    if(state.packages.some(p=>p.sourceQuoteId===quote.id))fail('Preventivo già convertito.',409);
    const model=state.catalog.find(x=>x.id===Number(input.templateId)&&x.active);
    if(!model)fail('Seleziona un modello attivo.');
    if(integer(input.templateRevision,1,1e9)!==model.revision)fail('Modello modificato: ricarica i dati.',409);
    required(input.reason,2000);
    const after=await insert(tx,t,'packages',{clientId:client.id,tier:model.name,original:model.minutes,initial:model.minutes,rule:model.rule,paid:0,created:now,description:model.description,templateId:model.id,templateRevision:model.revision,sourceQuoteId:quote.id,sourceQuoteSlot:'whole-quote'});
    return {before:null,after,clientId:client.id};
  }
  if(action==='recurrence') {
    const p=state.packages.find(p=>p.id===Number(input.packageId));
    if(!p||!p.paid)fail('Seleziona un pacchetto pagato.');
    if(state.clients.find(c=>c.id===p.clientId)?.archived)fail('Cliente archiviato.');
    const duration=integer(input.duration,1,3600),operators=integer(input.operators,1,100);
    const team=state.teams.find(x=>x.id===Number(input.teamId)&&x.active);
    if(!team)fail('Seleziona una squadra attiva.');
    const assignedUserId=input.assignedUserId||null;
    if(assignedUserId&&!actor.assignableUserIds?.includes(assignedUserId))fail('Operatore non disponibile.');
    const frequencyWeeks=integer(input.frequencyWeeks,1,2),occurrenceCount=integer(input.occurrenceCount,1,52);
    let dates;try{dates=recurrenceDates({...input,frequencyWeeks,occurrenceCount});}catch(e){fail(e.message);}
    if(dates.some(d=>d<now))fail('Gli appuntamenti devono essere futuri.');
    if(duration*(p.rule==='operator'?operators:1)*dates.length>p.free)fail('Ore libere insufficienti per tutta la serie.');
    const service=required(input.service,300),id=randomUUID(),list=[...state.interventions];
    for(const date of dates){const candidate={date,duration,teamId:team.id,assignedUserId};ensureNoOverlap(list,candidate,fail);list.push({...candidate,id:randomUUID(),status:'planned'});}
    await tx.query('INSERT INTO recurrence_series(tenant_id,id,client_id,package_id,source_quote_id,frequency_weeks,weekdays,local_time,occurrence_count,created,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[t,id,p.clientId,p.id,p.sourceQuoteId||null,frequencyWeeks,JSON.stringify(input.weekdays),input.localTime,occurrenceCount,now,actor.id]);
    const interventions=[];
    for(const date of dates)interventions.push(await insert(tx,t,'interventions',{packageId:p.id,date,service,team:team.name,teamId:team.id,duration,operators,notes:String(input.notes||'').slice(0,3000),status:'planned',assignedUserId,recurrenceId:id,sourceQuoteId:p.sourceQuoteId||null,sourceQuoteSlot:p.sourceQuoteId?id+':'+date:''}));
    if(assignedUserId)for(const item of interventions)await tx.query('INSERT INTO intervention_assignments(tenant_id,intervention_id,user_id,created) VALUES($1,$2,$3,$4)',[t,item.id,assignedUserId,now]);
    return {before:null,after:{id,interventions},clientId:p.clientId};
  }
  if(action==='recurrence-cancel') {
    required(input.reason,2000);
    const before=state.recurrenceSeries.find(x=>x.id===input.id);
    if(!before||!before.active)fail('Serie attiva non trovata.',404);
    const changed=[];
    for(const i of state.interventions.filter(i=>i.recurrenceId===before.id&&i.status==='planned'))changed.push(await update(tx,t,'interventions',i.id,{status:'cancelled'}));
    await tx.query('UPDATE recurrence_series SET active=false WHERE tenant_id=$1 AND id=$2',[t,before.id]);
    return {before:{...before,interventions:state.interventions.filter(i=>changed.some(c=>c.id===i.id))},after:{...before,active:false,interventions:changed},clientId:before.clientId};
  }
  if(action==='alert-settings') {
    const low=integer(input.lowBalanceMinutes,0,600000),follow=integer(input.quoteFollowupDays,1,365),pending=integer(input.pendingApprovalHours,1,8760);
    await tx.query('UPDATE tenants SET low_balance_minutes=$2,quote_followup_days=$3,pending_approval_hours=$4 WHERE id=$1',[t,low,follow,pending]);
    return {before:{lowBalanceMinutes:tenant.low_balance_minutes,quoteFollowupDays:tenant.quote_followup_days,pendingApprovalHours:tenant.pending_approval_hours},after:{lowBalanceMinutes:low,quoteFollowupDays:follow,pendingApprovalHours:pending}};
  }
  if(action==='alert-read') {
    const before=await one(tx,'SELECT * FROM alerts WHERE tenant_id=$1 AND id=$2',[t,required(input.id,100)]);
    if(!before)fail('Avviso non trovato.',404);
    const after=await one(tx,'UPDATE alerts SET read_at=coalesce(read_at,$3) WHERE tenant_id=$1 AND id=$2 RETURNING *',[t,before.id,now]);
    return {before,after};
  }
  fail('Operazione sconosciuta.');
}
export async function syncAlerts(tx,t,state,tenant,clock=new Date()) {
  const now=clock.toISOString(),day=localDay(clock),desired=[];
  const add=(kind,type,item,title,body,link)=>desired.push({key:kind+':'+item.id,kind,type,id:String(item.id),title,body,link});
  for(const p of state.packages)if(p.paid&&p.remaining<=tenant.low_balance_minutes)add('low_balance','package',p,'Saldo ore basso',`Pacchetto #${p.id}: ${p.remaining} minuti residui.`,'Pacchetti ore');
  for(const q of state.quotes)if(q.status==='sent'&&Date.parse(q.updated)<=clock.getTime()-tenant.quote_followup_days*86400000)add('quote_followup','quote',q,'Preventivo da ricontattare',q.number,'Preventivi');
  for(const i of state.invoices)if(i.status==='issued'&&i.dueDate<day)add('overdue_invoice','invoice',i,'Fattura scaduta',i.number,'Fatture');
  for(const i of state.interventions)if(i.status==='pending'){
    const event=state.audit.find(a=>a.interventionId===i.id&&['complete','intervention'].includes(a.action));
    const since=event?.date||i.date;
    if(Date.parse(since)<=clock.getTime()-tenant.pending_approval_hours*3600000)add('pending_approval','intervention',i,'Intervento da approvare',`Intervento #${i.id}: ${i.service}`,'Interventi');
  }
  const keys=desired.map(x=>x.key);
  await tx.query('UPDATE alerts SET resolved_at=$2,updated=$2 WHERE tenant_id=$1 AND resolved_at IS NULL AND NOT(dedupe_key=ANY($3::text[]))',[t,now,keys]);
  for(const a of desired)await tx.query(`INSERT INTO alerts(tenant_id,id,kind,target_type,target_id,dedupe_key,title,body,link,created,updated) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) ON CONFLICT(tenant_id,dedupe_key) DO UPDATE SET title=excluded.title,body=excluded.body,updated=CASE WHEN alerts.resolved_at IS NOT NULL OR alerts.body<>excluded.body THEN excluded.updated ELSE alerts.updated END,read_at=CASE WHEN alerts.resolved_at IS NOT NULL THEN NULL ELSE alerts.read_at END,resolved_at=NULL`,[t,randomUUID(),a.kind,a.type,a.id,a.key,a.title,a.body,a.link,now]);
  return rows(tx,'SELECT * FROM alerts WHERE tenant_id=$1 ORDER BY created DESC',[t]);
}
export function dashboard(state,{from,to}={}) {
  const inPeriod=value=>{const day=localDay(new Date(value));return(!from||day>=from)&&(!to||day<=to);};
  const invoices=state.invoices.filter(i=>['issued','paid'].includes(i.status)&&inPeriod(i.issueDate+'T12:00:00Z'));
  return {issuedTotal:invoices.reduce((s,i)=>s+i.total,0),paidTotal:state.invoices.filter(i=>i.status==='paid'&&inPeriod((i.payment.date||i.paidAt).slice(0,10)+'T12:00:00Z')).reduce((s,i)=>s+i.total,0),approvedMinutes:state.interventions.filter(i=>i.status==='approved'&&inPeriod(i.date)).reduce((s,i)=>s+i.cost,0),plannedCount:state.interventions.filter(i=>i.status==='planned'&&inPeriod(i.date)).length};
}
