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
