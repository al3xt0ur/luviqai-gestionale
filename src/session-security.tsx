import {useEffect,useState} from 'react';
import type {Session} from './access';

function deviceName(ua:string){
  if(!ua)return 'Dispositivo non identificato';
  const browser=/Edg\//.test(ua)?'Edge':/Firefox\//.test(ua)?'Firefox':/CriOS\//.test(ua)?'Chrome':/Chrome\//.test(ua)?'Chrome':/Safari\//.test(ua)?'Safari':'Browser';
  const device=/iPhone/.test(ua)?'iPhone':/iPad/.test(ua)?'iPad':/Android/.test(ua)?'Android':/Windows/.test(ua)?'Windows':/Mac OS X/.test(ua)?'Mac':'dispositivo';
  return browser+' su '+device;
}
const when=(value:number|null)=>value?new Date(value).toLocaleString('it-IT'):'non disponibile';

export function ActiveSessions({session,compact=false}:{session:Session;compact?:boolean}){
  const [items,setItems]=useState<any[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function load(){
    const r=await fetch('/api/sessions',{headers:{'X-Tenant-Context':session.user.tenantId}});
    if(!r.ok)throw Error('Impossibile caricare le sessioni attive.');
    const data=await r.json();setItems(data.sessions||[]);
  }
  useEffect(()=>{load().catch(e=>setError(e.message));},[session.user.id]);
  async function action(path:string,body:any={}){
    setBusy(true);setError('');
    try{
      const r=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf,'X-Tenant-Context':session.user.tenantId},body:JSON.stringify(body)});
      const data=await r.json();if(!r.ok)throw Error(data.error||'Operazione non riuscita.');
      await load();
    }catch(e:any){setError(e.message)}finally{setBusy(false)}
  }
  const content=<><div className="row"><div><h3 style={{margin:0}}>Sessioni e dispositivi</h3><p>Controlla dove il tuo account risulta ancora collegato.</p></div>{items.some(s=>!s.current)&&<button type="button" className="secondary" disabled={busy} onClick={()=>{if(confirm('Chiudere tutte le altre sessioni del tuo account?'))void action('sessions/revoke-others')}}>Chiudi tutte le altre</button>}</div>
    {error&&<div className="alert error" role="alert">{error}</div>}
    {items.length?items.map(s=><div className="member" key={s.id}><div><b>{deviceName(s.userAgent)} {s.current&&<span className="badge approved">Questa sessione</span>}</b><p>Accesso: {when(s.createdAt)} · Ultima attività: {when(s.lastSeenAt)}</p><small>IP: {s.ipAddress||'non disponibile'} · Scade: {when(s.expiresAt)}</small><details><summary>Dettagli browser</summary><code style={{overflowWrap:'anywhere'}}>{s.userAgent||'User agent non disponibile'}</code></details></div>{!s.current&&<button type="button" className="secondary" disabled={busy} onClick={()=>{if(confirm('Revocare questa sessione?'))void action('sessions/revoke',{id:s.id})}}>Revoca</button>}</div>):<p>Nessuna sessione attiva trovata.</p>}
  </>;
  return compact?<div>{content}</div>:<section className="settings-card">{content}</section>;
}
