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
