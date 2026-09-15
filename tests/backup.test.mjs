import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {connectStore,migrate} from '../server/storage.mjs';
import {provision,login} from '../server/auth.mjs';
import {mutate,snapshot} from '../server/domain.mjs';
import {backupStore,restoreStore} from '../server/backup.mjs';

test('backup completo, ripristino verificato, checksum e protezione dati esistenti',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'luviq-backup-')),path=join(dir,'backup.json');
  const a=await connectStore(),b=await connectStore();
  try{
    await migrate(a);await migrate(b);
    const actor=await provision(a,{slug:'backup',name:'Backup',email:'admin@example.com',password:'Backup-password-2026!'});
    await mutate(a,actor,'client',{name:'Conservato'},'client-key');
    await backupStore(a,path);await restoreStore(b,path);
    assert.deepEqual(await snapshot(a,actor),await snapshot(b,actor));
    await mutate(b,actor,'client',{name:'Conservato'},'client-key');assert.equal((await snapshot(b,actor)).clients.length,1);
    assert.equal((await login(b,{slug:'backup',email:actor.email,password:'Backup-password-2026!'},'test')).user.id,actor.id);
    await assert.rejects(restoreStore(b,path),/vuoto/);
    const content=JSON.parse(readFileSync(path));content.data.clients[0].name='Manomesso';writeFileSync(path,JSON.stringify(content));
    await assert.rejects(restoreStore(b,path),/checksum/);
  }finally{await a.close();await b.close();rmSync(dir,{recursive:true,force:true});}
});
