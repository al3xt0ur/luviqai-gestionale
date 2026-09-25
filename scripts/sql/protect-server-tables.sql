-- Run only after confirming the target project and backend owner access.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Server-only tables: the backend connects as their owner (postgres).
-- RLS intentionally has no API policies; tenant policies on business tables are unchanged.
-- Restrict only the 11 tables reported by the Supabase Security Advisor.
DO $$
DECLARE table_name text; api_role text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['schema_version','users','sessions','login_attempts','resets','imports','platform_audit','technical_log','privacy_requests','password_reset_rate','mfa_challenges'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC', table_name);
    FOREACH api_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I', table_name, api_role);
      END IF;
    END LOOP;
  END LOOP;
END $$;

COMMIT;
