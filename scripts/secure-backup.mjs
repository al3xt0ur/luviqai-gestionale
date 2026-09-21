import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {connectStore,migrate} from '../server/storage.mjs';
import {backupStore,restoreStore} from '../server/backup.mjs';
import {encryptBackup,decryptBackup} from '../server/backup-crypto.mjs';

const action=process.argv[2],target=process.argv[3];
if(!['backup','verify'].includes(action)||!target)throw Error('Uso: node scripts/secure-backup.mjs backup|verify percorso-file.luviqbak');

async function createEncryptedBackup(output){
  if(!process.env.DATABASE_URL)throw Error('DATABASE_URL mancante.');
  const dir=await mkdtemp(join(tmpdir(),'luviq-secure-backup-'));
  const plain=join(dir,'backup.json');
  const store=await connectStore({url:process.env.DATABASE_URL});
  try{
    await migrate(store);
    await backupStore(store,plain);
    const content=await readFile(plain);
    const envelope=encryptBackup(content);
    await mkdir(dirname(output),{recursive:true});
    await writeFile(output+'.tmp',JSON.stringify(envelope),{mode:0o600});
    await rm(output,{force:true});
    await import('node:fs/promises').then(({rename})=>rename(output+'.tmp',output));
    console.log('Backup cifrato completato.');
  }finally{
    await store.close();
    await rm(dir,{recursive:true,force:true});
  }
}

async function verifyEncryptedBackup(input){
  const dir=await mkdtemp(join(tmpdir(),'luviq-restore-check-'));
  const plain=join(dir,'backup.json'),dbPath=join(dir,'restore-db');
  let store;
  try{
    const envelope=JSON.parse(await readFile(input,'utf8'));
    const decrypted=decryptBackup(envelope);
    await writeFile(plain,decrypted,{mode:0o600});
    store=await connectStore({path:dbPath});
    await migrate(store);
    await restoreStore(store,plain);
    console.log('Verifica restore completata su database temporaneo.');
  }finally{
    if(store)await store.close();
    await rm(dir,{recursive:true,force:true});
  }
}

const file=resolve(target);
if(action==='backup')await createEncryptedBackup(file);
else await verifyEncryptedBackup(file);
