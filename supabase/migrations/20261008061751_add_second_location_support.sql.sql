/*
# Add second location (Work / Home) support

1. Modified Tables
- `user_preferences`
  - `alt_oblast_slug` (text, nullable) — oblast of the second location (e.g. work).
  - `alt_city_slug` (text, nullable) — settlement slug of the second location.
  - `alt_city_name` (text, nullable) — display name of the second location.
  - `alt_queue_group` (text, nullable) — queue group of the second location.
  - `active_location` (text, not null, default 'home') — which location the mini app shows: 'home' or 'work'.
2. Security
- No new tables; RLS unchanged. New columns are only written through the
  user-prefs edge function which verifies Telegram initData, and by the
  service role (checkers). Existing lockdown grants cover the table.
3. Notes
- All columns are nullable so nothing breaks for existing users who only
  have one location. NULL alt_* means the user hasn't set a second location.
*/

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS alt_oblast_slug text,
  ADD COLUMN IF NOT EXISTS alt_city_slug text,
  ADD COLUMN IF NOT EXISTS alt_city_name text,
  ADD COLUMN IF NOT EXISTS alt_queue_group text,
  ADD COLUMN IF NOT EXISTS active_location text NOT NULL DEFAULT 'home';
