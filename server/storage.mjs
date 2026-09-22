import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import {mkdirSync,openSync,writeFileSync,readFileSync,closeSync,unlinkSync} from 'node:fs';
import {dirname,resolve,relative,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {importPackageCatalog} from './catalog.mjs';

export async function connectStore({ url, path } = {}) {
  if(process.env.LUVIQ_TEST_MODE==='1'){
    if(url)throw Error('Test isolati: connessioni PostgreSQL esterne vietate.');
    if(path){const rel=relative(resolve(tmpdir()),resolve(path));if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('Test isolati: usare un database nella cartella temporanea.');}
  }
  if (url) {
    const pool = new pg.Pool({ connectionString: url, max: 8 });
    return {
      kind: 'PostgreSQL',
      query: (sql, params) => pool.query(sql, params),
      async transaction(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn(client);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally { client.release(); }
      },
      close: () => pool.end(),
    };
  }
  let lock;
  if(path){
    mkdirSync(dirname(path),{recursive:true});lock=path+'.lock';
    try{const fd=openSync(lock,'wx');writeFileSync(fd,String(process.pid));closeSync(fd);}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      const pid=Number(readFileSync(lock,'utf8'));
      if(!Number.isInteger(pid)||pid<1)throw Error('Blocco database non valido: verificare il processo prima di rimuoverlo.');
      try{process.kill(pid,0);throw Error('Database locale già aperto. Arrestare il server prima di usare i comandi di amministrazione.');}
      catch(check){if(check.code!=='ESRCH')throw check;}
      unlinkSync(lock);const fd=openSync(lock,'wx');writeFileSync(fd,String(process.pid));closeSync(fd);
    }
  }
  const db = new PGlite(path);
  try{await db.waitReady;}catch(error){if(lock)unlinkSync(lock);throw error;}
  return {
    kind: 'PostgreSQL locale (PGlite)',
    query: (sql, params) => db.query(sql, params),
    transaction: fn => db.transaction(fn),
    close: async () => {try{await db.close();}finally{if(lock)unlinkSync(lock);}},
  };
}

export async function migrate(store) {
  const scripts=await Promise.all(['schema.sql','schema-operations.sql'].map(name=>readFile(new URL('./'+name,import.meta.url),'utf8')));
  const run = () => store.transaction(async tx => {
    // Serializza le migrazioni anche con più processi PostgreSQL.
    await tx.query('SELECT pg_advisory_xact_lock(736281)');
    for(const sql of scripts)for (const statement of sql.split('-- next')) {
      if (statement.trim()) await tx.query(statement);
    }
    if(!(await one(tx,'SELECT version FROM schema_version WHERE version=3'))) {
      await importPackageCatalog(tx);
      await tx.query('INSERT INTO schema_version(version) VALUES(3)');
    }
  });
  for(let attempt=1;;attempt++) {
    try{return await run();}
    catch(error){
      // Nei deploy zero-downtime il vecchio processo può avere una query attiva
      // mentre il nuovo applica DDL/RLS. PostgreSQL può rilevare un deadlock
      // transitorio: riprova l'intera transazione dopo un breve backoff.
      if(error?.code!=='40P01'||attempt>=5)throw error;
      const delay=250*attempt;
      console.warn(`Deadlock durante la migrazione; nuovo tentativo ${attempt+1}/5 tra ${delay} ms.`);
      await new Promise(resolve=>setTimeout(resolve,delay));
    }
  }
}

export const rows = async (db, sql, values = []) => (await db.query(sql, values)).rows;
export const one = async (db, sql, values = []) => (await rows(db, sql, values))[0];

export async function tenantTransaction(store, tenantId, fn) {
  return store.transaction(async tx => {
    await tx.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    // Il ruolo applicativo non possiede le tabelle e non può bypassare RLS.
    await tx.query('SET LOCAL ROLE luviq_tenant');
    const tenant = await one(tx, 'SELECT * FROM tenants WHERE id=$1 FOR UPDATE', [tenantId]);
    if (!tenant) throw new Error('Azienda non disponibile.');
    return fn(tx, tenant);
  });
}

// External databases are migrated only by the explicit administration command.
export async function initializeStore(store) {
  if (store.kind !== 'PostgreSQL') return migrate(store);
  const present = await one(store, "SELECT to_regclass('public.schema_version') AS name");
  const version = present.name ? Number((await one(store,'SELECT max(version) AS version FROM schema_version')).version) : 0;
  if (version !== 20) throw Error('Schema database incompatibile: eseguire la migrazione esplicita verificata prima dell’avvio (versione richiesta: 20).');
}
