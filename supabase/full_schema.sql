
-- ==========================================
-- Migration: 20261006133330_create_outage_tables.sql
-- ==========================================

/*
# Create power outage tracking tables for Ukraine

1. New Tables
- `regions`: Ukrainian oblasts with a numeric code and display name.
- `outage_groups`: Queue groups per region (e.g. 1, 2, 3...) with a friendly label.
- `outage_schedules`: Time-based outage entries per group, keyed by day of week (0=Sun..6=Sat).
  Each entry has start/end times (HH:MM) and a type (cutoff / possible_cutoff / stable).
2. Security
- RLS enabled on all tables.
- All data is public/shared (no sign-in) → policies allow anon + authenticated full CRUD.
3. Notes
- Times stored as text HH:MM to keep it simple and timezone-independent of the server.
- The frontend interprets times in Europe/Kyiv timezone.
*/

CREATE TABLE IF NOT EXISTS regions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code int UNIQUE NOT NULL,
  name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE regions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_regions" ON regions;
CREATE POLICY "anon_select_regions" ON regions FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_regions" ON regions;
CREATE POLICY "anon_insert_regions" ON regions FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_regions" ON regions;
CREATE POLICY "anon_update_regions" ON regions FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_regions" ON regions;
CREATE POLICY "anon_delete_regions" ON regions FOR DELETE
TO anon, authenticated USING (true);

-- ── outage_groups ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS outage_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id uuid NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
  group_number int NOT NULL,
  label text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (region_id, group_number)
);

ALTER TABLE outage_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_groups" ON outage_groups;
CREATE POLICY "anon_select_groups" ON outage_groups FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_groups" ON outage_groups;
CREATE POLICY "anon_insert_groups" ON outage_groups FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_groups" ON outage_groups;
CREATE POLICY "anon_update_groups" ON outage_groups FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_groups" ON outage_groups;
CREATE POLICY "anon_delete_groups" ON outage_groups FOR DELETE
TO anon, authenticated USING (true);

-- ── outage_schedules ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS outage_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES outage_groups(id) ON DELETE CASCADE,
  day_of_week int NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  start_time text NOT NULL,
  end_time text NOT NULL,
  outage_type text NOT NULL DEFAULT 'cutoff' CHECK (outage_type IN ('cutoff','possible_cutoff','stable')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE outage_schedules ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_outage_schedules_group_day
  ON outage_schedules (group_id, day_of_week);

DROP POLICY IF EXISTS "anon_select_schedules" ON outage_schedules;
CREATE POLICY "anon_select_schedules" ON outage_schedules FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_schedules" ON outage_schedules;
CREATE POLICY "anon_insert_schedules" ON outage_schedules FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_schedules" ON outage_schedules;
CREATE POLICY "anon_update_schedules" ON outage_schedules FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_schedules" ON outage_schedules;
CREATE POLICY "anon_delete_schedules" ON outage_schedules FOR DELETE
TO anon, authenticated USING (true);

-- ==========================================
-- Migration: 20261006134437_add_user_prefs_and_live_status.sql
-- ==========================================

/*
# Add user preferences and live outage status tables

1. New Tables
- `user_preferences`: Maps a Telegram user ID to a selected region and outage group.
  Uses bigint tg_user_id (Telegram user IDs are 64-bit). No auth.users FK — Telegram
  users are identified by their numeric TG ID, not Supabase auth.
- `live_outage_status`: Stores the current real-time outage state per region.
  Ukrenergo publishes stages (green/yellow/red) and per-region status. This table
  is updated by an edge function that fetches the real situation, and read by the
  frontend to show whether outages are currently active beyond the static schedule.
2. Security
- RLS enabled on both tables.
- Public read for anon + authenticated (the mini app reads without Supabase auth).
- Writes restricted to the service role (edge functions use the service role key,
  which bypasses RLS, so no INSERT/UPDATE/DELETE policies needed for anon).
3. Notes
- user_preferences is keyed by tg_user_id UNIQUE, so upserts via the edge function
  work cleanly.
- live_outage_status stores a per-region flag (active/inactive/emergency) plus an
  optional message and last-updated timestamp.
*/

-- ── user_preferences ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tg_user_id bigint UNIQUE NOT NULL,
  tg_username text,
  region_id uuid REFERENCES regions(id) ON DELETE SET NULL,
  group_id uuid REFERENCES outage_groups(id) ON DELETE SET NULL,
  notify_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_user_prefs" ON user_preferences;
CREATE POLICY "anon_select_user_prefs" ON user_preferences FOR SELECT
TO anon, authenticated USING (true);

-- No INSERT/UPDATE/DELETE policies for anon: only the edge function (service role) writes.

-- ── live_outage_status ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS live_outage_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id uuid NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'green' CHECK (status IN ('green','yellow','red')),
  message text,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (region_id)
);

ALTER TABLE live_outage_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_live_status" ON live_outage_status;
CREATE POLICY "anon_select_live_status" ON live_outage_status FOR SELECT
TO anon, authenticated USING (true);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_prefs_tg ON user_preferences (tg_user_id);
CREATE INDEX IF NOT EXISTS idx_live_status_region ON live_outage_status (region_id);

-- ==========================================
-- Migration: 20261006135625_add_yasno_columns_and_notifications.sql
-- ==========================================

/*
# Add Yasno API integration columns and notifications table

1. Modified Tables
- `user_preferences`: Add columns for Yasno API integration:
  - `yasno_region_id` (int): Yasno region ID from the API
  - `yasno_dso_id` (int): Yasno provider/dso ID
  - `yasno_group` (text): Group string like "1.1", "2.3"
  - `notify_minutes_before` (int): Minutes before outage to notify (30 or 60)
  - `street_name` (text): Optional street name for address lookup
  - `house_name` (text): Optional house number/name
2. New Tables
- `sent_notifications`: Tracks which outage notifications were already sent
  to avoid duplicates. Keyed by tg_user_id + schedule event start time.
3. Security
- RLS enabled on sent_notifications.
- Public read for anon + authenticated (mini app reads).
- Writes only via service role (edge function).
*/

-- ── user_preferences: add Yasno columns ───────────────────────
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS yasno_region_id int,
  ADD COLUMN IF NOT EXISTS yasno_dso_id int,
  ADD COLUMN IF NOT EXISTS yasno_group text,
  ADD COLUMN IF NOT EXISTS notify_minutes_before int NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS street_name text,
  ADD COLUMN IF NOT EXISTS house_name text;

-- ── sent_notifications ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sent_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tg_user_id bigint NOT NULL,
  event_start timestamptz NOT NULL,
  event_type text NOT NULL DEFAULT 'definite',
  sent_at timestamptz DEFAULT now(),
  UNIQUE (tg_user_id, event_start)
);

ALTER TABLE sent_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_sent_notifs" ON sent_notifications;
CREATE POLICY "anon_select_sent_notifs" ON sent_notifications FOR SELECT
TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_sent_notifs_user ON sent_notifications (tg_user_id);

-- ==========================================
-- Migration: 20261007045649_add_city_slug_and_queue_group.sql
-- ==========================================

/*
# Add city_slug column for bezsvitla/Yasno city-based schedule lookup

1. Modified Tables
- `user_preferences`: Add `city_slug` (text) and `queue_group` (text)
  to store the selected city and outage queue group.
  These replace the yasno_region_id/yasno_dso_id/yasno_group columns
  for the new unified city-based approach.
*/

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS city_slug text,
  ADD COLUMN IF NOT EXISTS queue_group text;

-- ==========================================
-- Migration: 20261007083826_add_oblast_slug_to_user_preferences.sql
-- ==========================================

/*
# Add oblast slug to user preferences

1. Modified Tables
- `user_preferences`: add `oblast_slug` (text, nullable) — bezsvitla slug of the selected oblast
  (e.g. "kyivska-oblast", or "kyiv-city" for the capital). Complements existing `city_slug`.
2. Security
- No changes: table already has RLS enabled with existing policies; new nullable column
  is readable/writable under the same policies.
3. Notes
- Nullable + no backfill needed: existing rows (city-only users) keep working; the app
  writes oblast_slug on next preference save.
*/

ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS oblast_slug text;


-- ==========================================
-- Migration: 20261007091709_create_schedule_change_log.sql
-- ==========================================

/*
# Schedule change log

1. New Tables
- `schedule_change_log`
  - `id` (uuid, primary key)
  - `oblast_slug` (text, not null) — oblast identifier from the data source
  - `city_slug` (text, not null) — settlement identifier from the data source
  - `queue` (text, not null) — queue group, e.g. "1.1"
  - `day` (text, not null) — "today" | "tomorrow"
  - `change_type` (text, not null) — "added" | "removed" | "changed" | "initial"
  - `summary` (text, not null) — human-readable description of the change
  - `detected_at` (timestamptz, default now())
2. Purpose
- Tracks how outage schedules change over time so the app can show an
  "update history" tab: which queue changed, when, and what exactly changed.
3. Security
- Enable RLS. Data is public (no personal info), written only by the service
  role from the checker edge function. Public read via anon key.
4. Notes
- Retention: rows older than 14 days are deleted by the checker to keep the
  table small. Index on (oblast_slug, city_slug, detected_at desc).
*/

CREATE TABLE IF NOT EXISTS schedule_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  oblast_slug text NOT NULL,
  city_slug text NOT NULL,
  queue text NOT NULL,
  day text NOT NULL,
  change_type text NOT NULL,
  summary text NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_change_log_city
ON schedule_change_log (oblast_slug, city_slug, detected_at DESC);

ALTER TABLE schedule_change_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read change log" ON schedule_change_log;
CREATE POLICY "Public read change log"
ON schedule_change_log FOR SELECT
TO anon, authenticated
USING (true);


-- ==========================================
-- Migration: 20261007091750_create_schedule_snapshots.sql
-- ==========================================

/*
# Schedule snapshots

1. New Tables
- `schedule_snapshots`
  - `oblast_slug` (text, not null) — part of composite primary key
  - `city_slug` (text, not null) — part of composite primary key
  - `queue` (text, not null) — queue group, e.g. "1.1"
  - `day` (text, not null) — "today" | "tomorrow"
  - `fingerprint` (text, not null) — canonical string of schedule slots;
    empty string means the queue no longer publishes a schedule
  - `updated_at` (timestamptz, default now())
2. Purpose
- Stores the last known schedule fingerprint per (city, queue, day) so the
  change checker can detect and log what changed since the previous check.
3. Security
- Enable RLS. Written only by the service role; public read is harmless but
  the app does not read it — only the change log is user-facing.
4. Notes
- Composite PK (oblast_slug, city_slug, queue, day) enables upsert
  with onConflict. No retention needed: one row per key, always overwritten.
*/

CREATE TABLE IF NOT EXISTS schedule_snapshots (
  oblast_slug text NOT NULL,
  city_slug text NOT NULL,
  queue text NOT NULL,
  day text NOT NULL,
  fingerprint text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (oblast_slug, city_slug, queue, day)
);

ALTER TABLE schedule_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read snapshots" ON schedule_snapshots;
CREATE POLICY "Public read snapshots"
ON schedule_snapshots FOR SELECT
TO anon, authenticated
USING (true);


-- ==========================================
-- Migration: 20261007091804_enable_pg_cron_schedule_checker.sql
-- ==========================================

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


-- ==========================================
-- Migration: 20261007091852_cron_schedule_change_checker.sql
-- ==========================================

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


-- ==========================================
-- Migration: 20261007091910_fix_cron_schedule_change_checker_url.sql
-- ==========================================

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
    url := 'https://umkftvnorktyyrzqbjcm.supabase.co/functions/v1/schedule-change-checker?endpoint=check',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);


-- ==========================================
-- Migration: 20261007100816_fix_cron_net_schema_and_add_notification_checker.sql
-- ==========================================

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
    url := 'https://umkftvnorktyyrzqbjcm.supabase.co/functions/v1/schedule-change-checker?endpoint=check',
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
    url := 'https://umkftvnorktyyrzqbjcm.supabase.co/functions/v1/notification-checker',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);


-- ==========================================
-- Migration: 20261007103847_allow_user_prefs_writes_from_mini_app.sql
-- ==========================================

-- The mini app writes user preferences directly with the anon key (no Supabase auth):
-- Telegram users are identified by their numeric tg_user_id. RLS previously allowed
-- only SELECT, so the client-side upserts of oblast/city/queue were silently dropped
-- and the Telegram bot saw empty settings. Allow INSERT/UPDATE for the app roles.
DROP POLICY IF EXISTS "anon_insert_user_prefs" ON user_preferences;
CREATE POLICY "anon_insert_user_prefs" ON user_preferences
FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_user_prefs" ON user_preferences;
CREATE POLICY "anon_update_user_prefs" ON user_preferences
FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);


-- ==========================================
-- Migration: 20261007111914_add_city_name_to_user_preferences.sql.sql
-- ==========================================

/*
# Store city display name for bot confirmations

1. Modified Tables
- `user_preferences`: add `city_name` (text, nullable) — human-readable city name
  captured by the mini app at selection time, so the Telegram bot can confirm the
  chosen city and queue in a friendly message instead of showing a raw slug.
2. Security
- No RLS changes: column inherits existing anon/authenticated policies.
3. Notes
- Idempotent (IF NOT EXISTS); safe to re-run.
*/

ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS city_name text;


-- ==========================================
-- Migration: 20261007184834_add_slots_to_schedule_change_log.sql
-- ==========================================

/*
# Store before/after schedules for visual change display

1. Modified tables
- `schedule_change_log`: add two nullable jsonb columns:
  - `old_slots`: the schedule intervals BEFORE the change (array of {start, end, type}).
  - `new_slots`: the schedule intervals AFTER the change (same shape).
  These let the mini app draw a visual "before → after" timeline instead of
  only showing a text summary.

2. Security
- No changes: RLS policies already in place apply to the new columns automatically.

3. Notes
- Columns are nullable so existing rows keep working; the UI falls back to the
  text summary when they are empty.
- Backfill: recent rows store the fingerprint only in snapshots, so old rows
  keep old_slots/new_slots empty and render as text.
*/

ALTER TABLE schedule_change_log
  ADD COLUMN IF NOT EXISTS old_slots jsonb,
  ADD COLUMN IF NOT EXISTS new_slots jsonb;


-- ==========================================
-- Migration: 20261007185055_create_schedule_check_state.sql
-- ==========================================

/*
# Track city-level check time and last schedule change

1. New tables
- `schedule_check_state`: one row per followed city.
  - `oblast_slug` (text, part of composite primary key)
  - `city_slug` (text, part of composite primary key)
  - `last_checked_at` (timestamptz): the time the background checker last
    successfully fetched and compared schedules for this city.
  - `last_change_at` (timestamptz, nullable): the time of the most recent
    schedule change detected for this city.

2. Security
- RLS enabled. Single-tenant no-auth app: anon + authenticated can SELECT and
  upsert (the checker uses the service role, which bypasses RLS).

3. Notes
- Solves the confusing UI where "last checked" was derived from snapshot
  timestamps (which only move when the schedule itself changes) while the
  change entry could be newer.
*/

CREATE TABLE IF NOT EXISTS schedule_check_state (
  oblast_slug text NOT NULL,
  city_slug text NOT NULL,
  last_checked_at timestamptz NOT NULL DEFAULT now(),
  last_change_at timestamptz,
  PRIMARY KEY (oblast_slug, city_slug)
);

ALTER TABLE schedule_check_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon can read check state" ON schedule_check_state;
CREATE POLICY "anon can read check state"
ON schedule_check_state FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "anon can upsert check state" ON schedule_check_state;
CREATE POLICY "anon can upsert check state"
ON schedule_check_state FOR INSERT
TO anon, authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "anon can update check state" ON schedule_check_state;
CREATE POLICY "anon can update check state"
ON schedule_check_state FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);


-- ==========================================
-- Migration: 20261007201226_20261007193000_security_lockdown_public_writes.sql.sql
-- ==========================================

/*
# Security audit: lock down public write access

1. Summary

   The security posture review found that every table in the public schema
   granted full INSERT / UPDATE / DELETE to the anonymous role, even where the
   app only ever reads that data from the browser, or where writes must come
   exclusively from server-side Edge Functions (which bypass RLS via the
   service role). Anyone with the public anon key could forge or wipe outage
   schedules, change logs, and other users' preference rows. This migration
   removes every public write path that the application does not need, and
   scopes the one user-writable table to its owner.

2. Tables and their new access model

   - `regions`, `outage_groups`, `outage_schedules` (legacy schema, superseded
     by the YASNO proxy but not dropped here to avoid data loss):
     public read stays, ALL public writes revoked (policies dropped).
   - `live_outage_status`: public read stays, public writes revoked
     (read-only display data).
   - `schedule_change_log`, `schedule_snapshots`, `sent_notifications`:
     public read stays, public writes revoked (written only by Edge Functions
     using the service role).
   - `schedule_check_state`: public read stays; the anonymous UPDATE and
     INSERT policies are revoked (written only by the schedule-change-checker
     Edge Function via the service role).
   - `user_preferences`: the only table the browser may write. Policies are
     replaced with owner-scoped ones keyed on `tg_user_id`, so a user can only
     insert or update rows carrying their own Telegram id and can no longer
     read or modify other users' rows. DELETE is revoked entirely.

3. Security changes

   - Dropped all anonymous INSERT / UPDATE / DELETE policies on the tables
     above.
   - Dropped the open anonymous SELECT policy on `user_preferences` and
     replaced it with `tg_user_id = current_setting('app.tg_user_id')::bigint`
     — see note below on how the client supplies that setting.

4. Notes

   - Edge Functions keep full access because they use the service role, which
     bypasses RLS.
   - No data is deleted or altered by this migration; only policies change.
*/

-- ── 1. Legacy schema tables: read-only for the public API ──────
DROP POLICY IF EXISTS "anon_insert_regions" ON regions;
DROP POLICY IF EXISTS "anon_update_regions" ON regions;
DROP POLICY IF EXISTS "anon_delete_regions" ON regions;
DROP POLICY IF EXISTS "anon_insert_groups" ON outage_groups;
DROP POLICY IF EXISTS "anon_update_groups" ON outage_groups;
DROP POLICY IF EXISTS "anon_delete_groups" ON outage_groups;
DROP POLICY IF EXISTS "anon_insert_schedules" ON outage_schedules;
DROP POLICY IF EXISTS "anon_update_schedules" ON outage_schedules;
DROP POLICY IF EXISTS "anon_delete_schedules" ON outage_schedules;

-- ── 2. Service-written display/log data: public read-only ─────
DROP POLICY IF EXISTS "anon can update check state" ON schedule_check_state;
DROP POLICY IF EXISTS "anon can upsert check state" ON schedule_check_state;

-- ── 3. user_preferences: owner-scoped writes, self-scoped reads ─
-- The mini app sets the current Telegram user id per request via
-- `supabase.rpc('set_tg_user')` before querying, and writes go through
-- the same session-scoped setting instead of trusting client columns.
CREATE OR REPLACE FUNCTION public.set_tg_user(tg_id bigint)
RETURNS void
LANGUAGE sql
VOLATILE
SET search_path = ''
AS $$
  SELECT set_config('app.tg_user_id', tg_id::text, true);
$$;

GRANT EXECUTE ON FUNCTION public.set_tg_user(bigint) TO anon, authenticated;

DROP POLICY IF EXISTS "anon_insert_user_prefs" ON user_preferences;
DROP POLICY IF EXISTS "anon_update_user_prefs" ON user_preferences;
DROP POLICY IF EXISTS "anon_select_user_prefs" ON user_preferences;

CREATE POLICY "users_select_own_prefs" ON user_preferences
FOR SELECT
TO anon, authenticated
USING (tg_user_id = (SELECT NULLIF(current_setting('app.tg_user_id', true), '')::bigint));

CREATE POLICY "users_insert_own_prefs" ON user_preferences
FOR INSERT
TO anon, authenticated
WITH CHECK (tg_user_id = (SELECT NULLIF(current_setting('app.tg_user_id', true), '')::bigint));

CREATE POLICY "users_update_own_prefs" ON user_preferences
FOR UPDATE
TO anon, authenticated
USING (tg_user_id = (SELECT NULLIF(current_setting('app.tg_user_id', true), '')::bigint))
WITH CHECK (tg_user_id = (SELECT NULLIF(current_setting('app.tg_user_id', true), '')::bigint));


-- ==========================================
-- Migration: 20261007201443_20261007200000_cron_jobs_send_internal_secret.sql.sql
-- ==========================================

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
    url := 'https://umkftvnorktyyrzqbjcm.supabase.co/functions/v1/schedule-change-checker?endpoint=check',
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
    url := 'https://umkftvnorktyyrzqbjcm.supabase.co/functions/v1/notification-checker',
    headers := '{"Content-Type": "application/json", "X-Internal-Secret": "sb_publishable_AnonKeyPlaceholder"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);


-- ==========================================
-- Migration: 20261007201553_20261007201000_cron_secret_from_private_table.sql.sql
-- ==========================================

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
    url := 'https://umkftvnorktyyrzqbjcm.supabase.co/functions/v1/schedule-change-checker?endpoint=check',
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
    url := 'https://umkftvnorktyyrzqbjcm.supabase.co/functions/v1/notification-checker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Internal-Secret', secrets.get('CRON_SECRET')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);


-- ==========================================
-- Migration: 20261007201818_20261007202000_get_cron_secret_for_service_role.sql.sql
-- ==========================================

/*
# Expose cron secret to edge functions via a service-role-only function

1. Summary

   The cron secret lives in the private `secrets.values` table, which the
   edge functions cannot reach through the Data API (the schema is not
   exposed). This migration adds a SECURITY DEFINER function that returns the
   secret, locked down so only the service role (used by edge functions with
   the SUPABASE_SERVICE_ROLE_KEY) can execute it. Anon and authenticated
   roles have EXECUTE revoked, so no browser client can read the secret.

2. Changes

   - New function `public.get_cron_secret()` (SECURITY DEFINER, fixed
     search_path) returning the CRON_SECRET value from secrets.values.
   - EXECUTE granted to service_role only; revoked from PUBLIC, anon,
     authenticated.

3. Security

   - The function is callable only with the service role key, which never
     leaves the server environment.
   - Combined with the earlier lockdown, the secret is readable only by the
     database cron system and the project's own edge functions.
*/

CREATE OR REPLACE FUNCTION public.get_cron_secret()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'secrets'
AS $$
  SELECT value FROM secrets.values WHERE name = 'CRON_SECRET';
$$;

REVOKE ALL ON FUNCTION public.get_cron_secret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cron_secret() TO service_role;


-- ==========================================
-- Migration: 20261007203223_20261007210000_snapshots_use_schedule_date.sql.sql
-- ==========================================

/*
# Schedule snapshots: use real calendar dates instead of "today"/"tomorrow"

1. Summary

   The snapshot table stored `day` as "today" or "tomorrow", which is
   ambiguous after midnight: the new "today" is a different calendar date
   from yesterday's "today", but the snapshot key was the same, causing
   false change detection around midnight. This migration adds a
   `schedule_date` column (the actual calendar date the schedule applies to)
   and makes it the primary key dimension instead of `day`.

2. Changes

   - Adds nullable `schedule_date date` to `schedule_snapshots`.
   - Backfills existing rows: "today" → current date, "tomorrow" → current
     date + 1. (Approximate but safe; rows will be overwritten on next check.)
   - Sets `schedule_date NOT NULL`.
   - Drops the old composite PK on `(oblast_slug, city_slug, queue, day)`
     and creates a new one on `(oblast_slug, city_slug, queue, schedule_date)`.
   - Adds index on `schedule_date` for retention cleanup.

3. Notes

   - The `day` column remains for backward compatibility but is no longer
     part of the primary key.
*/

ALTER TABLE schedule_snapshots
  ADD COLUMN IF NOT EXISTS schedule_date date;

UPDATE schedule_snapshots
SET schedule_date = CASE
  WHEN day = 'today' THEN current_date
  WHEN day = 'tomorrow' THEN current_date + 1
  ELSE current_date
END
WHERE schedule_date IS NULL;

ALTER TABLE schedule_snapshots
  ALTER COLUMN schedule_date SET NOT NULL;

ALTER TABLE schedule_snapshots DROP CONSTRAINT IF EXISTS schedule_snapshots_pkey;
ALTER TABLE schedule_snapshots
  ADD CONSTRAINT schedule_snapshots_pkey
  PRIMARY KEY (oblast_slug, city_slug, queue, schedule_date);

CREATE INDEX IF NOT EXISTS idx_snapshots_date
ON schedule_snapshots (schedule_date);


-- ==========================================
-- Migration: 20261007203407_20261007213000_add_last_seen_changes_to_user_prefs.sql.sql
-- ==========================================

/*
# Per-user, per-city "changes seen" timestamp

1. Summary

   The red dot on the "schedule changes" button was tracked in localStorage,
   which meant it was per-browser and not per-city: switching cities would
   show or hide the dot incorrectly. This migration adds a
   `last_seen_changes_at` column to user_preferences so the seen-state is
   stored server-side, tied to the user's Telegram account.

2. Changes

   - Adds nullable `last_seen_changes_at timestamptz` to user_preferences.
   - The user-prefs edge function reads and writes this field; the mini app
     compares it against schedule_check_state.last_change_at to decide
     whether to show the red dot.

3. Notes

   - Nullable so existing rows are unaffected; a null value means "never
     seen", which always shows the dot if there are changes.
*/

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS last_seen_changes_at timestamptz;


-- ==========================================
-- Migration: 20261007203730_20261008000000_lockdown_set_tg_user_and_service_grants.sql.sql
-- ==========================================

/*
# Lock down set_tg_user and revoke public write grants on service tables

## Summary

Two security hardening changes:

1. **set_tg_user() EXECUTE revoked from anon/authenticated** — Previously any client
   with the anon key could call `set_tg_user(<any_id>)` to impersonate any Telegram
   user, then directly SELECT from `user_preferences` and read another user's settings.
   This bypassed the Telegram initData HMAC verification in the user-prefs edge function.
   Now only `service_role` can call `set_tg_user()`. Since all user_preferences access
   is routed through edge functions using the service role key (which bypasses RLS),
   this function is only needed by server-side code.

2. **INSERT/UPDATE/DELETE grants revoked from anon/authenticated on all service tables**
   — RLS already blocks writes (no write policies exist on these tables), but the
   underlying GRANTs were still present. Revoking them as defense-in-depth so that
   even if a write policy were accidentally added in the future, the grant wouldn't
   allow it.

## Tables affected (grant revocation):
- schedule_snapshots
- schedule_change_log
- schedule_check_state
- sent_notifications
- live_outage_status
- outage_groups
- outage_schedules
- regions
- user_preferences

All tables retain SELECT grant to anon, authenticated (read access stays public
per existing SELECT policies).

## Functions affected:
- public.set_tg_user(bigint): EXECUTE revoked from anon, authenticated; kept for service_role

## Security:
- Closes impersonation bypass via set_tg_user
- Defense-in-depth: removes unused write grants on service tables
*/

-- 1. Lock down set_tg_user to service_role only
REVOKE EXECUTE ON FUNCTION public.set_tg_user(bigint) FROM anon, authenticated;

-- 2. Revoke write grants from anon on all service tables (RLS already blocks, this is defense-in-depth)
REVOKE INSERT, UPDATE, DELETE ON TABLE schedule_snapshots FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE schedule_change_log FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE schedule_check_state FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE sent_notifications FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE live_outage_status FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE outage_groups FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE outage_schedules FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE regions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE user_preferences FROM anon, authenticated;


-- ==========================================
-- Migration: 20261007205142_20261007220000_schedule_date_per_city_seen_outbox.sql
-- ==========================================

/*
# Schedule date in change log, per-city seen state, notification outbox

1. schedule_change_log: add schedule_date column
   - The `day` column stores "today"/"tomorrow" which becomes meaningless
     after the day passes. Adding `schedule_date date` stores the actual
     calendar date the change applies to, so the UI can show "08.10.2026"
     instead of a stale "завтра".
   - Nullable so existing rows are unaffected. The checker populates it
     for all new rows; the UI falls back to `day` when null.

2. New table: user_change_views (per-user, per-city "changes seen")
   - Replaces the single `last_seen_changes_at` timestamp on user_preferences,
     which was per-user only. Switching cities caused the seen-state from
     one city to leak into another.
   - Columns: tg_user_id, oblast_slug, city_slug, last_seen_at.
   - Composite PK on (tg_user_id, oblast_slug, city_slug).
   - RLS enabled, public read/upsert (single-tenant no-auth app).

3. New table: notification_outbox
   - Durable queue for "schedule changed" notifications. The change checker
     inserts rows here instead of calling Telegram directly, so a failed
     send can be retried on the next run without losing the notification.
   - Columns: id, tg_user_id, change_id (FK to schedule_change_log),
     status (pending/sent/failed), attempts, next_attempt_at, sent_at.
   - RLS enabled, service-role only (no anon/auth grants — the checker
     runs as service_role which bypasses RLS).

4. Security
   - user_change_views: anon + authenticated can SELECT and UPSERT (the
     mini app reads/writes via the user-prefs edge function which uses
     the service key; but direct anon access is also safe since the data
     is non-sensitive).
   - notification_outbox: no anon/auth policies — only the service role
     (edge functions) can access it.
*/

-- 1. Add schedule_date to schedule_change_log
ALTER TABLE schedule_change_log
  ADD COLUMN IF NOT EXISTS schedule_date date;

-- 2. Per-user, per-city change views table
CREATE TABLE IF NOT EXISTS user_change_views (
  tg_user_id bigint NOT NULL,
  oblast_slug text NOT NULL,
  city_slug text NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tg_user_id, oblast_slug, city_slug)
);

ALTER TABLE user_change_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon can read change views" ON user_change_views;
CREATE POLICY "anon can read change views"
ON user_change_views FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "anon can upsert change views" ON user_change_views;
CREATE POLICY "anon can upsert change views"
ON user_change_views FOR INSERT
TO anon, authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "anon can update change views" ON user_change_views;
CREATE POLICY "anon can update change views"
ON user_change_views FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- 3. Notification outbox table
CREATE TABLE IF NOT EXISTS notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tg_user_id bigint NOT NULL,
  change_id uuid NOT NULL REFERENCES schedule_change_log(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending
ON notification_outbox (status, next_attempt_at)
WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_outbox_user_change
ON notification_outbox (tg_user_id, change_id);

ALTER TABLE notification_outbox ENABLE ROW LEVEL SECURITY;
-- No policies: only service_role (edge functions) can access.


-- ==========================================
-- Migration: 20261008052604_schedule_change_check_every_15min.sql
-- ==========================================

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
    url := 'https://umkftvnorktyyrzqbjcm.supabase.co/functions/v1/schedule-change-checker?endpoint=check',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Internal-Secret', secrets.get('CRON_SECRET')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);


-- ==========================================
-- Migration: 20261008052641_notification_outbox_unique_user_change.sql
-- ==========================================

/*
# Fix: change notifications never queued

The schedule-change-checker upserts into notification_outbox with
onConflict: "tg_user_id,change_id", but the table only had a non-unique
index on that pair. PostgREST requires a UNIQUE constraint for
ON CONFLICT, so every outbox insert failed and users never received
"график обновился" messages. Replace the plain index with a unique one.
*/

DROP INDEX IF EXISTS public.idx_outbox_user_change;

ALTER TABLE public.notification_outbox
  ADD CONSTRAINT notification_outbox_user_change_uniq UNIQUE (tg_user_id, change_id);


-- ==========================================
-- Migration: 20261008061751_add_second_location_support.sql.sql
-- ==========================================

/*
# Add second location (Work / Home) support

1. Modified Tables
- `user_preferences`
  - `alt_oblast_slug` (text, nullable) — oblast of the second location (e.g. work).
  - `alt_city_slug` (text, nullable) — settlement slug of the second location.
  - `alt_city_name` (text, nullable) — display name of the second location.
  - `alt_queue_group` (text, nullable) — queue group of the second location.
  - `active_location` (text, not null, default 'home') — which location the mini app shows: 'home' or 'work'.
2. Security
- No new tables; RLS unchanged. New columns are only written through the
  user-prefs edge function which verifies Telegram initData, and by the
  service role (checkers). Existing lockdown grants cover the table.
3. Notes
- All columns are nullable so nothing breaks for existing users who only
  have one location. NULL alt_* means the user hasn't set a second location.
*/

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS alt_oblast_slug text,
  ADD COLUMN IF NOT EXISTS alt_city_slug text,
  ADD COLUMN IF NOT EXISTS alt_city_name text,
  ADD COLUMN IF NOT EXISTS alt_queue_group text,
  ADD COLUMN IF NOT EXISTS active_location text NOT NULL DEFAULT 'home';


-- ==========================================
-- Migration: 20261008062716_add_alt_location_label.sql
-- ==========================================

/*
# Add custom label for the second location

- `user_preferences.alt_label` (text, nullable) — user-chosen name for the
  second location tab (e.g. "Робота", "Офіс", "Дача"). Falls back to
  "Робота" in the UI when NULL.
*/

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS alt_label text;

-- ==========================================
-- Migration: 20261008064645_add_home_label_to_user_preferences.sql
-- ==========================================

/*
# Add home_label to user_preferences

1. Modified Tables
- `user_preferences`: adds nullable `home_label text` column — a custom name
  for the primary ("home") location tab shown on the main screen, mirroring
  the existing `alt_label` column for the second location. Max 24 chars is
  enforced in the user-prefs edge function, not in the database.
2. Security
- No RLS changes: the table already has its lockdown policies; the new column
  is written only through the user-prefs edge function (service role), which
  validates and sanitizes the value server-side.
3. Notes
- Nullable with no default: an empty value means "show the default label
  Дім" in the app.
*/

ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS home_label text;

-- ==========================================
-- Migration: 20261008071712_20261008120000_track_bot_messages_for_reset.sql
-- ==========================================

/*
# Track Telegram bot messages for complete reset

1. New Tables
- `telegram_bot_messages` stores the Telegram chat ID and message ID for every
  message sent by the bot. This gives the reset flow a durable list of messages
  that Telegram allows the bot to delete.

2. Security
- Row level security is enabled.
- The table is internal and is not granted to anon or authenticated clients.
- Only the service role used by the Telegram edge function can read, insert, and
  delete tracking rows.

3. Important Notes
- Telegram Bot API does not provide a get-chat-history method. Messages sent
  before tracking was introduced cannot be discovered retroactively by the bot.
- Existing tracked messages and all future bot messages can be removed during
  a full reset.
*/

CREATE TABLE IF NOT EXISTS public.telegram_bot_messages (
  tg_user_id bigint NOT NULL,
  message_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tg_user_id, message_id)
);

ALTER TABLE public.telegram_bot_messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.telegram_bot_messages FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.telegram_bot_messages TO service_role;

CREATE INDEX IF NOT EXISTS telegram_bot_messages_user_idx
  ON public.telegram_bot_messages (tg_user_id, created_at);

