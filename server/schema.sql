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

