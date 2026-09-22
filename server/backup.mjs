import {mkdir,writeFile,readFile,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {one,rows} from './storage.mjs';
import {importPackageCatalog} from './catalog.mjs';

const tables=['tenants','users','tenant_mail_settings','clients','package_templates','quotes','packages','teams','recurrence_series','alerts','invoices','jobs','mail_messages','quote_links','notifications','interventions','intervention_execution','intervention_attachments','intervention_assignments','privacy_requests','technical_log','audit','requests','imports','platform_audit'];
const checksum=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function backupStore(store,path) {
  const data=await store.transaction(async tx=>{
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    const result={};
    const schemaVersion=Number((await one(tx,'SELECT max(version) AS version FROM schema_version')).version);
    for(const table of tables){
      if(!await one(tx,"SELECT to_regclass($1) AS name",['public.'+table]).then(r=>r.name)){
        if((schemaVersion<19&&['intervention_execution','intervention_attachments'].includes(table))||(schemaVersion<18&&table==='intervention_assignments')||(schemaVersion<13&&table==='privacy_requests')||(schemaVersion<12&&table==='technical_log')||(schemaVersion<14&&table==='jobs')||(schemaVersion<9&&table==='tenant_mail_settings')){result[table]=[];continue;}
        if(schemaVersion<20&&['teams','recurrence_series','alerts'].includes(table)){result[table]=[];continue;}
        throw Error('Tabella backup mancante: '+table);
      }
      result[table]=await rows(tx,`SELECT * FROM ${table}${['clients','packages','interventions','audit'].includes(table)?' ORDER BY tenant_id,id':''}`);
    }
    return result;
  });
  const backup={version:2,created:new Date().toISOString(),checksum:checksum(data),data};
  await mkdir(dirname(path),{recursive:true});
  await writeFile(path+'.tmp',JSON.stringify(backup),{mode:0o600});await rename(path+'.tmp',path);
  return backup;
}

export async function restoreStore(store,path) {
  const backup=JSON.parse(await readFile(path,'utf8'));
  if(![1,2].includes(backup.version)||backup.checksum!==checksum(backup.data))throw Error('Backup non valido o checksum non corrispondente.');
  if(backup.version===1)for(const name of ['teams','recurrence_series','alerts','intervention_assignments','intervention_execution','intervention_attachments','privacy_requests','technical_log'])if(backup.data[name]===undefined)backup.data[name]=[];
  // I backup della versione 1 precedente al pannello admin non contenevano questo registro.
  if(backup.data.platform_audit===undefined)backup.data.platform_audit=[];
  if(backup.data.quotes===undefined)backup.data.quotes=[];
  if(backup.data.invoices===undefined)backup.data.invoices=[];
  if(backup.data.jobs===undefined)backup.data.jobs=[];
  for(const name of ['tenant_mail_settings','mail_messages','quote_links','notifications'])if(backup.data[name]===undefined)backup.data[name]=[];
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
    // Il ripristino non deve inviare email rimaste in coda nel backup.
    await tx.query("UPDATE mail_messages SET status='uncertain',error='Tentativo recuperato da backup: verificare prima di riprovare.' WHERE status IN ('queued','sending')");
  });
  return {ok:true};
}
