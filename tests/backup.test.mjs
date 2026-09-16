import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {connectStore,migrate} from '../server/storage.mjs';
import {provision,login} from '../server/auth.mjs';
import {mutate,snapshot} from '../server/domain.mjs';
import {backupStore,restoreStore} from '../server/backup.mjs';
import {createHash} from 'node:crypto';

test('backup completo, ripristino verificato, checksum e protezione dati esistenti',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'luviq-backup-')),path=join(dir,'backup.json');
  const a=await connectStore(),b=await connectStore();
  try{
    await migrate(a);await migrate(b);
    const actor=await provision(a,{slug:'backup',name:'Backup',email:'admin@example.com',password:'Backup-password-2026!'});
    await mutate(a,actor,'client',{name:'Conservato'},'client-key');
    const model=(await mutate(a,actor,'template',{name:'Offerta da conservare',minutes:615,rule:'team'},'template-key')).value;
    await mutate(a,actor,'package',{clientId:1,templateId:model.id,templateRevision:1,initial:500,paid:true},'package-key');
    await backupStore(a,path);await restoreStore(b,path);
    assert.deepEqual(await snapshot(a,actor),await snapshot(b,actor));
    // Simula il formato precedente: nessuna tabella catalogo e nessun riferimento al modello.
    const legacy=JSON.parse(readFileSync(path));delete legacy.data.package_templates;
    for(const p of legacy.data.packages){delete p.template_id;delete p.template_revision;delete p.description;}
    legacy.checksum=createHash('sha256').update(JSON.stringify(legacy.data)).digest('hex');
    const legacyPath=join(dir,'legacy.json');writeFileSync(legacyPath,JSON.stringify(legacy));
    const legacyStore=await connectStore();
    try {
      await migrate(legacyStore);await restoreStore(legacyStore,legacyPath);
      const restored=await snapshot(legacyStore,actor);
      assert.equal(restored.catalog.length,1);assert.equal(restored.catalog[0].minutes,615);
      assert.equal(restored.packages[0].free,500);assert.equal(restored.packages[0].templateId,restored.catalog[0].id);
      await migrate(legacyStore);assert.deepEqual(await snapshot(legacyStore,actor),restored);
    }finally{await legacyStore.close();}
    await mutate(b,actor,'client',{name:'Conservato'},'client-key');assert.equal((await snapshot(b,actor)).clients.length,1);
    assert.equal((await login(b,{slug:'backup',email:actor.email,password:'Backup-password-2026!'},'test')).user.id,actor.id);
    await assert.rejects(restoreStore(b,path),/vuoto/);
    const content=JSON.parse(readFileSync(path));content.data.clients[0].name='Manomesso';writeFileSync(path,JSON.stringify(content));
    await assert.rejects(restoreStore(b,path),/checksum/);
  }finally{await a.close();await b.close();rmSync(dir,{recursive:true,force:true});}
});
