/*
# Cron job: run schedule change checker every 30 minutes

1. Extensions
- Install pg_net (async HTTP from SQL) into the `extensions` schema.
2. Jobs
- `schedule-change-check-30min`: every 30 minutes, HTTP POST to the
  schedule-change-checker edge function (public, verify_jwt = false, so no
  Authorization header needed).
3. Security
- The function performs only read-only public schedule fetching + change
  logging; no secrets required.
*/

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.schedule(
  'schedule-change-check-30min',
  '*/30 * * * *',
  $$
  SELECT extensions.net.http_post(
    url := 'https://qpwinbwsddjbtinhpfgc.supabase.co/functions/v1/schedule-change-checker?endpoint=check',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
