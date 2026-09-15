import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { one } from './storage.mjs';
import { provision, secret, manageUser } from './auth.mjs';
import { insert } from './domain.mjs';

export async function importLegacy(store,tenantId,path) {
  if(!existsSync(path))return false;
  if(await one(store,'SELECT * FROM imports WHERE source=$1',['sqlite-v1']))return false;
  const legacy=new DatabaseSync(path,{readOnly:true});
  let records;
  try {records=Object.fromEntries(['clients','packages','interventions','audit'].map(table=>[table,legacy.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]));}
  finally {legacy.close();}
  await store.transaction(async tx=>{
    await tx.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE',[tenantId]);
    if(await one(tx,'SELECT * FROM imports WHERE source=$1',['sqlite-v1']))return;
    if(Number((await one(tx,'SELECT count(*) AS n FROM clients WHERE tenant_id=$1',[tenantId])).n)!==0)throw Error('Importazione consentita solo in un’azienda vuota.');
    for(const [table,list] of Object.entries(records))for(const record of list)await insert(tx,tenantId,table,record,record.id);
    await tx.query('INSERT INTO imports VALUES($1,$2,$3)',['sqlite-v1',tenantId,new Date().toISOString()]);
  });
  return true;
}

export async function bootstrapLocal(store,dataDir,legacyPath) {
  if(await one(store,'SELECT id FROM tenants LIMIT 1'))return;
  // Credenziali casuali solo per l'ambiente locale, mai inserite nei sorgenti.
  const firstPassword=secret(),secondPassword=secret(),operatorPassword=secret();
  const first=await provision(store,{slug:'my-clean',name:'My Clean Multiservice',email:'responsabile@example.com',password:firstPassword});
  await importLegacy(store,first.tenantId,legacyPath);
  const second=await provision(store,{slug:'impresa-demo',name:'Impresa Demo · spazio separato',email:'responsabile@example.com',password:secondPassword});
  await manageUser(store,first,{name:'Operatore demo',email:'operatore@example.com',password:operatorPassword,role:'operator'});
  await mkdir(dataDir,{recursive:true});
  await writeFile(join(dataDir,'accessi-locali.txt'),`ACCESSI RISERVATI ALLA PROVA LOCALE\nNon condividere questo file e non pubblicarlo.\n\nAzienda: my-clean\nEmail: responsabile@example.com\nPassword: ${firstPassword}\n\nAzienda: impresa-demo\nEmail: responsabile@example.com\nPassword: ${secondPassword}\n\nAzienda: my-clean\nEmail: operatore@example.com\nPassword: ${operatorPassword}\n\nLe password sono modificabili dalla sezione Azienda e account.\n`,{mode:0o600});
  return {first,second};
}
