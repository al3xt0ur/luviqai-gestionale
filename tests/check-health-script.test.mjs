import '../scripts/test-isolation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';

const script=fileURLToPath(new URL('../scripts/check-health.mjs',import.meta.url));
const release='4146e072a981a373e45459bfca16335f7950772b';

async function execute(url,expected){
  const child=spawn(process.execPath,[script,url,expected],{env:process.env,stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  const [code]=await once(child,'exit');
  return {code,output};
}

test('health staging: lo SHA atteso certifica la release e un valore diverso fallisce',async()=>{
  const server=createServer((_req,res)=>{
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({ok:true,status:'ok',checkedAt:new Date().toISOString(),release}));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const {port}=server.address();const url=`http://127.0.0.1:${port}/api/health`;
  try{
    const valid=await execute(url,release);
    assert.equal(valid.code,0);assert.match(valid.output,/Health check OK/);
    const invalid=await execute(url,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    assert.notEqual(invalid.code,0);assert.match(invalid.output,/release .* attesa/i);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
