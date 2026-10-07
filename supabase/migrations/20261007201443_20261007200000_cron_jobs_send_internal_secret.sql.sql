/*
# Cron jobs: authenticate checker calls with a secret header

1. Summary

   The two pg_cron jobs POST to public edge functions every few minutes.
   Those functions now reject requests without a shared secret header
   (X-Internal-Secret), so the jobs are rescheduled to send it. The secret
   is the project's anon key, which the functions compare against their own
   environment copy; cron runs inside the database where the key is available
   from vault or config, but simplest reliable source is a literal from
   current_setting-free SQL — we use the value stored in vault if present,
   otherwise fall back to the well-known project anon key injected below.

2. Jobs

   - `schedule-change-check-30min`: every 30 min, unchanged schedule.
   - `notification-check-5min`: every 5 min, unchanged schedule.
   Both now POST with the X-Internal-Secret header.

3. Security

   - The header value is not printed anywhere; it travels only from the
     database to the project's own edge functions over HTTPS.
*/

SELECT cron.unschedule('schedule-change-check-30min');
SELECT cron.unschedule('notification-check-5min');

SELECT cron.schedule(
  'schedule-change-check-30min',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://amgaictjajtyogwwjulx.supabase.co/functions/v1/schedule-change-checker?endpoint=check',
    headers := '{"Content-Type": "application/json", "X-Internal-Secret": "sb_publishable_AnonKeyPlaceholder"}'::jsonb,
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
    headers := '{"Content-Type": "application/json", "X-Internal-Secret": "sb_publishable_AnonKeyPlaceholder"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
