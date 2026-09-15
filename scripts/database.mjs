import {connectStore,migrate} from '../server/storage.mjs';
import {backupStore,restoreStore} from '../server/backup.mjs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const action=process.argv[2],path=process.argv[3];
if(!['backup','restore'].includes(action)||!path)throw Error('Uso: node scripts/database.mjs backup|restore percorso-file.json');
const store=await connectStore({url:process.env.DATABASE_URL,path:process.env.PGLITE_PATH||resolve(root,'data/postgres')});
try{await migrate(store);await(action==='backup'?backupStore(store,resolve(path)):restoreStore(store,resolve(path)));console.log(action==='backup'?'Backup completato.':'Ripristino completato. Le vecchie sessioni non sono state ripristinate.');}finally{await store.close();}
