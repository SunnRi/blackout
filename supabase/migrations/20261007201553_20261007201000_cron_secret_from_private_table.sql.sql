/*
# Cron jobs: pass internal secret via secure storage

1. Summary

   The checker edge functions now require an X-Internal-Secret header. Vault
   direct writes are not permitted on this project, so the secret is stored in
   a dedicated private table created by this migration. The table lives in a
   schema that is NOT exposed through the Data API, so it cannot be read by
   any browser client. The two cron jobs read the secret from that table at
   execution time, so it never appears as a literal in cron.job.command.

2. Changes

   - New schema `secrets` (not exposed via Data API; no grants to anon/auth).
   - New table `secrets.values` (name text primary key, value text not null),
     owned by postgres, with no public grants.
   - Inserts a random 24-byte hex CRON_SECRET.
   - New SECURITY DEFINER function `secrets.get(name text)` with a locked
     search path, EXECUTE granted to postgres only (cron runs as postgres).
   - Reschedules `schedule-change-check-30min` and `notification-check-5min`
     to pull the header value through that function at runtime.

3. Security

   - The secrets schema is unreachable from the browser: it is not in the
     Data API's exposed schemas and no role grants were issued.
   - The secret value never appears in cron.job.command.
   - Requests without the header (or a wrong value) get HTTP 401 from the
     edge functions.
   - The matching value must be present in the edge functions' environment as
     CRON_SECRET (supabase config / dashboard secret), not in code.
*/

CREATE SCHEMA IF NOT EXISTS secrets;

CREATE TABLE IF NOT EXISTS secrets.values (
  name text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON secrets.values FROM anon, authenticated, PUBLIC;

INSERT INTO secrets.values (name, value)
VALUES ('CRON_SECRET', encode(gen_random_bytes(24), 'hex'))
ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

CREATE OR REPLACE FUNCTION secrets.get(secret_name text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'secrets'
AS $$
  SELECT value FROM secrets.values WHERE name = secret_name;
$$;

REVOKE ALL ON FUNCTION secrets.get(text) FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('schedule-change-check-30min');
SELECT cron.unschedule('notification-check-5min');

SELECT cron.schedule(
  'schedule-change-check-30min',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://amgaictjajtyogwwjulx.supabase.co/functions/v1/schedule-change-checker?endpoint=check',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Internal-Secret', secrets.get('CRON_SECRET')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

SELECT cron.schedule(
  'notification-check-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://amgaictjajtyogwwjulx.supabase.co/functions/v1/notification-checker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Internal-Secret', secrets.get('CRON_SECRET')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
