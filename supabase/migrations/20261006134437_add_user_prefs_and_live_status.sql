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