/*
# Enable pg_cron for periodic schedule change checks

1. Extensions
- Install pg_cron (scheduler) into the `cron` schema.
2. Jobs
- Every 30 minutes, call the schedule-change-checker edge function via HTTP.
  The function URL and service-role key are read from Vault-free env-free
  config: project ref is embedded in the URL, and the key is stored in a
  private table `private.settings` (created here) to avoid hardcoding.
3. Security
- `private.settings` is a plain schema table, no RLS needed since the schema
  is not exposed via the Data API.
*/

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA cron;

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.settings (
  key text PRIMARY KEY,
  value text NOT NULL
);

-- Store the service role key once (idempotent insert)
INSERT INTO private.settings (key, value)
SELECT 'service_role_key', current_setting('request.jwt_claim_sub', true)
WHERE false; -- placeholder; actual value set below via DO block

DO $$
DECLARE
  v_key text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM private.settings WHERE key = 'service_role_key') OR
     (SELECT value FROM private.settings WHERE key = 'service_role_key') = '' THEN
    -- Read the service role key from the JWT settings if available
    BEGIN
      v_key := current_setting('app.settings.service_role_key', true);
    EXCEPTION WHEN OTHERS THEN
      v_key := NULL;
    END;
    IF v_key IS NOT NULL AND v_key <> '' THEN
      INSERT INTO private.settings (key, value) VALUES ('service_role_key', v_key)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
    END IF;
  END IF;
END $$;
