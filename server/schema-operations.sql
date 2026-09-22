ALTER TABLE packages ADD COLUMN IF NOT EXISTS source_quote_id integer
-- next
ALTER TABLE packages ADD COLUMN IF NOT EXISTS source_quote_slot text NOT NULL DEFAULT ''
-- next
ALTER TABLE interventions ADD COLUMN IF NOT EXISTS source_quote_id integer
-- next
ALTER TABLE interventions ADD COLUMN IF NOT EXISTS source_quote_slot text NOT NULL DEFAULT ''
-- next
ALTER TABLE interventions ADD COLUMN IF NOT EXISTS recurrence_id text
-- next
ALTER TABLE interventions ADD COLUMN IF NOT EXISTS team_id integer
-- next
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS low_balance_minutes integer NOT NULL DEFAULT 300
-- next
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS quote_followup_days integer NOT NULL DEFAULT 7
-- next
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS pending_approval_hours integer NOT NULL DEFAULT 24
-- next
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS alert_email_enabled boolean NOT NULL DEFAULT false
-- next
CREATE TABLE IF NOT EXISTS teams (
 tenant_id text NOT NULL REFERENCES tenants(id), id integer NOT NULL,
 name text NOT NULL, active boolean NOT NULL DEFAULT true, created text NOT NULL,
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,name)
)
-- next
CREATE TABLE IF NOT EXISTS recurrence_series (
 tenant_id text NOT NULL REFERENCES tenants(id), id text NOT NULL,
 client_id integer NOT NULL, package_id integer NOT NULL, source_quote_id integer,
 frequency_weeks integer NOT NULL CHECK(frequency_weeks IN (1,2)), weekdays jsonb NOT NULL,
 local_time text NOT NULL, occurrence_count integer NOT NULL CHECK(occurrence_count>0),
 created text NOT NULL, created_by text NOT NULL, active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,client_id) REFERENCES clients(tenant_id,id),
 FOREIGN KEY(tenant_id,package_id) REFERENCES packages(tenant_id,id),
 FOREIGN KEY(tenant_id,source_quote_id) REFERENCES quotes(tenant_id,id)
)
-- next
CREATE TABLE IF NOT EXISTS alerts (
 tenant_id text NOT NULL REFERENCES tenants(id), id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('low_balance','quote_followup','overdue_invoice','pending_approval')),
 target_type text NOT NULL, target_id text NOT NULL, dedupe_key text NOT NULL,
 title text NOT NULL, body text NOT NULL, link text NOT NULL,
 created text NOT NULL, updated text NOT NULL, read_at text, resolved_at text,
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,dedupe_key)
)
-- next
CREATE UNIQUE INDEX IF NOT EXISTS packages_quote_slot_unique ON packages(tenant_id,source_quote_id,source_quote_slot) WHERE source_quote_id IS NOT NULL AND source_quote_slot<>''
-- next
CREATE UNIQUE INDEX IF NOT EXISTS interventions_quote_slot_unique ON interventions(tenant_id,source_quote_id,source_quote_slot) WHERE source_quote_id IS NOT NULL AND source_quote_slot<>''
-- next
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='packages_source_quote_fk') THEN
  ALTER TABLE packages ADD CONSTRAINT packages_source_quote_fk FOREIGN KEY(tenant_id,source_quote_id) REFERENCES quotes(tenant_id,id);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='interventions_source_quote_fk') THEN
  ALTER TABLE interventions ADD CONSTRAINT interventions_source_quote_fk FOREIGN KEY(tenant_id,source_quote_id) REFERENCES quotes(tenant_id,id);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='interventions_recurrence_fk' AND conrelid='interventions'::regclass) THEN
  ALTER TABLE interventions ADD CONSTRAINT interventions_recurrence_fk FOREIGN KEY(tenant_id,recurrence_id) REFERENCES recurrence_series(tenant_id,id);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='interventions_team_fk') THEN
  ALTER TABLE interventions ADD CONSTRAINT interventions_team_fk FOREIGN KEY(tenant_id,team_id) REFERENCES teams(tenant_id,id);
 END IF;
END $$
-- next
GRANT SELECT,INSERT,UPDATE ON teams,recurrence_series,alerts TO luviq_tenant
-- next
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['teams','recurrence_series','alerts'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename=tab AND policyname='tenant_isolation') THEN
   EXECUTE format('CREATE POLICY tenant_isolation ON %I TO luviq_tenant USING (tenant_id=current_setting(''app.tenant_id'',true)) WITH CHECK (tenant_id=current_setting(''app.tenant_id'',true))',tab);
  END IF;
 END LOOP;
END $$
-- next
INSERT INTO schema_version(version) VALUES(20) ON CONFLICT DO NOTHING
