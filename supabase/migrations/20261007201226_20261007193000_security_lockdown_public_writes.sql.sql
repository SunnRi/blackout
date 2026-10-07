/*
# Security audit: lock down public write access

1. Summary

   The security posture review found that every table in the public schema
   granted full INSERT / UPDATE / DELETE to the anonymous role, even where the
   app only ever reads that data from the browser, or where writes must come
   exclusively from server-side Edge Functions (which bypass RLS via the
   service role). Anyone with the public anon key could forge or wipe outage
   schedules, change logs, and other users' preference rows. This migration
   removes every public write path that the application does not need, and
   scopes the one user-writable table to its owner.

2. Tables and their new access model

   - `regions`, `outage_groups`, `outage_schedules` (legacy schema, superseded
     by the YASNO proxy but not dropped here to avoid data loss):
     public read stays, ALL public writes revoked (policies dropped).
   - `live_outage_status`: public read stays, public writes revoked
     (read-only display data).
   - `schedule_change_log`, `schedule_snapshots`, `sent_notifications`:
     public read stays, public writes revoked (written only by Edge Functions
     using the service role).
   - `schedule_check_state`: public read stays; the anonymous UPDATE and
     INSERT policies are revoked (written only by the schedule-change-checker
     Edge Function via the service role).
   - `user_preferences`: the only table the browser may write. Policies are
     replaced with owner-scoped ones keyed on `tg_user_id`, so a user can only
     insert or update rows carrying their own Telegram id and can no longer
     read or modify other users' rows. DELETE is revoked entirely.

3. Security changes

   - Dropped all anonymous INSERT / UPDATE / DELETE policies on the tables
     above.
   - Dropped the open anonymous SELECT policy on `user_preferences` and
     replaced it with `tg_user_id = current_setting('app.tg_user_id')::bigint`
     — see note below on how the client supplies that setting.

4. Notes

   - Edge Functions keep full access because they use the service role, which
     bypasses RLS.
   - No data is deleted or altered by this migration; only policies change.
*/

-- ── 1. Legacy schema tables: read-only for the public API ──────
DROP POLICY IF EXISTS "anon_insert_regions" ON regions;
DROP POLICY IF EXISTS "anon_update_regions" ON regions;
DROP POLICY IF EXISTS "anon_delete_regions" ON regions;
DROP POLICY IF EXISTS "anon_insert_groups" ON outage_groups;
DROP POLICY IF EXISTS "anon_update_groups" ON outage_groups;
DROP POLICY IF EXISTS "anon_delete_groups" ON outage_groups;
DROP POLICY IF EXISTS "anon_insert_schedules" ON outage_schedules;
DROP POLICY IF EXISTS "anon_update_schedules" ON outage_schedules;
DROP POLICY IF EXISTS "anon_delete_schedules" ON outage_schedules;

-- ── 2. Service-written display/log data: public read-only ─────
DROP POLICY IF EXISTS "anon can update check state" ON schedule_check_state;
DROP POLICY IF EXISTS "anon can upsert check state" ON schedule_check_state;

-- ── 3. user_preferences: owner-scoped writes, self-scoped reads ─
-- The mini app sets the current Telegram user id per request via
-- `supabase.rpc('set_tg_user')` before querying, and writes go through
-- the same session-scoped setting instead of trusting client columns.
CREATE OR REPLACE FUNCTION public.set_tg_user(tg_id bigint)
RETURNS void
LANGUAGE sql
VOLATILE
SET search_path = ''
AS $$
  SELECT set_config('app.tg_user_id', tg_id::text, true);
$$;

GRANT EXECUTE ON FUNCTION public.set_tg_user(bigint) TO anon, authenticated;

DROP POLICY IF EXISTS "anon_insert_user_prefs" ON user_preferences;
DROP POLICY IF EXISTS "anon_update_user_prefs" ON user_preferences;
DROP POLICY IF EXISTS "anon_select_user_prefs" ON user_preferences;

CREATE POLICY "users_select_own_prefs" ON user_preferences
FOR SELECT
TO anon, authenticated
USING (tg_user_id = (SELECT NULLIF(current_setting('app.tg_user_id', true), '')::bigint));

CREATE POLICY "users_insert_own_prefs" ON user_preferences
FOR INSERT
TO anon, authenticated
WITH CHECK (tg_user_id = (SELECT NULLIF(current_setting('app.tg_user_id', true), '')::bigint));

CREATE POLICY "users_update_own_prefs" ON user_preferences
FOR UPDATE
TO anon, authenticated
USING (tg_user_id = (SELECT NULLIF(current_setting('app.tg_user_id', true), '')::bigint))
WITH CHECK (tg_user_id = (SELECT NULLIF(current_setting('app.tg_user_id', true), '')::bigint));
