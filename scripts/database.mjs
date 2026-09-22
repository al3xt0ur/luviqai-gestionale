import {connectStore,migrate,one} from '../server/storage.mjs';
import {backupStore,restoreStore} from '../server/backup.mjs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const action=process.argv[2],path=process.argv[3];
if(!['backup','restore','migrate'].includes(action)||(action!=='migrate'&&!path))throw Error('Uso: node scripts/database.mjs backup|restore percorso-file.json oppure migrate');
const store=await connectStore({url:process.env.DATABASE_URL,path:process.env.PGLITE_PATH||resolve(root,'data/postgres')});
try{
  // A backup must never mutate the schema before taking the snapshot.
  if(action==='backup')await backupStore(store,resolve(path));
  else if(action==='migrate')await migrate(store);
  else {
    const existing=await one(store,"SELECT to_regclass('public.tenants') AS name");
    if(existing.name&&Number((await one(store,'SELECT count(*) AS count FROM tenants')).count))throw Error('Ripristino consentito solo in un database vuoto.');
    await migrate(store);await restoreStore(store,resolve(path));
  }
  console.log(action==='backup'?'Backup completato.':action==='migrate'?'Migrazione completata.':'Ripristino completato. Le vecchie sessioni non sono state ripristinate.');
}finally{await store.close();}
