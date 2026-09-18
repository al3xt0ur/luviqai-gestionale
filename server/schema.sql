CREATE TABLE IF NOT EXISTS schema_version (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())
-- next
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='luviq_tenant') THEN
    CREATE ROLE luviq_tenant NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$
-- next
GRANT luviq_tenant TO CURRENT_USER
-- next
CREATE TABLE IF NOT EXISTS tenants (
  id text PRIMARY KEY,
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  brand_color text NOT NULL DEFAULT '#176653',
  logo_text text NOT NULL DEFAULT '✳',
  address text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  created text NOT NULL
)
-- next
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  email text NOT NULL,
  name text NOT NULL,
  role text NOT NULL CHECK(role IN ('manager','operator')),
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created text NOT NULL,
  UNIQUE(tenant_id,email),
  UNIQUE(tenant_id,id)
)
-- next
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  csrf text NOT NULL,
  expires bigint NOT NULL
)
-- next
CREATE TABLE IF NOT EXISTS login_attempts (
  key text PRIMARY KEY, failures integer NOT NULL, blocked_until bigint NOT NULL
)
-- next
CREATE TABLE IF NOT EXISTS resets (
  token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), expires bigint NOT NULL
)
-- next
CREATE TABLE IF NOT EXISTS clients (
  tenant_id text NOT NULL REFERENCES tenants(id), id integer NOT NULL,
  name text NOT NULL, email text NOT NULL, phone text NOT NULL, address text NOT NULL,
  archived boolean NOT NULL DEFAULT false, PRIMARY KEY(tenant_id,id)
)
-- next
CREATE TABLE IF NOT EXISTS packages (
  tenant_id text NOT NULL REFERENCES tenants(id), id integer NOT NULL,
  client_id integer NOT NULL, tier text NOT NULL CHECK(tier IN ('Star','Love','Luxury')),
  original integer NOT NULL CHECK(original IN (1200,2400,3600)),
  initial integer NOT NULL CHECK(initial>=0 AND initial<=original),
  rule text NOT NULL CHECK(rule IN ('operator','team')), paid integer NOT NULL CHECK(paid IN (0,1)),
  renewed_from integer, created text NOT NULL, PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,client_id) REFERENCES clients(tenant_id,id),
  FOREIGN KEY(tenant_id,renewed_from) REFERENCES packages(tenant_id,id)
)
-- next
CREATE TABLE IF NOT EXISTS interventions (
  tenant_id text NOT NULL REFERENCES tenants(id), id integer NOT NULL,
  package_id integer NOT NULL, date text NOT NULL, service text NOT NULL, team text NOT NULL,
  duration integer NOT NULL CHECK(duration>0), operators integer NOT NULL CHECK(operators>0),
  notes text NOT NULL, status text NOT NULL CHECK(status IN ('planned','pending','approved','cancelled')),
  assigned_user_id text, PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,package_id) REFERENCES packages(tenant_id,id),
  FOREIGN KEY(tenant_id,assigned_user_id) REFERENCES users(tenant_id,id)
)
-- next
CREATE TABLE IF NOT EXISTS audit (
  tenant_id text NOT NULL REFERENCES tenants(id), id integer NOT NULL,
  date text NOT NULL, author text NOT NULL, author_id text,
  action text NOT NULL, client_id integer, intervention_id integer,
  before_value text NOT NULL, after_value text NOT NULL, reason text NOT NULL,
  PRIMARY KEY(tenant_id,id)
)
-- next
CREATE TABLE IF NOT EXISTS requests (
  tenant_id text NOT NULL REFERENCES tenants(id), user_id text NOT NULL,
  key text NOT NULL, payload text NOT NULL, response text NOT NULL,
  PRIMARY KEY(tenant_id,user_id,key)
)
-- next
CREATE TABLE IF NOT EXISTS imports (source text PRIMARY KEY, tenant_id text NOT NULL, imported_at text NOT NULL)
-- next
GRANT USAGE ON SCHEMA public TO luviq_tenant
-- next
GRANT SELECT,UPDATE ON tenants TO luviq_tenant
-- next
GRANT SELECT,INSERT,UPDATE ON clients,packages,interventions TO luviq_tenant
-- next
GRANT SELECT,INSERT ON audit,requests TO luviq_tenant
-- next
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['clients','packages','interventions','audit','requests'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);

    IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename=tab AND policyname='tenant_isolation') THEN
      EXECUTE format('CREATE POLICY tenant_isolation ON %I TO luviq_tenant USING (tenant_id = current_setting(''app.tenant_id'',true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'',true))',tab);
    END IF;
  END LOOP;
  ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename='tenants' AND policyname='tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON tenants TO luviq_tenant USING(id=current_setting('app.tenant_id',true)) WITH CHECK(id=current_setting('app.tenant_id',true));
  END IF;
END $$
-- next
INSERT INTO schema_version(version) VALUES(1) ON CONFLICT DO NOTHING
-- next
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_platform boolean NOT NULL DEFAULT false
-- next
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true
-- next
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS active_tenant_id text REFERENCES tenants(id)
-- next
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM schema_version WHERE version=2) THEN
    ALTER TABLE users DROP CONSTRAINT users_role_check;
    ALTER TABLE users ADD CONSTRAINT users_role_check CHECK(role IN ('manager','operator','platform_admin'));
    INSERT INTO schema_version(version) VALUES(2);
  END IF;
END $$
-- next
CREATE TABLE IF NOT EXISTS platform_audit (
  id text PRIMARY KEY,
  date text NOT NULL,
  author_id text NOT NULL,
  author text NOT NULL,
  action text NOT NULL,
  tenant_id text,
  details jsonb NOT NULL
)

-- next
CREATE TABLE IF NOT EXISTS package_templates (
  tenant_id text NOT NULL REFERENCES tenants(id), id integer NOT NULL,
  name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '',
  minutes integer NOT NULL CHECK(minutes BETWEEN 1 AND 600000),
  rule text NOT NULL CHECK(rule IN ('operator','team')),
  active boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  PRIMARY KEY(tenant_id,id)
)
-- next
CREATE UNIQUE INDEX IF NOT EXISTS package_templates_name ON package_templates(tenant_id,lower(name))
-- next
GRANT SELECT,INSERT,UPDATE ON package_templates TO luviq_tenant
-- next
DO $$ BEGIN
  ALTER TABLE package_templates ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename='package_templates' AND policyname='tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON package_templates TO luviq_tenant USING(tenant_id=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id=current_setting('app.tenant_id',true));
  END IF;
  IF NOT EXISTS(SELECT 1 FROM schema_version WHERE version=3) THEN
    ALTER TABLE packages DROP CONSTRAINT packages_tier_check;
    ALTER TABLE packages DROP CONSTRAINT packages_original_check;
    ALTER TABLE packages ADD CONSTRAINT packages_original_check CHECK(original>0);
    ALTER TABLE packages ADD COLUMN template_id integer;
    ALTER TABLE packages ADD COLUMN template_revision integer;
    ALTER TABLE packages ADD COLUMN description text NOT NULL DEFAULT '';
    ALTER TABLE packages ADD CONSTRAINT packages_template_fk FOREIGN KEY(tenant_id,template_id) REFERENCES package_templates(tenant_id,id);
  END IF;
END $$
-- next
CREATE TABLE IF NOT EXISTS quotes (
 tenant_id text NOT NULL REFERENCES tenants(id), id integer NOT NULL,
 client_id integer NOT NULL, number text NOT NULL, revision integer NOT NULL DEFAULT 1,
 status text NOT NULL CHECK(status IN ('draft','sent','accepted','rejected','cancelled')),
 issue_date text NOT NULL, valid_until text NOT NULL,
 document jsonb NOT NULL, net integer NOT NULL CHECK(net>=0), tax integer NOT NULL CHECK(tax>=0), total integer NOT NULL CHECK(total=net+tax),
 source_id integer, created text NOT NULL, updated text NOT NULL,
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,number),
 FOREIGN KEY(tenant_id,client_id) REFERENCES clients(tenant_id,id),
 FOREIGN KEY(tenant_id,source_id) REFERENCES quotes(tenant_id,id)
)
-- next
GRANT SELECT,INSERT,UPDATE ON quotes TO luviq_tenant
-- next
DO $$ BEGIN
 ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename='quotes' AND policyname='tenant_isolation') THEN
  CREATE POLICY tenant_isolation ON quotes TO luviq_tenant USING(tenant_id=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id=current_setting('app.tenant_id',true));
 END IF;
END $$
-- next
INSERT INTO schema_version(version) VALUES(4) ON CONFLICT DO NOTHING
-- next
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_data text NOT NULL DEFAULT ''
-- next
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT ''
-- next
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS website text NOT NULL DEFAULT ''
-- next
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tax_id text NOT NULL DEFAULT ''
-- next
INSERT INTO schema_version(version) VALUES(5) ON CONFLICT DO NOTHING
-- next
CREATE TABLE IF NOT EXISTS mail_messages (
 tenant_id text NOT NULL REFERENCES tenants(id), id text NOT NULL,
 quote_id integer, kind text NOT NULL CHECK(kind IN ('quote','response')),
 mode text NOT NULL CHECK(mode IN ('preview','smtp')),
 status text NOT NULL CHECK(status IN ('queued','sending','sent','preview','uncertain','cancelled')),
 recipient text NOT NULL, subject text NOT NULL, content jsonb NOT NULL,
 created text NOT NULL, updated text NOT NULL, error text NOT NULL DEFAULT '',
 PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,quote_id) REFERENCES quotes(tenant_id,id)
)
-- next
CREATE TABLE IF NOT EXISTS quote_links (
 token_hash text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id), quote_id integer NOT NULL,
 mail_id text NOT NULL, expires bigint NOT NULL, revoked boolean NOT NULL DEFAULT false,
 response jsonb, responded_at text,
 FOREIGN KEY(tenant_id,quote_id) REFERENCES quotes(tenant_id,id),
 FOREIGN KEY(tenant_id,mail_id) REFERENCES mail_messages(tenant_id,id)
)
-- next
CREATE TABLE IF NOT EXISTS notifications (
 tenant_id text NOT NULL REFERENCES tenants(id), id text NOT NULL,
 quote_id integer NOT NULL, title text NOT NULL, body text NOT NULL, created text NOT NULL, read_at text,
 PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,quote_id) REFERENCES quotes(tenant_id,id)
)
-- next
GRANT SELECT,INSERT,UPDATE ON mail_messages,quote_links,notifications TO luviq_tenant
-- next
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['mail_messages','quote_links','notifications'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename=tab AND policyname='tenant_isolation') THEN
   EXECUTE format('CREATE POLICY tenant_isolation ON %I TO luviq_tenant USING (tenant_id=current_setting(''app.tenant_id'',true)) WITH CHECK (tenant_id=current_setting(''app.tenant_id'',true))',tab);
  END IF;
 END LOOP;
END $$
-- next
INSERT INTO schema_version(version) VALUES(6) ON CONFLICT DO NOTHING
-- next
CREATE TABLE IF NOT EXISTS invoices (
 tenant_id text NOT NULL REFERENCES tenants(id), id integer NOT NULL,
 client_id integer NOT NULL, quote_id integer, number text NOT NULL, revision integer NOT NULL DEFAULT 1,
 status text NOT NULL CHECK(status IN ('draft','issued','paid','cancelled')),
 issue_date text NOT NULL, due_date text NOT NULL,
 document jsonb NOT NULL, net integer NOT NULL CHECK(net>=0), tax integer NOT NULL CHECK(tax>=0), total integer NOT NULL CHECK(total=net+tax),
 payment jsonb NOT NULL DEFAULT '{}'::jsonb, paid_at text, created text NOT NULL, updated text NOT NULL,
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,number),
 FOREIGN KEY(tenant_id,client_id) REFERENCES clients(tenant_id,id),
 FOREIGN KEY(tenant_id,quote_id) REFERENCES quotes(tenant_id,id)
)
-- next
CREATE UNIQUE INDEX IF NOT EXISTS invoices_quote_unique ON invoices(tenant_id,quote_id) WHERE quote_id IS NOT NULL AND status<>'cancelled'
-- next
GRANT SELECT,INSERT,UPDATE ON invoices TO luviq_tenant
-- next
DO $$ BEGIN
 ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename='invoices' AND policyname='tenant_isolation') THEN
  CREATE POLICY tenant_isolation ON invoices TO luviq_tenant USING(tenant_id=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id=current_setting('app.tenant_id',true));
 END IF;
END $$
-- next
INSERT INTO schema_version(version) VALUES(7) ON CONFLICT DO NOTHING

-- next
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM schema_version WHERE version=8) THEN
  ALTER TABLE mail_messages DROP CONSTRAINT IF EXISTS mail_messages_kind_check;
  ALTER TABLE mail_messages ADD CONSTRAINT mail_messages_kind_check CHECK(kind IN ('quote','response','account'));
  INSERT INTO schema_version(version) VALUES(8);
 END IF;
END $$
-- next
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM schema_version WHERE version=9) THEN
  ALTER TABLE mail_messages DROP CONSTRAINT IF EXISTS mail_messages_kind_check;
  ALTER TABLE mail_messages ADD CONSTRAINT mail_messages_kind_check CHECK(kind IN ('quote','response','account','test'));
  ALTER TABLE mail_messages DROP CONSTRAINT IF EXISTS mail_messages_mode_check;
  ALTER TABLE mail_messages ADD CONSTRAINT mail_messages_mode_check CHECK(mode IN ('preview','smtp','resend'));
  CREATE TABLE IF NOT EXISTS tenant_mail_settings (
    tenant_id text PRIMARY KEY REFERENCES tenants(id),
    sender_name text NOT NULL DEFAULT '',
    sender_email text NOT NULL DEFAULT '',
    reply_to text NOT NULL DEFAULT '',
    enabled boolean NOT NULL DEFAULT false,
    updated text NOT NULL
  );
  INSERT INTO schema_version(version) VALUES(9);
 END IF;
END $$
-- next
GRANT SELECT,INSERT,UPDATE ON tenant_mail_settings TO luviq_tenant
-- next
DO $$ BEGIN
 ALTER TABLE tenant_mail_settings ENABLE ROW LEVEL SECURITY;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename='tenant_mail_settings' AND policyname='tenant_isolation') THEN
  CREATE POLICY tenant_isolation ON tenant_mail_settings TO luviq_tenant USING(tenant_id=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id=current_setting('app.tenant_id',true));
 END IF;
END $$
-- next
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM schema_version WHERE version=10) THEN
  ALTER TABLE mail_messages DROP CONSTRAINT IF EXISTS mail_messages_kind_check;
  ALTER TABLE mail_messages ADD CONSTRAINT mail_messages_kind_check CHECK(kind IN ('quote','response','account','test','platform'));
  INSERT INTO schema_version(version) VALUES(10);
 END IF;
END $$
