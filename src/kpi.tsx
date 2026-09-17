import React,{useMemo,useState} from 'react';
import './kpi.css';

type Client={id:number;name:string;archived:boolean};
type Package={id:number;clientId:number;paid:number;initial:number;consumed:number;remaining:number;committed:number;free:number};
type Intervention={id:number;clientId:number;date:string;duration:number;operators:number;status:string;cost:number};
type Quote={id:number;clientId:number;status:string;issueDate:string;total:number};
type Invoice={id:number;clientId:number;status:string;issueDate:string;dueDate:string;total:number;paidAt?:string|null};
export type KpiState={clients:Client[];packages:Package[];interventions:Intervention[];quotes:Quote[];invoices:Invoice[]};

type Range='30'|'90'|'365'|'all';
const money=(v:number)=>new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(v/100);
const hours=(v:number)=>`${(v/60).toLocaleString('it-IT',{maximumFractionDigits:1})} h`;
const pct=(v:number)=>`${Math.round(v)}%`;
const day=(s:string)=>new Date(s+'T12:00:00');
const startFor=(range:Range)=>{if(range==='all')return null;const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-Number(range)+1);return d};
const inRange=(value:string|undefined|null,start:Date|null)=>!start||!!value&&new Date(value).getTime()>=start.getTime();

export function KpiDashboard({state}:{state:KpiState}){
 const [range,setRange]=useState<Range>('90');
 const model=useMemo(()=>{
  const start=startFor(range),today=new Date();today.setHours(23,59,59,999);
  const invoices=state.invoices.filter(i=>i.status!=='cancelled'&&inRange(i.issueDate,start));
  const issued=invoices.filter(i=>['issued','paid'].includes(i.status));
  const paid=invoices.filter(i=>i.status==='paid');
  const outstanding=invoices.filter(i=>i.status==='issued');
  const overdue=outstanding.filter(i=>day(i.dueDate)<new Date());
  const quotes=state.quotes.filter(q=>q.status!=='cancelled'&&inRange(q.issueDate,start));
  const sentQuotes=quotes.filter(q=>['sent','accepted','rejected'].includes(q.status));
  const accepted=quotes.filter(q=>q.status==='accepted');
  const rejected=quotes.filter(q=>q.status==='rejected');
  const interventions=state.interventions.filter(i=>i.status!=='cancelled'&&inRange(i.date,start));
  const approved=interventions.filter(i=>i.status==='approved');
  const planned=state.interventions.filter(i=>i.status==='planned'&&new Date(i.date)>=new Date());
  const activeClients=state.clients.filter(c=>!c.archived).length;
  const activePackages=state.packages.filter(p=>p.paid&&p.remaining>0);
  const consumed=activePackages.reduce((s,p)=>s+p.consumed,0),remaining=activePackages.reduce((s,p)=>s+p.remaining,0),committed=activePackages.reduce((s,p)=>s+p.committed,0);
  const utilization=consumed+remaining>0?consumed/(consumed+remaining)*100:0;
  const conversion=sentQuotes.length?accepted.length/sentQuotes.length*100:0;
  const avgTicket=paid.length?paid.reduce((s,i)=>s+i.total,0)/paid.length:0;
  const now=new Date(),months=Array.from({length:6},(_,offset)=>{const d=new Date(now.getFullYear(),now.getMonth()-(5-offset),1);return {key:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,label:d.toLocaleDateString('it-IT',{month:'short'})}});
  const monthly=months.map(m=>({label:m.label,revenue:issued.filter(i=>i.issueDate.startsWith(m.key)).reduce((s,i)=>s+i.total,0),hours:approved.filter(i=>i.date.startsWith(m.key)).reduce((s,i)=>s+i.cost,0)}));
  const maxRevenue=Math.max(1,...monthly.map(m=>m.revenue)),maxHours=Math.max(1,...monthly.map(m=>m.hours));
  const clients=state.clients.map(c=>{const clientInvoices=issued.filter(i=>i.clientId===c.id);return {id:c.id,name:c.name,revenue:clientInvoices.reduce((s,i)=>s+i.total,0),hours:approved.filter(i=>i.clientId===c.id).reduce((s,i)=>s+i.cost,0)}}).filter(c=>c.revenue||c.hours).sort((a,b)=>b.revenue-a.revenue||b.hours-a.hours).slice(0,5);
  return {issuedTotal:issued.reduce((s,i)=>s+i.total,0),paidTotal:paid.reduce((s,i)=>s+i.total,0),outstandingTotal:outstanding.reduce((s,i)=>s+i.total,0),overdueTotal:overdue.reduce((s,i)=>s+i.total,0),overdueCount:overdue.length,avgTicket,conversion,accepted:accepted.length,rejected:rejected.length,sent:sentQuotes.length,activeClients,activePackages:activePackages.length,consumed,remaining,committed,utilization,approvedHours:approved.reduce((s,i)=>s+i.cost,0),planned:planned.length,monthly,maxRevenue,maxHours,clients};
 },[state,range]);
 return <section className="kpi-shell">
  <div className="kpi-toolbar"><div><span className="eyebrow">CONTROLLO DI GESTIONE</span><h2>Dashboard KPI</h2><p>Dati operativi, commerciali e finanziari in un'unica vista.</p></div><div className="kpi-range">{([['30','30 giorni'],['90','90 giorni'],['365','12 mesi'],['all','Tutto']] as const).map(([v,l])=><button key={v} className={range===v?'selected':'secondary'} onClick={()=>setRange(v)}>{l}</button>)}</div></div>
  <div className="kpi-cards">
   <Card label="Fatturato emesso" value={money(model.issuedTotal)} note="Fatture emesse + pagate"/>
   <Card label="Incassato" value={money(model.paidTotal)} note={`Ticket medio ${money(model.avgTicket)}`}/>
   <Card label="Da incassare" value={money(model.outstandingTotal)} note={`${model.overdueCount} scadute · ${money(model.overdueTotal)}`}/>
   <Card label="Conversione preventivi" value={pct(model.conversion)} note={`${model.accepted} accettati su ${model.sent} inviati`}/>
   <Card label="Ore erogate" value={hours(model.approvedHours)} note="Interventi approvati nel periodo"/>
   <Card label="Utilizzo pacchetti" value={pct(model.utilization)} note={`${hours(model.remaining)} ancora residue`}/>
   <Card label="Clienti attivi" value={String(model.activeClients)} note={`${model.activePackages} pacchetti attivi`}/>
   <Card label="Interventi futuri" value={String(model.planned)} note={`${hours(model.committed)} già impegnate`}/>
  </div>
  <div className="kpi-grid-two">
   <article className="kpi-panel"><div className="kpi-panel-head"><div><h3>Andamento economico</h3><p>Fatturato emesso negli ultimi 6 mesi</p></div><strong>{money(model.issuedTotal)}</strong></div><div className="kpi-bars">{model.monthly.map(m=><div className="kpi-bar-col" key={m.label}><div className="kpi-bar-track"><span style={{height:`${Math.max(4,m.revenue/model.maxRevenue*100)}%`}} title={money(m.revenue)}/></div><b>{m.label}</b><small>{money(m.revenue)}</small></div>)}</div></article>
   <article className="kpi-panel"><div className="kpi-panel-head"><div><h3>Ore erogate</h3><p>Interventi approvati negli ultimi 6 mesi</p></div><strong>{hours(model.approvedHours)}</strong></div><div className="kpi-bars kpi-hours">{model.monthly.map(m=><div className="kpi-bar-col" key={m.label}><div className="kpi-bar-track"><span style={{height:`${Math.max(4,m.hours/model.maxHours*100)}%`}} title={hours(m.hours)}/></div><b>{m.label}</b><small>{hours(m.hours)}</small></div>)}</div></article>
  </div>
  <div className="kpi-grid-two">
   <article className="kpi-panel"><div className="kpi-panel-head"><div><h3>Pipeline preventivi</h3><p>Esito delle proposte inviate</p></div></div><div className="kpi-funnel"><Funnel label="Accettati" value={model.accepted} total={model.sent}/><Funnel label="Rifiutati" value={model.rejected} total={model.sent}/><Funnel label="Altri inviati" value={Math.max(0,model.sent-model.accepted-model.rejected)} total={model.sent}/></div></article>
   <article className="kpi-panel"><div className="kpi-panel-head"><div><h3>Salute pacchetti</h3><p>Ore vendute e disponibilità residua</p></div></div><div className="kpi-balance"><div><span>Consumate</span><strong>{hours(model.consumed)}</strong></div><div><span>Impegnate</span><strong>{hours(model.committed)}</strong></div><div><span>Residue</span><strong>{hours(model.remaining)}</strong></div></div><div className="kpi-progress"><span style={{width:`${Math.min(100,model.utilization)}%`}}/></div></article>
  </div>
  <article className="kpi-panel"><div className="kpi-panel-head"><div><h3>Clienti principali</h3><p>Per fatturato emesso nel periodo; a parità, per ore erogate</p></div></div>{model.clients.length?<div className="kpi-table"><div className="kpi-table-row head"><span>Cliente</span><span>Fatturato</span><span>Ore erogate</span></div>{model.clients.map(c=><div className="kpi-table-row" key={c.id}><strong>{c.name}</strong><span>{money(c.revenue)}</span><span>{hours(c.hours)}</span></div>)}</div>:<div className="kpi-empty">Nessun dato disponibile per il periodo selezionato.</div>}</article>
 </section>
}
function Card({label,value,note}:{label:string;value:string;note:string}){return <article className="kpi-card"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>}
function Funnel({label,value,total}:{label:string;value:number;total:number}){const share=total?value/total*100:0;return <div className="kpi-funnel-row"><div><span>{label}</span><strong>{value}</strong></div><div className="kpi-funnel-track"><span style={{width:`${share}%`}}/></div><small>{pct(share)}</small></div>}
