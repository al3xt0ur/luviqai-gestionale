import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const tables = ["schema_version","users","sessions","login_attempts","resets","imports","platform_audit","technical_log","privacy_requests","password_reset_rate","mfa_challenges"];

test('server-only tables deny Supabase API roles while backend and tenant access survive', async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE ROLE anon NOLOGIN NOSUPERUSER NOBYPASSRLS; CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOBYPASSRLS; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;");
    const schema = await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8');
    const migrate = async () => db.transaction(async tx => {
      for (const statement of schema.split('-- next')) if (statement.trim()) await tx.query(statement);
      // storage.migrate records v3 after the package catalogue import.
      await tx.query('INSERT INTO schema_version(version) VALUES(3) ON CONFLICT DO NOTHING');
    });
    await migrate();
    await migrate(); // Existing deployments and repeated migrations.
    assert.ok((await db.query('SELECT max(version) AS version FROM schema_version')).rows[0].version >= 18);
    const states = (await db.query("SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=ANY($1)", [tables])).rows;
    assert.equal(states.length, tables.length);
    assert.ok(states.every(row => row.relrowsecurity));
    await db.query("INSERT INTO login_attempts(key,failures,blocked_until) VALUES('rls-test',0,0)");
    await db.query("UPDATE login_attempts SET failures=1 WHERE key='rls-test'");
    assert.equal((await db.query("SELECT failures FROM login_attempts WHERE key='rls-test'")).rows[0].failures, 1);
    for (const name of tables) {
      await db.query('SELECT * FROM public.' + name + ' LIMIT 0');
      const column = (await db.query("SELECT attname FROM pg_attribute WHERE attrelid=$1::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum LIMIT 1", ['public.' + name])).rows[0].attname;
      for (const role of ['anon', 'authenticated']) {
        await db.exec('SET ROLE ' + role);
        try {
          for (const sql of [
            'SELECT * FROM public.' + name + ' WHERE false',
            'EXPLAIN INSERT INTO public.' + name + ' SELECT * FROM public.' + name + ' WHERE false',
            'EXPLAIN UPDATE public.' + name + ' SET "' + column + '"="' + column + '" WHERE false',
            'EXPLAIN DELETE FROM public.' + name + ' WHERE false',
            'TRUNCATE TABLE public.' + name + ' CASCADE'
          ]) await assert.rejects(db.query(sql), error => error.code === '42501', role + ': ' + sql);
        } finally { await db.exec('RESET ROLE'); }
      }
    }
    // Independently verify the RLS boundary even if a SELECT grant is reintroduced.
    await db.exec('CREATE ROLE rls_probe NOLOGIN NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO rls_probe; GRANT SELECT ON public.login_attempts TO rls_probe; SET ROLE rls_probe');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.login_attempts')).rows[0].n, 0);
    await db.exec('RESET ROLE');
    await db.query("INSERT INTO tenants(id,slug,name,created) VALUES('rls-a','rls-a','A','2026-09-22'),('rls-b','rls-b','B','2026-09-22')");
    await db.transaction(async tx => {
      await tx.query("SELECT set_config('app.tenant_id','rls-a',true)");
      await tx.query('SET LOCAL ROLE luviq_tenant');
      assert.deepEqual((await tx.query('SELECT id FROM tenants')).rows.map(row => row.id), ['rls-a']);
    });
    await db.query("DELETE FROM login_attempts WHERE key='rls-test'");
  } finally { await db.close(); }
});
