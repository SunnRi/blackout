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