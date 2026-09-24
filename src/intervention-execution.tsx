import {useEffect,useMemo,useRef,useState} from 'react';
import {post,Session} from './access';

type ChecklistItem={id:string;text:string;done:boolean};
type MaterialItem={id:string;text:string};
type Execution={timerStartedAt?:string|null;elapsedSeconds?:number;checklist?:ChecklistItem[];materials?:MaterialItem[];reportNotes?:string;signatureName?:string;signatureData?:string};
type Intervention={id:number;service:string;date:string;status:string;execution?:Execution|null;attachments?:any[]};

const durationLabel=(seconds:number)=>{
  const h=Math.floor(seconds/3600),m=Math.floor((seconds%3600)/60),s=seconds%60;
  return [h&&String(h).padStart(2,'0'),String(m).padStart(2,'0'),String(s).padStart(2,'0')].filter(Boolean).join(':');
};

export function InterventionExecution({item,session,onClose,onSaved,onComplete}:{item:Intervention;session:Session;onClose:()=>void;onSaved:()=>Promise<void>;onComplete?:()=>void}){
  const initial=item.execution||{};
  const [checklist,setChecklist]=useState<ChecklistItem[]>(initial.checklist||[]);
  const [materials,setMaterials]=useState<MaterialItem[]>(initial.materials||[]);
  const [notes,setNotes]=useState(initial.reportNotes||'');
  const [signatureName,setSignatureName]=useState(initial.signatureName||'');
  const [signatureData,setSignatureData]=useState(initial.signatureData||'');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[now,setNow]=useState(Date.now()),[timerStartedAt,setTimerStartedAt]=useState<string|null>(initial.timerStartedAt||null),[elapsedSeconds,setElapsedSeconds]=useState(Number(initial.elapsedSeconds||0));
  const [newCheck,setNewCheck]=useState(''),[newMaterial,setNewMaterial]=useState('');
  const canvas=useRef<HTMLCanvasElement|null>(null),drawing=useRef(false);
  const liveSeconds=useMemo(()=>timerStartedAt?elapsedSeconds+Math.max(0,Math.floor((now-Date.parse(timerStartedAt))/1000)):elapsedSeconds,[elapsedSeconds,timerStartedAt,now]);

  useEffect(()=>{if(!timerStartedAt)return;const id=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(id)},[timerStartedAt]);
  useEffect(()=>{
    const c=canvas.current;if(!c)return;
    const ctx=c.getContext('2d');if(!ctx)return;
    ctx.lineWidth=2;ctx.lineCap='round';ctx.strokeStyle='#173c43';
    if(signatureData){const img=new Image();img.onload=()=>ctx.drawImage(img,0,0,c.width,c.height);img.src=signatureData;}
  },[]);

  function point(e:React.PointerEvent<HTMLCanvasElement>){
    const c=e.currentTarget,r=c.getBoundingClientRect();
    return {x:(e.clientX-r.left)*(c.width/r.width),y:(e.clientY-r.top)*(c.height/r.height)};
  }
  function down(e:React.PointerEvent<HTMLCanvasElement>){drawing.current=true;e.currentTarget.setPointerCapture(e.pointerId);const p=point(e),ctx=e.currentTarget.getContext('2d');ctx?.beginPath();ctx?.moveTo(p.x,p.y)}
  function move(e:React.PointerEvent<HTMLCanvasElement>){if(!drawing.current)return;const p=point(e),ctx=e.currentTarget.getContext('2d');ctx?.lineTo(p.x,p.y);ctx?.stroke()}
  function up(e:React.PointerEvent<HTMLCanvasElement>){drawing.current=false;setSignatureData(e.currentTarget.toDataURL('image/png'))}
  function clearSignature(){const c=canvas.current;c?.getContext('2d')?.clearRect(0,0,c.width,c.height);setSignatureData('')}

  async function action(name:string,input:any={},close=true){
    setBusy(true);setError('');
    try{
      await post(name,{id:item.id,...input},session.csrf,session.user.tenantId);
      if(name==='execution-start'){setTimerStartedAt(new Date().toISOString());setNow(Date.now())}
      if(name==='execution-stop'){setElapsedSeconds(liveSeconds);setTimerStartedAt(null)}
      await onSaved();
      if(close)onClose();
    }
    catch(e:any){setError(e.message)}finally{setBusy(false)}
  }
  async function save(){
    await action('execution-save',{checklist,materials,reportNotes:notes,signatureName,signatureData});
  }
  function addChecklist(){const text=newCheck.trim();if(!text)return;setChecklist(v=>[...v,{id:crypto.randomUUID(),text,done:false}]);setNewCheck('')}
  function addMaterial(){const text=newMaterial.trim();if(!text)return;setMaterials(v=>[...v,{id:crypto.randomUUID(),text}]);setNewMaterial('')}

  return <div className="overlay" onClick={e=>{if(e.target===e.currentTarget&&!busy)onClose()}}>
    <section role="dialog" aria-modal="true" className="modal execution-modal">
      <div className="row"><div><h2>Rapportino intervento #{item.id}</h2><p>{item.service} · {new Date(item.date).toLocaleString('it-IT')}</p></div><button className="text" disabled={busy} onClick={onClose}>×</button></div>
      {error&&<div className="alert error">{error}</div>}

      <section className="settings-card">
        <div className="row"><div><h3>Timer attività</h3><p>Tempo registrato: <strong>{durationLabel(liveSeconds)}</strong></p></div>
          {timerStartedAt?<button disabled={busy} onClick={()=>action('execution-stop',{},false)}>■ Ferma timer</button>:<button disabled={busy||item.status==='cancelled'} onClick={()=>action('execution-start',{},false)}>▶ Avvia timer</button>}
        </div>
      </section>

      <section className="settings-card">
        <h3>Checklist</h3>
        {checklist.map((x,index)=><div className="check-row" key={x.id}><input type="checkbox" checked={x.done} onChange={e=>setChecklist(v=>v.map((z,i)=>i===index?{...z,done:e.target.checked}:z))}/><span className={x.done?'done':''}>{x.text}</span><button className="text danger" onClick={()=>setChecklist(v=>v.filter((_,i)=>i!==index))}>Rimuovi</button></div>)}
        <div className="form-grid"><input value={newCheck} onChange={e=>setNewCheck(e.target.value)} maxLength={300} placeholder="Es. Verifica quadro elettrico"/><button type="button" className="secondary" onClick={addChecklist}>＋ Voce</button></div>
      </section>

      <section className="settings-card">
        <h3>Materiali utilizzati</h3>
        {materials.map((x,index)=><div className="check-row" key={x.id}><span>• {x.text}</span><button className="text danger" onClick={()=>setMaterials(v=>v.filter((_,i)=>i!==index))}>Rimuovi</button></div>)}
        <div className="form-grid"><input value={newMaterial} onChange={e=>setNewMaterial(e.target.value)} maxLength={300} placeholder="Es. Filtro HEPA × 2"/><button type="button" className="secondary" onClick={addMaterial}>＋ Materiale</button></div>
      </section>

      <label>Note tecniche<textarea value={notes} onChange={e=>setNotes(e.target.value)} maxLength={5000} rows={5}/></label>

      <section className="settings-card">
        <h3>Firma cliente</h3>
        <label>Nome firmatario<input value={signatureName} onChange={e=>setSignatureName(e.target.value)} maxLength={200}/></label>
        <canvas ref={canvas} width={700} height={180} className="signature-pad" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={()=>drawing.current=false}/>
        <div className="actions"><button type="button" className="secondary" onClick={clearSignature}>Cancella firma</button></div>
      </section>

      <div className="modal-footer execution-footer">
        <a className="button secondary" href={'/api/interventions/'+item.id+'/report.pdf?company='+encodeURIComponent(session.user.tenantId)} target="_blank" rel="noreferrer">↓ PDF</a>
        <button className="secondary" disabled={busy} onClick={onClose}>Chiudi</button>
        <button disabled={busy} onClick={save}>{busy?'Salvataggio…':'Salva rapportino'}</button>
        {item.status==='planned'&&onComplete&&<button disabled={busy||!!timerStartedAt} onClick={onComplete}>{timerStartedAt?'Ferma prima il timer':'Completa intervento →'}</button>}
      </div>
    </section>
  </div>
}
