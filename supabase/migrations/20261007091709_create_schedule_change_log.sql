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
