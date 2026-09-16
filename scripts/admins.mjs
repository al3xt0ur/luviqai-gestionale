import {connectStore,migrate} from '../server/storage.mjs';
import {provisionAdmins} from '../server/platform.mjs';
import {secret} from '../server/auth.mjs';
import {createInterface} from 'node:readline/promises';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const store=await connectStore({url:process.env.DATABASE_URL,path:process.env.PGLITE_PATH||resolve(root,'data/postgres')});
const prompt=createInterface({input:process.stdin,output:process.stdout});
try {
  await migrate(store);let accounts=[];
  if(process.argv[2])accounts=JSON.parse(await readFile(resolve(process.argv[2]),'utf8'));
  else for(let n=1;n<=2;n++)accounts.push({name:await prompt.question(`Nome amministratore ${n}: `),email:await prompt.question(`Email amministratore ${n}: `)});
  accounts=accounts.map(a=>({name:a.name,email:a.email,password:secret()}));
  const output=resolve(root,'data/accessi-amministratori.txt');await mkdir(resolve(root,'data'),{recursive:true});
  // Il file viene scritto una sola volta e non sovrascrive credenziali esistenti.
  await writeFile(output,'ACCESSI AMMINISTRATORI LUVIQAI — RISERVATI\n\n'+accounts.map(a=>`Nome: ${a.name}\nCodice accesso: luviqai\nEmail: ${a.email}\nPassword: ${a.password}\n`).join('\n'),{mode:0o600,flag:'wx'});
  await provisionAdmins(store,accounts);console.log('Due amministratori creati. Credenziali in data/accessi-amministratori.txt.');
} finally {prompt.close();await store.close();}
