import '../scripts/test-isolation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {connectStore} from '../server/storage.mjs';

test('test: credenziali e destinazioni ereditate vengono rimosse anche nei processi figli',()=>{
 const code=`await import('./scripts/test-isolation.mjs'); console.log(JSON.stringify({mode:process.env.LUVIQ_TEST_MODE,database:process.env.DATABASE_URL,mail:process.env.MAIL_MODE,key:process.env.RESEND_API_KEY,ai:process.env.OPENROUTER_API_KEY,origin:process.env.APP_ORIGIN,path:process.env.PGLITE_PATH}));`;
 const output=execFileSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',env:{...process.env,DATABASE_URL:'postgres://fake:fake@invalid.example/prod',MAIL_MODE:'resend',RESEND_API_KEY:'fake',OPENROUTER_API_KEY:'fake',APP_ORIGIN:'https://invalid.example',PGLITE_PATH:'data/postgres'}});
 assert.deepEqual(JSON.parse(output),{mode:'1',database:'',mail:'preview'});
});
test('test: configurazioni esplicite non possono aprire PostgreSQL esterno o il database operativo',async()=>{
 await assert.rejects(connectStore({url:'postgres://fake:fake@invalid.example/prod'}),/esterne vietate/);
 await assert.rejects(connectStore({path:'data/postgres'}),/cartella temporanea/);
 const db=await connectStore();try{assert.equal((await db.query('SELECT 1 AS ok')).rows[0].ok,1);}finally{await db.close();}
});
