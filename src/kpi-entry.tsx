import React,{useEffect,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {KpiDashboard,type KpiState} from './kpi';
import './kpi.css';

let root:Root|null=null;
function KpiPortal({close}:{close:()=>void}){
 const [state,setState]=useState<KpiState|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
 useEffect(()=>{(async()=>{const me=await fetch('/api/me');if(!me.ok)throw Error('Accedi per visualizzare la dashboard KPI.');const session=await me.json();if(session.user.role==='operator')throw Error('Dashboard riservata ai responsabili.');const res=await fetch('/api/state',{headers:{'X-Tenant-Context':session.user.tenantId}});if(!res.ok)throw Error('Impossibile caricare i KPI.');setState(await res.json())})().catch(e=>setError(e.message)).finally(()=>setLoading(false))},[]);
 return <div className="kpi-portal"><div className="kpi-portal-top"><div><span className="eyebrow">LUVIQAI · ANALISI</span><h1>Dashboard KPI</h1></div><button className="secondary" onClick={close}>Chiudi ×</button></div>{loading?<div className="kpi-empty">Calcolo degli indicatori…</div>:error?<div className="alert error">{error}</div>:state?<KpiDashboard state={state}/>:null}</div>
}
function openKpi(){if(document.getElementById('kpi-portal-root'))return;const node=document.createElement('div');node.id='kpi-portal-root';document.body.appendChild(node);const close=()=>{root?.unmount();root=null;node.remove()};root=createRoot(node);root.render(<KpiPortal close={close}/>)}
function installButton(){const nav=document.querySelector('aside nav');if(!nav||nav.querySelector('[data-luviq-kpi]'))return;const overview=[...nav.querySelectorAll('button')].find(b=>b.textContent?.includes('Panoramica'));if(!overview)return;const button=document.createElement('button');button.dataset.luviqKpi='1';button.innerHTML='<span>▥</span>Dashboard KPI';button.addEventListener('click',openKpi);if(overview.nextSibling)nav.insertBefore(button,overview.nextSibling);else nav.appendChild(button)}
const observer=new MutationObserver(()=>installButton());observer.observe(document.body,{childList:true,subtree:true});installButton();
