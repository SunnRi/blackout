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
