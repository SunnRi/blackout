/*
# Add home_label to user_preferences

1. Modified Tables
- `user_preferences`: adds nullable `home_label text` column — a custom name
  for the primary ("home") location tab shown on the main screen, mirroring
  the existing `alt_label` column for the second location. Max 24 chars is
  enforced in the user-prefs edge function, not in the database.
2. Security
- No RLS changes: the table already has its lockdown policies; the new column
  is written only through the user-prefs edge function (service role), which
  validates and sanitizes the value server-side.
3. Notes
- Nullable with no default: an empty value means "show the default label
  Дім" in the app.
*/

ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS home_label text;