import {randomUUID} from 'node:crypto';
import {one,tenantTransaction} from './storage.mjs';
import {fail} from './domain.mjs';
import {storageConfig,validateAttachment,putPrivateObject,getPrivateObject,deletePrivateObject} from './private-storage.mjs';

function decodeBase64(value){
  const match=String(value||'').match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/);
  if(!match)fail('Contenuto allegato non valido.');
  return {declaredType:match[1].toLowerCase(),bytes:Buffer.from(match[2],'base64')};
}
async function assertAccess(tx,actor,interventionId){
  const row=await one(tx,'SELECT i.id,i.assigned_user_id, EXISTS(SELECT 1 FROM intervention_assignments a WHERE a.tenant_id=i.tenant_id AND a.intervention_id=i.id AND a.user_id=$3) AS assigned FROM interventions i WHERE i.tenant_id=$1 AND i.id=$2',[actor.tenantId,interventionId,actor.id]);
  if(!row)fail('Intervento non trovato.',404);
  if(actor.role==='operator'&&!row.assigned&&row.assigned_user_id!==actor.id)fail('Intervento non assegnato al tuo account.',403);
  return row;
}
export const attachmentStorageStatus=()=>({available:storageConfig().available,maxBytes:5*1024*1024,types:['image/jpeg','image/png','image/webp','application/pdf']});

export async function createAttachment(store,actor,input,fetchImpl=fetch){
  const interventionId=Number(input?.interventionId);
  if(!Number.isSafeInteger(interventionId)||interventionId<1)fail('Intervento non valido.');
  const decoded=decodeBase64(input?.data);
  const meta=validateAttachment({filename:input?.filename,contentType:input?.contentType||decoded.declaredType,bytes:decoded.bytes});
  if(meta.contentType!==decoded.declaredType)fail('Tipo file non coerente.');
  const config=storageConfig(),id=randomUUID(),key=actor.tenantId+'/'+interventionId+'/'+id;
  await tenantTransaction(store,actor.tenantId,async tx=>{await assertAccess(tx,actor,interventionId);});
  await putPrivateObject(config,key,decoded.bytes,meta.contentType,fetchImpl);
  try{
    return await tenantTransaction(store,actor.tenantId,async tx=>{
      await assertAccess(tx,actor,interventionId);
      const row=await one(tx,'INSERT INTO intervention_attachments (tenant_id,id,intervention_id,storage_key,filename,content_type,size_bytes,created,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,intervention_id,filename,content_type,size_bytes,created,created_by',[actor.tenantId,id,interventionId,key,meta.filename,meta.contentType,meta.sizeBytes,new Date().toISOString(),actor.id]);
      return {id:row.id,interventionId:row.intervention_id,filename:row.filename,contentType:row.content_type,sizeBytes:row.size_bytes,created:row.created,createdBy:row.created_by};
    });
  }catch(error){
    try{await deletePrivateObject(config,key,fetchImpl);}catch{}
    throw error;
  }
}

export async function readAttachment(store,actor,id,fetchImpl=fetch){
  const row=await tenantTransaction(store,actor.tenantId,async tx=>{
    const found=await one(tx,'SELECT * FROM intervention_attachments WHERE tenant_id=$1 AND id=$2',[actor.tenantId,id]);
    if(!found)fail('Allegato non trovato.',404);
    await assertAccess(tx,actor,found.intervention_id);
    return found;
  });
  const object=await getPrivateObject(storageConfig(),row.storage_key,fetchImpl);
  return {meta:row,...object};
}

export async function removeAttachment(store,actor,input,fetchImpl=fetch){
  const id=String(input?.id||'');
  const row=await tenantTransaction(store,actor.tenantId,async tx=>{
    const found=await one(tx,'SELECT * FROM intervention_attachments WHERE tenant_id=$1 AND id=$2',[actor.tenantId,id]);
    if(!found)fail('Allegato non trovato.',404);
    await assertAccess(tx,actor,found.intervention_id);
    return found;
  });
  await deletePrivateObject(storageConfig(),row.storage_key,fetchImpl);
  await tenantTransaction(store,actor.tenantId,async tx=>{await tx.query('DELETE FROM intervention_attachments WHERE tenant_id=$1 AND id=$2',[actor.tenantId,id]);});
  return {ok:true,id};
}
