import React,{useEffect,useState} from 'react';
import {createRoot,Root} from 'react-dom/client';
import {CalendarView,CalendarIntervention,CalendarClient} from './calendar';
import './calendar.css';

type State={clients:CalendarClient[];interventions:CalendarIntervention[]};
let root:Root|null=null;

function CalendarPortal({close}:{close:()=>void}){
 const [state,setState]=useState<State>({clients:[],interventions:[]}),[loading,setLoading]=useState(true),[error,setError]=useState(''),[selected,setSelected]=useState<CalendarIntervention|null>(null);
 useEffect(()=>{fetch('/api/state').then(async r=>{if(!r.ok)throw Error(r.status===401?'Accedi per visualizzare il calendario.':'Impossibile caricare il calendario.');setState(await r.json())}).catch(e=>setError(e.message)).finally(()=>setLoading(false))},[]);
 const clientName=(id:number)=>state.clients.find(c=>c.id===id)?.name||`Cliente #${id}`;
 function goInterventions(){close();setTimeout(()=>{const nav=[...document.querySelectorAll('aside nav button')].find(b=>b.textContent?.includes('Interventi')) as HTMLButtonElement|undefined;nav?.click()},50)}
 function newIntervention(){goInterventions();setTimeout(()=>{const btn=[...document.querySelectorAll('main button')].find(b=>b.textContent?.includes('Nuovo intervento')) as HTMLButtonElement|undefined;btn?.click()},150)}
 return <div className="calendar-portal"><div className="calendar-portal-top"><div><span className="eyebrow">LUVIQAI · GESTIONE OPERATIVA</span><h1>Calendario</h1></div><div className="actions"><button onClick={newIntervention}>＋ Nuovo intervento</button><button className="secondary" onClick={close}>Chiudi ×</button></div></div>{loading?<div className="cal-empty">Caricamento calendario…</div>:error?<div className="alert error">{error}</div>:<CalendarView items={state.interventions||[]} clients={state.clients||[]} onOpen={setSelected} onNew={newIntervention}/>} {selected&&<div className="overlay" onClick={e=>{if(e.target===e.currentTarget)setSelected(null)}}><section className="modal calendar-detail" role="dialog" aria-modal="true"><div className="row"><h2>{selected.service}</h2><button className="text" onClick={()=>setSelected(null)}>×</button></div><p><strong>{clientName(selected.clientId)}</strong></p><p>{new Date(selected.date).toLocaleString('it-IT',{dateStyle:'full',timeStyle:'short'})}</p><p>{selected.team} · {selected.duration} minuti · {selected.operators} operatori</p>{selected.notes&&<p>{selected.notes}</p>}<span className={'badge '+selected.status}>{({planned:'Pianificato',pending:'Da approvare',approved:'Approvato',cancelled:'Annullato'} as Record<string,string>)[selected.status]||selected.status}</span><div className="modal-footer"><button className="secondary" onClick={()=>setSelected(null)}>Chiudi</button><button onClick={goInterventions}>Apri in Interventi</button></div></section></div>}</div>
}

function openCalendar(){if(document.getElementById('calendar-portal-root'))return;const node=document.createElement('div');node.id='calendar-portal-root';document.body.appendChild(node);const close=()=>{root?.unmount();root=null;node.remove()};root=createRoot(node);root.render(<CalendarPortal close={close}/>)}

function installButton(){const nav=document.querySelector('aside nav');if(!nav||nav.querySelector('[data-luviq-calendar]'))return;const button=document.createElement('button');button.dataset.luviqCalendar='1';button.innerHTML='<span>▣</span>Calendario';button.addEventListener('click',openCalendar);const intervention=[...nav.querySelectorAll('button')].find(b=>b.textContent?.includes('Interventi'));if(intervention?.nextSibling)nav.insertBefore(button,intervention.nextSibling);else nav.appendChild(button)}

const observer=new MutationObserver(()=>installButton());observer.observe(document.body,{childList:true,subtree:true});installButton();
