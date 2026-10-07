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
