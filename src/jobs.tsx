import {useMemo,useState} from 'react';
import {post,Session} from './access';
import type {Quote} from './quotes';

export type Job={
  id:number;clientId:number;quoteId:number|null;packageId:number|null;title:string;description:string;
  status:'draft'|'planned'|'active'|'completed'|'cancelled';dueDate:string|null;revision:number;created:string;updated:string
};
type Client={id:number;name:string;archived:boolean};
type Package={id:number;clientId:number;tier:string;paid:number;free:number};
type Intervention={id:number;jobId:number|null;status:string;service:string;date:string};

const statusLabel:Record<Job['status'],string>={draft:'Bozza',planned:'Pianificata',active:'Attiva',completed:'Completata',cancelled:'Annullata'};
const next:Record<Job['status'],Job['status'][]>={
  draft:['planned','cancelled'],
  planned:['active','cancelled'],
  active:['completed','cancelled'],
  completed:[],
  cancelled:[]
};

export function Jobs({items,clients,quotes,packages,interventions,session,onSaved,onNewIntervention,onNavigate}:{items:Job[];clients:Client[];quotes:Quote[];packages:Package[];interventions:Intervention[];session:Session;onSaved:()=>Promise<void>;onNewIntervention:(job:Job)=>void;onNavigate?:(page:string)=>void}){
  const [modal,setModal]=useState<any>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const accepted=useMemo(()=>quotes.filter(q=>q.status==='accepted'&&!items.some(j=>j.quoteId===q.id)),[quotes,items]);
  const clientName=(id:number)=>clients.find(c=>c.id===id)?.name||'Cliente';

  async function save(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();setBusy(true);setError('');
    const data:any=Object.fromEntries(new FormData(e.currentTarget));
    try{
      if(modal.kind==='edit'){
        await post('job',{
          ...(modal.item?{id:modal.item.id,revision:modal.item.revision}:{}),
          clientId:Number(data.clientId),
          quoteId:data.quoteId?Number(data.quoteId):null,
          packageId:data.packageId?Number(data.packageId):null,
          title:data.title,
          description:data.description,
          dueDate:data.dueDate||null
        },session.csrf,session.user.tenantId);
      }else{
        await post('job-status',{
          id:modal.item.id,
          revision:modal.item.revision,
          status:modal.status,
          reason:data.reason
        },session.csrf,session.user.tenantId);
      }
      setModal(null);setNotice('Lavoro aggiornato.');await onSaved();
    }catch(e:any){setError(e.message)}finally{setBusy(false)}
  }

  function createFromQuote(q:Quote){
    const doc=typeof q.document==='string'?JSON.parse(q.document):q.document;
    setModal({kind:'edit',prefill:{clientId:q.clientId,quoteId:q.id,title:doc?.title||`Lavoro da ${q.number}`}});
  }

  return <div>
    {notice&&<div className="alert success">{notice}<button className="text" onClick={()=>setNotice('')}>×</button></div>}
    {accepted.length>0&&<section className="settings-card">
      <div className="row"><div><h2>Preventivi accettati da trasformare in lavoro</h2><p>Apri il lavoro operativo senza perdere il collegamento al documento commerciale.</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>Preventivo</th><th>Cliente</th><th>Totale</th><th></th></tr></thead><tbody>
        {accepted.map(q=><tr key={q.id}><td><strong>{q.number}</strong></td><td>{clientName(q.clientId)}</td><td>{new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(q.total/100)}</td><td><button onClick={()=>createFromQuote(q)}>Crea lavoro</button></td></tr>)}
      </tbody></table></div>
    </section>}

    <div className="section-title"><h2>Lavori</h2><button onClick={()=>setModal({kind:'edit'})}>＋ Nuovo lavoro</button></div>
    {items.length?<div className="table-wrap"><table><thead><tr><th>Lavoro</th><th>Cliente</th><th>Collegamenti</th><th>Scadenza</th><th>Stato</th><th>Azioni</th></tr></thead><tbody>
      {items.map(j=>{
        const count=interventions.filter(i=>i.jobId===j.id).length;
        const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Rome'}).format(new Date());
        const overdue=!!j.dueDate&&j.dueDate<today&&!['completed','cancelled'].includes(j.status);
        const overdueDays=overdue?Math.max(1,Math.floor((new Date(today+'T12:00:00').getTime()-new Date(j.dueDate+'T12:00:00').getTime())/86400000)):0;
        const primary=next[j.status].find(status=>status!=='cancelled');
        return <tr key={j.id}><td><strong>{j.title}</strong><span>#{j.id}{j.description?` · ${j.description}`:''}</span></td><td>{clientName(j.clientId)}</td><td>{j.quoteId?<span>Preventivo #{j.quoteId}</span>:null}{j.packageId?<span>Pacchetto #{j.packageId}</span>:null}<small>{count} interventi</small></td><td>{j.dueDate?<div className={overdue?'due-date overdue':'due-date'}><span>{new Date(j.dueDate+'T12:00:00').toLocaleDateString('it-IT')}</span>{overdue&&<b>Scaduto da {overdueDays} {overdueDays===1?'giorno':'giorni'}</b>}</div>:'—'}</td><td><span className={'badge '+(j.status==='active'?'approved':j.status==='cancelled'?'cancelled':j.status==='completed'?'approved':'planned')}>{statusLabel[j.status]}</span></td><td><div className="job-actions">
          {primary&&<button onClick={()=>setModal({kind:'status',item:j,status:primary})}>{primary==='planned'?'Pianifica →':primary==='active'?'Avvia →':'Completa →'}</button>}
          {j.status==='completed'&&onNavigate&&<button onClick={()=>onNavigate('Fatture')}>Crea fattura →</button>}
          <details className="action-menu"><summary aria-label="Altre azioni">⋯</summary><div>
            {['draft','planned'].includes(j.status)&&<button onClick={()=>setModal({kind:'edit',item:j})}>Modifica</button>}
            {!['completed','cancelled'].includes(j.status)&&<button onClick={()=>onNewIntervention(j)}>＋ Intervento</button>}
            {next[j.status].includes('cancelled')&&<button className="danger" onClick={()=>setModal({kind:'status',item:j,status:'cancelled'})}>Annulla</button>}
            {j.status==='completed'&&<span>Nessun’altra azione</span>}
            {j.status==='cancelled'&&<span>Lavoro annullato</span>}
          </div></details>
        </div></td></tr>
      })}
    </tbody></table></div>:<div className="empty"><span>◇</span><p>Nessun lavoro. Puoi crearne uno manualmente o partire da un preventivo accettato.</p></div>}

    {modal&&<div className="overlay" onClick={e=>{if(e.target===e.currentTarget&&!busy)setModal(null)}}><section role="dialog" aria-modal="true" className="modal">
      <div className="row"><h2>{modal.kind==='edit'?(modal.item?'Modifica lavoro':'Nuovo lavoro'):'Aggiorna stato lavoro'}</h2><button className="text" disabled={busy} onClick={()=>setModal(null)}>×</button></div>
      <form onSubmit={save}>
        {modal.kind==='edit'?<JobFields item={modal.item} prefill={modal.prefill} clients={clients} quotes={quotes} packages={packages}/>:<>
          <p><strong>{modal.item.title}</strong></p>
          <p>Nuovo stato: <b>{statusLabel[modal.status as Job['status']]}</b></p>
          <label>Motivazione obbligatoria<textarea name="reason" required maxLength={2000}/></label>
        </>}
        {error&&<div className="alert error">{error}</div>}
        <div className="modal-footer"><button type="button" className="secondary" disabled={busy} onClick={()=>setModal(null)}>Indietro</button><button disabled={busy}>{busy?'Salvataggio…':'Conferma'}</button></div>
      </form>
    </section></div>}
  </div>
}

function JobFields({item,prefill,clients,quotes,packages}:{item?:Job;prefill?:any;clients:Client[];quotes:Quote[];packages:Package[]}){
  const initialClient=Number(item?.clientId||prefill?.clientId||0);
  const [clientId,setClientId]=useState(initialClient);
  const quoteId=Number(item?.quoteId||prefill?.quoteId||0);
  return <>
    <label>Cliente *<select name="clientId" required value={clientId||''} onChange={e=>setClientId(Number(e.target.value))}><option value="" disabled>Seleziona cliente</option>{clients.filter(c=>!c.archived||c.id===clientId).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label>Preventivo accettato<select name="quoteId" defaultValue={quoteId||''}><option value="">Nessun preventivo</option>{quotes.filter(q=>q.clientId===clientId&&q.status==='accepted').map(q=><option key={q.id} value={q.id}>{q.number}</option>)}</select></label>
    <label>Pacchetto ore<select name="packageId" defaultValue={item?.packageId||''}><option value="">Nessun pacchetto — lavoro a forfait</option>{packages.filter(p=>p.clientId===clientId&&p.paid).map(p=><option key={p.id} value={p.id}>{p.tier} #{p.id}</option>)}</select></label>
    <label>Titolo *<input name="title" required maxLength={200} defaultValue={item?.title||prefill?.title||''}/></label>
    <label>Descrizione<textarea name="description" maxLength={3000} defaultValue={item?.description||''}/></label>
    <label>Scadenza prevista<input name="dueDate" type="date" defaultValue={item?.dueDate||''}/></label>
    <p className="help">Il pacchetto è opzionale. Senza pacchetto, il lavoro può comunque contenere interventi e verrà gestito a forfait.</p>
  </>
}
