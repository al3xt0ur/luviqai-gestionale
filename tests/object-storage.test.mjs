import '../scripts/test-isolation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {storageConfig,checkBucket,uploadObject,downloadObject,deleteObject} from '../server/object-storage.mjs';

test('object storage: resta disattivato senza segreti',async()=>{
  const config=storageConfig({});
  assert.equal(config.configured,false);
  assert.deepEqual(await checkBucket(config),{configured:false,ready:false});
});

test('object storage: usa solo il backend e conserva il bucket privato',async()=>{
  const original=global.fetch;
  const calls=[];
  global.fetch=async(url,options={})=>{
    calls.push({url:String(url),options});
    if(String(url).includes('/bucket/'))return new Response('',{status:200});
    if(options.method==='POST')return new Response(JSON.stringify({Key:'ok'}),{status:200,headers:{'content-type':'application/json'}});
    if(options.method==='GET')return new Response(Buffer.from('private-file'),{status:200,headers:{'content-type':'application/pdf'}});
    if(options.method==='DELETE')return new Response(JSON.stringify({message:'Successfully deleted'}),{status:200});
    return new Response('',{status:500});
  };
  try{
    const config=storageConfig({
      SUPABASE_URL:'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY:'server-secret',
      SUPABASE_STORAGE_BUCKET:'luviqai-private'
    });
    assert.deepEqual(await checkBucket(config),{configured:true,ready:true});

    const uploaded=await uploadObject(config,{
      tenantId:'tenant-a',interventionId:7,filename:encodeURIComponent('foto prova.jpg'),
      contentType:'image/jpeg',buffer:Buffer.from([1,2,3])
    });
    assert.equal(uploaded.filename,'foto prova.jpg');
    assert.match(uploaded.storageKey,/^tenant-a\/interventions\/7\//);
    const postCall=calls.find(x=>x.options.method==='POST');
    assert.equal(postCall.options.headers.authorization,'Bearer server-secret');
    assert.equal(postCall.options.headers.apikey,'server-secret');
    assert.ok(!JSON.stringify(uploaded).includes('server-secret'));

    const downloaded=await downloadObject(config,uploaded.storageKey);
    assert.equal(downloaded.buffer.toString(),'private-file');
    assert.equal(downloaded.contentType,'application/pdf');

    await deleteObject(config,uploaded.storageKey);
    assert.ok(calls.some(x=>x.options.method==='DELETE'));
  }finally{global.fetch=original}
});

test('object storage: rifiuta file troppo grandi e tipi non consentiti',async()=>{
  const config=storageConfig({SUPABASE_URL:'https://project.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'x',SUPABASE_STORAGE_BUCKET:'private'});
  await assert.rejects(uploadObject(config,{tenantId:'t',interventionId:1,filename:'x.svg',contentType:'image/svg+xml',buffer:Buffer.from('x')}),/Tipo di file non consentito/);
  await assert.rejects(uploadObject(config,{tenantId:'t',interventionId:1,filename:'x.pdf',contentType:'application/pdf',buffer:Buffer.alloc(8*1024*1024+1)}),/8 MB/);
});
