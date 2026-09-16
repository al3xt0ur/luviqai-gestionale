import {mkdir,writeFile,readFile,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {one,rows} from './storage.mjs';
import {importPackageCatalog} from './catalog.mjs';

const tables=['tenants','users','clients','package_templates','packages','quotes','interventions','audit','requests','imports','platform_audit'];
const checksum=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function backupStore(store,path) {
  const data=await store.transaction(async tx=>{
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    const result={};
    for(const table of tables)result[table]=await rows(tx,`SELECT * FROM ${table}${['clients','packages','interventions','audit'].includes(table)?' ORDER BY tenant_id,id':''}`);
    return result;
  });
  const backup={version:1,created:new Date().toISOString(),checksum:checksum(data),data};
  await mkdir(dirname(path),{recursive:true});
  await writeFile(path+'.tmp',JSON.stringify(backup),{mode:0o600});await rename(path+'.tmp',path);
  return backup;
}

export async function restoreStore(store,path) {
  const backup=JSON.parse(await readFile(path,'utf8'));
  if(backup.version!==1||backup.checksum!==checksum(backup.data))throw Error('Backup non valido o checksum non corrispondente.');
  // I backup della versione 1 precedente al pannello admin non contenevano questo registro.
  if(backup.data.platform_audit===undefined)backup.data.platform_audit=[];
  if(backup.data.quotes===undefined)backup.data.quotes=[];
  const legacyCatalog=backup.data.package_templates===undefined;
  if(legacyCatalog)backup.data.package_templates=[];
  for(const table of tables)if(!Array.isArray(backup.data[table]))throw Error('Backup incompleto.');
  await store.transaction(async tx=>{
    if(Number((await one(tx,'SELECT count(*) AS count FROM tenants')).count)!==0)throw Error('Ripristino consentito solo in un database vuoto.');
    for(const table of tables) {
      const allowed=(await rows(tx,'SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2',['public',table])).map(c=>c.column_name);
      for(const record of (table==='quotes'?[...backup.data[table]].sort((a,b)=>a.id-b.id):backup.data[table])) {
        const keys=Object.keys(record);if(!keys.length||keys.some(k=>!allowed.includes(k)))throw Error('Colonne backup non valide.');
        await tx.query(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,keys.map(k=>record[k]));
      }
    }
    if(legacyCatalog)await importPackageCatalog(tx);
  });
  return {ok:true};
}
