/*
# Store city display name for bot confirmations

1. Modified Tables
- `user_preferences`: add `city_name` (text, nullable) — human-readable city name
  captured by the mini app at selection time, so the Telegram bot can confirm the
  chosen city and queue in a friendly message instead of showing a raw slug.
2. Security
- No RLS changes: column inherits existing anon/authenticated policies.
3. Notes
- Idempotent (IF NOT EXISTS); safe to re-run.
*/

ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS city_name text;
