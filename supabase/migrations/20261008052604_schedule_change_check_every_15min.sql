/*
# Cron job: run schedule change checker every 15 minutes

Replaces the old 30-minute job (already unscheduled). The checker edge
function requires the X-Internal-Secret header, pulled at runtime from the
private `secrets` schema (see 20261007201553 migration).
*/

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.schedule(
  'schedule-change-check-15min',
  '*/15 * * * *',
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
