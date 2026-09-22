import {useEffect,useMemo,useRef,useState} from 'react';
import {post,Session} from './access';

type ChecklistItem={id:string;text:string;done:boolean};
type MaterialItem={id:string;text:string};
type Execution={timerStartedAt?:string|null;elapsedSeconds?:number;checklist?:ChecklistItem[];materials?:MaterialItem[];reportNotes?:string;signatureName?:string;signatureData?:string};
type Attachment={id:string;filename:string;contentType:string;sizeBytes:number;created:string;createdBy:string};
type Intervention={id:number;service:string;date:string;status:string;execution?:Execution|null;attachments?:Attachment[]};

const durationLabel=(seconds:number)=>{
  const h=Math.floor(seconds/3600),m=Math.floor((seconds%3600)/60),s=seconds%60;
  return [h&&String(h).padStart(2,'0'),String(m).padStart(2,'0'),String(s).padStart(2,'0')].filter(Boolean).join(':');
};

export function InterventionExecution({item,session,onClose,onSaved}:{item:Intervention;session:Session;onClose:()=>void;onSaved:()=>Promise<void>}){
  const initial=item.execution||{};
  const [checklist,setChecklist]=useState<ChecklistItem[]>(initial.checklist||[]);
  const [materials,setMaterials]=useState<MaterialItem[]>(initial.materials||[]);
  const [notes,setNotes]=useState(initial.reportNotes||'');
  const [signatureName,setSignatureName]=useState(initial.signatureName||'');
  const [signatureData,setSignatureData]=useState(initial.signatureData||'');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[now,setNow]=useState(Date.now());
  const [newCheck,setNewCheck]=useState(''),[newMaterial,setNewMaterial]=useState('');
  const [attachments,setAttachments]=useState<Attachment[]>(item.attachments||[]),[storage,setStorage]=useState<any>(null);
  const canvas=useRef<HTMLCanvasElement|null>(null),drawing=useRef(false);
  const liveSeconds=useMemo(()=>{
    const base=Number(initial.elapsedSeconds||0);
    return initial.timerStartedAt?base+Math.max(0,Math.floor((now-Date.parse(initial.timerStartedAt))/1000)):base;
  },[initial.elapsedSeconds,initial.timerStartedAt,now]);

  useEffect(()=>{if(!initial.timerStartedAt)return;const id=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(id)},[initial.timerStartedAt]);
  useEffect(()=>{fetch('/api/storage/status',{headers:{'X-Tenant-Context':session.user.tenantId}}).then(r=>r.ok?r.json():null).then(setStorage).catch(()=>setStorage({available:false}))},[session.user.tenantId]);
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

  async function action(name:string,input:any={}){
    setBusy(true);setError('');
    try{await post(name,{id:item.id,...input},session.csrf,session.user.tenantId);await onSaved();onClose();}
    catch(e:any){setError(e.message)}finally{setBusy(false)}
  }
  async function save(){
    await action('execution-save',{checklist,materials,reportNotes:notes,signatureName,signatureData});
  }
  function addChecklist(){const text=newCheck.trim();if(!text)return;setChecklist(v=>[...v,{id:crypto.randomUUID(),text,done:false}]);setNewCheck('')}
  function addMaterial(){const text=newMaterial.trim();if(!text)return;setMaterials(v=>[...v,{id:crypto.randomUUID(),text}]);setNewMaterial('')}
  async function uploadAttachment(file?:File){
    if(!file)return;
    if(file.size>5*1024*1024){setError('Il file supera il limite di 5 MB.');return;}
    setBusy(true);setError('');
    try{
      const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error('Impossibile leggere il file.'));reader.readAsDataURL(file)});
      const result=await post('intervention-attachment',{interventionId:item.id,filename:file.name,contentType:file.type,data},session.csrf,session.user.tenantId);
      setAttachments(v=>[...v,result]);
      await onSaved();
    }catch(e:any){setError(e.message)}finally{setBusy(false)}
  }
  async function deleteAttachment(file:Attachment){
    if(!confirm('Eliminare '+file.filename+'?'))return;
    setBusy(true);setError('');
    try{await post('intervention-attachment-delete',{id:file.id},session.csrf,session.user.tenantId);setAttachments(v=>v.filter(x=>x.id!==file.id));await onSaved();}
    catch(e:any){setError(e.message)}finally{setBusy(false)}
  }

  return <div className="overlay" onClick={e=>{if(e.target===e.currentTarget&&!busy)onClose()}}>
    <section role="dialog" aria-modal="true" className="modal execution-modal">
      <div className="row"><div><h2>Rapportino intervento #{item.id}</h2><p>{item.service} · {new Date(item.date).toLocaleString('it-IT')}</p></div><button className="text" disabled={busy} onClick={onClose}>×</button></div>
      {error&&<div className="alert error">{error}</div>}

      <section className="settings-card">
        <div className="row"><div><h3>Timer attività</h3><p>Tempo registrato: <strong>{durationLabel(liveSeconds)}</strong></p></div>
          {initial.timerStartedAt?<button disabled={busy} onClick={()=>action('execution-stop')}>■ Stop</button>:<button disabled={busy||item.status==='cancelled'} onClick={()=>action('execution-start')}>▶ Avvia</button>}
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
        <h3>Foto e allegati</h3>
        {storage?.available===false&&<div className="alert">Storage privato non ancora configurato su questo ambiente.</div>}
        {attachments.length?<div className="attachment-list">{attachments.map(file=><div className="attachment-row" key={file.id}><div><strong>{file.filename}</strong><small>{(file.sizeBytes/1024).toLocaleString('it-IT',{maximumFractionDigits:1})} KB · {new Date(file.created).toLocaleString('it-IT')}</small></div><div className="actions"><a className="button secondary" href={'/api/intervention-attachments/'+file.id+'?company='+encodeURIComponent(session.user.tenantId)} target="_blank" rel="noreferrer">Apri</a><button className="text danger" type="button" disabled={busy} onClick={()=>void deleteAttachment(file)}>Elimina</button></div></div>)}</div>:<p className="help">Nessun allegato caricato.</p>}
        <label>Carica foto o PDF<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={busy||storage?.available===false} onChange={e=>{const file=e.target.files?.[0];e.currentTarget.value='';void uploadAttachment(file)}}/></label>
        <p className="help">JPG, PNG, WEBP o PDF · massimo 5 MB per file · archiviazione privata.</p>
      </section>


      <section className="settings-card">
        <h3>Firma cliente</h3>
        <label>Nome firmatario<input value={signatureName} onChange={e=>setSignatureName(e.target.value)} maxLength={200}/></label>
        <canvas ref={canvas} width={700} height={180} className="signature-pad" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={()=>drawing.current=false}/>
        <div className="actions"><button type="button" className="secondary" onClick={clearSignature}>Cancella firma</button></div>
      </section>

      <div className="modal-footer">
        <a className="button secondary" href={'/api/interventions/'+item.id+'/report.pdf?company='+encodeURIComponent(session.user.tenantId)} target="_blank" rel="noreferrer">↓ Rapportino PDF</a>
        <button className="secondary" disabled={busy} onClick={onClose}>Chiudi</button>
        <button disabled={busy} onClick={save}>{busy?'Salvataggio…':'Salva rapportino'}</button>
      </div>
    </section>
  </div>
}
