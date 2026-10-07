/*
# Fix cron jobs: pg_net lives in `net` schema, add reminder job

1. Fixes
- Existing schedule-change-checker job failed: it referenced
  extensions.net.http_post but pg_net is installed in the `net` schema.
  Rescheduled with the correct schema-qualified call.
2. Jobs
- `schedule-change-check-30min`: every 30 min, POST to schedule-change-checker
  (detects schedule changes, logs them, pushes notifications to followers).
- `notification-check-5min`: every 5 min, POST to notification-checker
  (sends "light goes off soon" reminders, deduplicated per user per event).
3. Security
- Both endpoints are public (verify_jwt = false); they only read public
  schedule data and user notification preferences.
*/

SELECT cron.unschedule('schedule-change-check-30min');

SELECT cron.schedule(
  'schedule-change-check-30min',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://amgaictjajtyogwwjulx.supabase.co/functions/v1/schedule-change-checker?endpoint=check',
    headers := '{"Content-Type": "application/json"}'::jsonb,
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
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
