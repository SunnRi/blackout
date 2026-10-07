/*
# Add oblast slug to user preferences

1. Modified Tables
- `user_preferences`: add `oblast_slug` (text, nullable) — bezsvitla slug of the selected oblast
  (e.g. "kyivska-oblast", or "kyiv-city" for the capital). Complements existing `city_slug`.
2. Security
- No changes: table already has RLS enabled with existing policies; new nullable column
  is readable/writable under the same policies.
3. Notes
- Nullable + no backfill needed: existing rows (city-only users) keep working; the app
  writes oblast_slug on next preference save.
*/

ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS oblast_slug text;
