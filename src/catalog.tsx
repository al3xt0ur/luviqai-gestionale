import React,{useState} from 'react';

export type Template={id:number;name:string;description:string;minutes:number;rule:string;active:boolean;revision:number};
export const durationLabel=(minutes:number)=>`${Math.floor(minutes/60)} h${minutes%60?` ${minutes%60} min`:''}`;
const ruleLabel=(rule:string)=>rule==='operator'?'Per operatore · 2 persone × 2 h = 4 h':'Per squadra · 2 persone × 2 h = 2 h';

export function Catalog({items,packages,open}:{items:Template[];packages:any[];open:(kind:string,values?:any)=>void}) {
  const [archived,setArchived]=useState(false);
  const visible=items.filter(t=>archived||t.active);
  return <section aria-label="Catalogo aziendale">
    <div className="catalog-intro"><div><h2>Le offerte della tua impresa</h2><p>Definisci nomi, quantità di ore e conteggio. Ogni cliente riceve una copia delle condizioni scelte: le modifiche successive non cambiano i pacchetti già assegnati.</p></div><button onClick={()=>open('template')}>＋ Nuovo modello</button></div>
    <label className="checkbox"><input type="checkbox" checked={archived} onChange={e=>setArchived(e.target.checked)}/> Mostra anche i modelli disattivati</label>
    {visible.length?<div className="package-grid">{visible.map(t=><article className="package template-card" key={t.id}>
      <div className="row"><span className={'badge '+(t.active?'approved':'cancelled')}>{t.active?'Disponibile':'Disattivato'}</span><small>Versione {t.revision}</small></div>
      <h3>{t.name}</h3><div className="balance">{durationLabel(t.minutes)}</div><p>{ruleLabel(t.rule)}</p>{t.description&&<p>{t.description}</p>}
      <p className="muted">{packages.filter(p=>p.templateId===t.id).length} pacchetti collegati</p>
      <div className="actions"><button className="secondary" onClick={()=>open('template',{item:t})}>Modifica modello</button><button className={'text '+(t.active?'danger':'')} onClick={()=>open('template-status',{item:t})}>{t.active?'Disattiva':'Riattiva'}</button></div>
    </article>)}</div>:<div className="empty"><span>◇</span><h3>{items.length?'Nessun modello attivo':'Il tuo catalogo parte da qui'}</h3><p>{items.length?'Mostra i modelli disattivati per riattivarne uno, oppure crea una nuova offerta.':'Crea il primo modello con il nome e le ore che vuoi offrire ai clienti.'}</p></div>}
  </section>;
}

export function TemplateFields({item}:{item?:Template}) {
  return <>
    <label>Nome del modello *<input name="name" autoFocus required maxLength={120} defaultValue={item?.name||''} placeholder="Es. Pulizia uffici · Mensile"/></label>
    <div className="form-grid"><label>Ore intere *<input name="hours" type="number" required min="0" max="10000" step="1" defaultValue={item?Math.floor(item.minutes/60):10}/></label><label>Minuti aggiuntivi *<input name="extraMinutes" type="number" required min="0" max="59" step="1" defaultValue={item?item.minutes%60:0}/></label></div>
    <p className="help">Da 1 minuto a 10.000 ore. Le quantità sono conservate come minuti interi.</p>
    <label>Regola di conteggio *<select name="rule" defaultValue={item?.rule||'operator'}><option value="operator">{ruleLabel('operator')}</option><option value="team">{ruleLabel('team')}</option></select></label>
    <label>Descrizione<textarea name="description" maxLength={1000} defaultValue={item?.description||''} placeholder="Descrivi i servizi compresi nell’offerta"/></label>
    {item&&<><div className="alert">Stai modificando l’offerta per le prossime assegnazioni e i rinnovi. I pacchetti esistenti conservano le condizioni originali.</div><label>Motivazione della modifica *<textarea name="reason" required maxLength={2000}/></label></>}
  </>;
}

export function PackageFields({catalog,clients,item,clientId,onCatalog}:{catalog:Template[];clients:any[];item?:any;clientId?:number;onCatalog:()=>void}) {
  const active=catalog.filter(t=>t.active);
  const preferred=item?(active.find(t=>t.id===item.templateId)||active.find(t=>t.name===item.tier&&t.minutes===item.original&&t.rule===item.rule)):undefined;
  const [id,setId]=useState<number|string>(preferred?.id||(!item?active[0]?.id:'')||'');
  const selected=active.find(t=>t.id===Number(id));
  return <>
    {!active.length?<div className="alert"><p>Prima di assegnare un pacchetto, crea o riattiva un modello nel catalogo dell’impresa.</p><button type="button" onClick={onCatalog}>Configura catalogo</button></div>:<>
      <label>Cliente *<select name="clientId" required defaultValue={item?.clientId||clientId||''}><option value="" disabled>Seleziona cliente</option>{clients.filter(c=>!c.archived&&(!item||c.id===item.clientId)).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      {item&&<div className="alert">Rinnovo di {item.tier} · {durationLabel(item.original)} · conteggio per {item.rule==='operator'?'operatore':'squadra'}. Scegli e verifica l’offerta attuale: il rinnovo crea un nuovo pacchetto e conserva il precedente.</div>}
      <label>Modello dal catalogo *<select name="templateId" required value={id} onChange={e=>setId(e.target.value)}><option value="" disabled>Seleziona un modello attivo</option>{active.map(t=><option key={t.id} value={t.id}>{t.name} · {durationLabel(t.minutes)} · per {t.rule==='operator'?'operatore':'squadra'}</option>)}</select></label>
      {selected&&<><input type="hidden" name="templateRevision" value={selected.revision}/><div className="catalog-terms"><strong>{selected.name} · {durationLabel(selected.minutes)}</strong><p>{ruleLabel(selected.rule)}</p>{selected.description&&<p>{selected.description}</p>}<small>La regola resta fissata su questo pacchetto.</small></div>
      <label>Saldo iniziale in minuti *<input key={selected.id+':'+selected.revision} name="initial" type="number" min="0" max={selected.minutes} step="1" defaultValue={selected.minutes} required/></label><p className="help">Per importare un pacchetto parzialmente usato, inserisci i minuti rimasti. Il taglio originario viene conservato.</p>
      <label className="checkbox"><input name="paid" type="checkbox"/> Confermo che il pagamento è stato ricevuto</label></>}
    </>}
  </>;
}
