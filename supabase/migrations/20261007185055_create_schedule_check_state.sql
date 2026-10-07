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
