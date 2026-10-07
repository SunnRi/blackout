/*
# Fix cron job URL

1. Jobs
- Reschedule `schedule-change-check-30min` with the correct project URL.
  Previous version had a wrong hostname (guessed instead of read from env).
*/

SELECT cron.unschedule('schedule-change-check-30min');

SELECT cron.schedule(
  'schedule-change-check-30min',
  '*/30 * * * *',
  $$
  SELECT extensions.net.http_post(
    url := 'https://amgaictjajtyogwwjulx.supabase.co/functions/v1/schedule-change-checker?endpoint=check',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
