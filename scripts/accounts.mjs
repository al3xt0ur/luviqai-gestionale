import { connectStore, migrate } from '../server/storage.mjs';
import { provision, createReset, secret } from '../server/auth.mjs';
import { createInterface } from 'node:readline/promises';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const store=await connectStore({url:process.env.DATABASE_URL,path:process.env.PGLITE_PATH||resolve(root,'data/postgres')});
const prompt=createInterface({input:process.stdin,output:process.stdout});
try {
  await migrate(store);
  const action=process.argv[2];
  const slug=await prompt.question('Codice azienda (es. impresa-rossi): ');
  const email=await prompt.question('Email del responsabile: ');
  await mkdir(resolve(root,'data'),{recursive:true});
  if(action==='create') {
    const name=await prompt.question('Nome impresa: '),password=secret();
    await provision(store,{slug,name,email,password});
    await writeFile(resolve(root,'data/nuovo-account.txt'),`Azienda: ${slug}\nEmail: ${email}\nPassword iniziale: ${password}\n`,{mode:0o600});
    console.log('Account creato. Credenziali in data/nuovo-account.txt.');
  } else if(action==='reset') {
    const token=await createReset(store,slug,email);
    const origin=process.env.APP_ORIGIN||'http://localhost:3000';
    await writeFile(resolve(root,'data/recupero-accesso.txt'),`${origin}/#reset=${token}\nLink monouso valido 30 minuti.\n`,{mode:0o600});
    console.log('Link di recupero salvato in data/recupero-accesso.txt.');
  } else throw Error('Usare: node scripts/accounts.mjs create oppure reset');
} finally {prompt.close();await store.close();}
