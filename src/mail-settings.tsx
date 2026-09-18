import React,{useEffect,useState} from 'react';
import {Session,post} from './access';

export function MailSettings({session}:{session:Session}){
  const [data,setData]=useState<any>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  async function load(){
    const r=await fetch('/api/mail-settings',{headers:{'X-Tenant-Context':session.user.tenantId}});
    const j=await r.json();if(!r.ok)throw Error(j.error||'Impossibile caricare la configurazione email.');setData(j);
  }
  useEffect(()=>{load().catch(e=>setError(e.message));},[]);
  async function save(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();setBusy(true);setError('');setNotice('');
    const form=e.currentTarget,data=Object.fromEntries(new FormData(form));
    try{
      await post('mail-settings',{...data,enabled:new FormData(form).get('enabled')==='on'},session.csrf,session.user.tenantId);
      await load();setNotice('Configurazione email salvata.');
    }catch(e:any){setError(e.message)}finally{setBusy(false)}
  }
  async function test(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();setBusy(true);setError('');setNotice('');
    const recipient=new FormData(e.currentTarget).get('recipient');
    try{await post('mail-settings/test',{recipient},session.csrf,session.user.tenantId);setNotice('Email di prova inserita in coda. Controlla “Email e notifiche” per l’esito.');}
    catch(e:any){setError(e.message)}finally{setBusy(false)}
  }
  if(!data)return <div className="settings">{error?<div className="alert error">{error}</div>:<p>Caricamento configurazione email…</p>}</div>;
  const s=data.settings||{};
  return <div className="settings">
    {error&&<div className="alert error" role="alert">{error}</div>}
    {notice&&<div className="alert success" role="status">{notice}</div>}
    <section className="settings-card">
      <h2>Mittente aziendale</h2>
      <p>Le email operative inviate ai clienti possono usare l’identità della tua azienda. Le comunicazioni di sistema e di accesso restano inviate da luviqAI.</p>
      <div className="alert">
        <b>Trasporto: {data.mode==='resend'?'API HTTPS Resend':data.mode==='smtp'?'SMTP piattaforma':'Simulazione'}</b>
        <p>Per usare un indirizzo del tuo dominio come mittente, il dominio deve essere autorizzato nel servizio email della piattaforma. La password della tua casella non viene richiesta né salvata.</p>
      </div>
      <form onSubmit={save}>
        <label>Nome mittente<input name="senderName" required maxLength={150} defaultValue={s.senderName||''} placeholder="es. My Clean Multiservice"/></label>
        <label>Email mittente<input name="senderEmail" type="email" required defaultValue={s.senderEmail||''} placeholder="es. preventivi@azienda.it"/></label>
        <label>Reply-To<input name="replyTo" type="email" defaultValue={s.replyTo||''} placeholder="es. info@azienda.it"/></label>
        <label className="checkbox"><input name="enabled" type="checkbox" defaultChecked={!!s.enabled}/> Usa questo mittente per le email operative dell’azienda</label>
        <p className="help">Se il mittente non è configurato o è disattivato, luviqAI utilizza il mittente di piattaforma previsto dalla configurazione del servizio.</p>
        <button disabled={busy}>{busy?'Salvataggio…':'Salva configurazione'}</button>
      </form>
    </section>
    <section className="settings-card">
      <h2>Verifica invio</h2>
      <p>Invia un messaggio di prova per controllare dominio, mittente e Reply-To prima di usare preventivi e altre comunicazioni reali.</p>
      <form onSubmit={test}>
        <label>Invia email di prova a<input name="recipient" type="email" required defaultValue={session.user.email}/></label>
        <button disabled={busy||!s.enabled}>{busy?'Invio…':'Invia email di prova'}</button>
      </form>
      {!s.enabled&&<p className="help">Salva e abilita prima il mittente aziendale.</p>}
    </section>
  </div>;
}
