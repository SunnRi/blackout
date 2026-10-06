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