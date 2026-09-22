import {fail} from './domain.mjs';

const allowedTypes=new Set(['image/jpeg','image/png','image/webp','application/pdf']);
const MAX_BYTES=5*1024*1024;

export function storageConfig(env=process.env){
  const base=String(env.STORAGE_SUPABASE_URL||'').replace(/\/$/,'');
  const key=String(env.STORAGE_SERVICE_ROLE_KEY||'');
  const bucket=String(env.STORAGE_BUCKET||'luviqai-private').trim();
  return {base,key,bucket,available:!!(base&&key&&bucket)};
}

function configured(config){
  if(!config.available)fail('Storage privato non configurato sul server.',503);
}
function headers(config,extra={}){
  return {Authorization:'Bearer '+config.key,apikey:config.key,...extra};
}
function objectUrl(config,key){
  return config.base+'/storage/v1/object/'+encodeURIComponent(config.bucket)+'/'+key.split('/').map(encodeURIComponent).join('/');
}
export function validateAttachment({filename,contentType,bytes}){
  filename=String(filename||'').trim();
  contentType=String(contentType||'').toLowerCase();
  if(!filename||filename.length>180)fail('Nome allegato non valido.');
  if(!allowedTypes.has(contentType))fail('Formato allegato non consentito. Usa JPG, PNG, WEBP o PDF.');
  if(!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>MAX_BYTES)fail('L’allegato deve avere dimensione massima 5 MB.');
  const signatures={
    'image/jpeg':bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff,
    'image/png':bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])),
    'image/webp':bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP',
    'application/pdf':bytes.length>=5&&bytes.toString('ascii',0,5)==='%PDF-'
  };
  if(!signatures[contentType])fail('Il contenuto del file non corrisponde al formato dichiarato.');
  return {filename:filename.replace(/[\r\n"]/g,'_'),contentType,sizeBytes:bytes.length};
}
export async function putPrivateObject(config,key,bytes,contentType,fetchImpl=fetch){
  configured(config);
  const res=await fetchImpl(objectUrl(config,key),{method:'POST',headers:headers(config,{'Content-Type':contentType,'x-upsert':'false'}),body:bytes});
  if(!res.ok){const detail=(await res.text()).slice(0,500);const error=Error('Upload storage non riuscito.');error.detail=detail;throw error;}
}
export async function getPrivateObject(config,key,fetchImpl=fetch){
  configured(config);
  const res=await fetchImpl(objectUrl(config,key),{headers:headers(config)});
  if(!res.ok){if(res.status===404)fail('Allegato non trovato.',404);throw Error('Download storage non riuscito.');}
  return {bytes:Buffer.from(await res.arrayBuffer()),contentType:res.headers.get('content-type')||'application/octet-stream'};
}
export async function deletePrivateObject(config,key,fetchImpl=fetch){
  configured(config);
  const endpoint=config.base+'/storage/v1/object/'+encodeURIComponent(config.bucket);
  const res=await fetchImpl(endpoint,{method:'DELETE',headers:headers(config,{'Content-Type':'application/json'}),body:JSON.stringify({prefixes:[key]})});
  if(!res.ok)throw Error('Eliminazione storage non riuscita.');
}
