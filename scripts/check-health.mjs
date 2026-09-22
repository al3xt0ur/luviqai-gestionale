const target=process.argv[2]||process.env.HEALTHCHECK_URL;
const expectedRelease=process.argv[3]||process.env.EXPECTED_RELEASE||'';
if(!target)throw Error('HEALTHCHECK_URL non configurato.');
if(expectedRelease&&!/^[0-9a-f]{7,40}$/i.test(expectedRelease))throw Error('EXPECTED_RELEASE deve essere uno SHA Git valido.');

const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),15000);
try{
  const response=await fetch(target,{headers:{'User-Agent':'luviqAI-healthcheck/1.0'},signal:controller.signal});
  let body={};
  try{body=await response.json();}catch{}
  const releaseOk=!expectedRelease||body?.release?.toLowerCase()===expectedRelease.toLowerCase();
  if(!response.ok||body?.ok!==true||body?.status!=='ok'||!releaseOk){
    console.error('Health check fallito:',response.status,body?.status||'risposta non valida',!releaseOk?`release ${body?.release||'unknown'}, attesa ${expectedRelease}`:'');
    process.exitCode=1;
  }else{
    console.log('Health check OK:',target,body.checkedAt||'',body.release||'release unknown');
  }
}catch(error){
  console.error('Health check non raggiungibile:',error.name||error.message);
  process.exitCode=1;
}finally{
  clearTimeout(timer);
}
