const target=process.argv[2]||process.env.HEALTHCHECK_URL;
if(!target)throw Error('HEALTHCHECK_URL non configurato.');

const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),15000);
try{
  const response=await fetch(target,{headers:{'User-Agent':'luviqAI-healthcheck/1.0'},signal:controller.signal});
  let body={};
  try{body=await response.json();}catch{}
  if(!response.ok||body?.ok!==true||body?.status!=='ok'){
    console.error('Health check fallito:',response.status,body?.status||'risposta non valida');
    process.exitCode=1;
  }else{
    console.log('Health check OK:',target,body.checkedAt||'');
  }
}catch(error){
  console.error('Health check non raggiungibile:',error.name||error.message);
  process.exitCode=1;
}finally{
  clearTimeout(timer);
}
