/*
# Per-user, per-city "changes seen" timestamp

1. Summary

   The red dot on the "schedule changes" button was tracked in localStorage,
   which meant it was per-browser and not per-city: switching cities would
   show or hide the dot incorrectly. This migration adds a
   `last_seen_changes_at` column to user_preferences so the seen-state is
   stored server-side, tied to the user's Telegram account.

2. Changes

   - Adds nullable `last_seen_changes_at timestamptz` to user_preferences.
   - The user-prefs edge function reads and writes this field; the mini app
     compares it against schedule_check_state.last_change_at to decide
     whether to show the red dot.

3. Notes

   - Nullable so existing rows are unaffected; a null value means "never
     seen", which always shows the dot if there are changes.
*/

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS last_seen_changes_at timestamptz;
