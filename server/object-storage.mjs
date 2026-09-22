import {randomUUID} from 'node:crypto';

const MAX_BYTES=8*1024*1024;
const ALLOWED=new Set([
  'image/jpeg','image/png','image/webp','application/pdf',
  'text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);

export function storageConfig(env=process.env){
  const url=String(env.SUPABASE_URL||'').replace(/\/$/,'');
  const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');
  const bucket=String(env.SUPABASE_STORAGE_BUCKET||'luviqai-private');
  return {url,key,bucket,configured:!!url&&!!key&&!!bucket,maxBytes:MAX_BYTES};
}

function safeName(value){
  const raw=decodeURIComponent(String(value||'file')).normalize('NFKC').replace(/[\r\n]/g,' ').trim();
  const cleaned=raw.replace(/[^\p{L}\p{N}._ -]+/gu,'_').replace(/\s+/g,' ').slice(0,180);
  return cleaned||'file';
}

function assertConfigured(config){
  if(!config.configured){
    const error=Error('Archivio allegati non configurato.');
    error.status=503;
    throw error;
  }
}

function assertFile({contentType,size}){
  if(!ALLOWED.has(contentType)){
    const error=Error('Tipo di file non consentito. Usa JPG, PNG, WebP, PDF, TXT o DOCX.');
    error.status=415;throw error;
  }
  if(!Number.isInteger(size)||size<1||size>MAX_BYTES){
    const error=Error('Il file deve avere dimensione compresa tra 1 byte e 8 MB.');
    error.status=413;throw error;
  }
}

function headers(config,extra={}){
  return {authorization:`Bearer ${config.key}`,apikey:config.key,...extra};
}

async function storageFetch(config,path,options={}){
  assertConfigured(config);
  const response=await fetch(config.url+'/storage/v1/'+path,{...options,headers:{...headers(config),...(options.headers||{})}});
  if(!response.ok){
    let detail='';
    try{detail=await response.text();}catch{}
    const error=Error('Operazione sull’archivio allegati non riuscita.');
    error.status=response.status===404?404:502;
    error.cause=detail.slice(0,500);
    throw error;
  }
  return response;
}

export async function uploadObject(config,{tenantId,interventionId,filename,contentType,buffer}){
  assertFile({contentType,size:buffer.length});
  const id=randomUUID(),name=safeName(filename);
  const storageKey=`${tenantId}/interventions/${interventionId}/${id}-${encodeURIComponent(name)}`;
  await storageFetch(config,`object/${config.bucket}/${storageKey}`,{
    method:'POST',
    headers:{'content-type':contentType,'x-upsert':'false'},
    body:buffer
  });
  return {id,storageKey,filename:name,contentType,sizeBytes:buffer.length};
}

export async function downloadObject(config,storageKey){
  const response=await storageFetch(config,`object/authenticated/${config.bucket}/${storageKey}`,{method:'GET'});
  return {buffer:Buffer.from(await response.arrayBuffer()),contentType:response.headers.get('content-type')||'application/octet-stream'};
}

export async function deleteObject(config,storageKey){
  await storageFetch(config,`object/${config.bucket}/${storageKey}`,{method:'DELETE'});
}

export const attachmentRules={maxBytes:MAX_BYTES,allowed:[...ALLOWED]};
