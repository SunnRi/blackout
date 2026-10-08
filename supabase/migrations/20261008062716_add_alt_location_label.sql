/*
# Add custom label for the second location

- `user_preferences.alt_label` (text, nullable) — user-chosen name for the
  second location tab (e.g. "Робота", "Офіс", "Дача"). Falls back to
  "Робота" in the UI when NULL.
*/

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS alt_label text;