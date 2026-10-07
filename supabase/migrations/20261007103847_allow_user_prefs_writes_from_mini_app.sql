-- The mini app writes user preferences directly with the anon key (no Supabase auth):
-- Telegram users are identified by their numeric tg_user_id. RLS previously allowed
-- only SELECT, so the client-side upserts of oblast/city/queue were silently dropped
-- and the Telegram bot saw empty settings. Allow INSERT/UPDATE for the app roles.
DROP POLICY IF EXISTS "anon_insert_user_prefs" ON user_preferences;
CREATE POLICY "anon_insert_user_prefs" ON user_preferences
FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_user_prefs" ON user_preferences;
CREATE POLICY "anon_update_user_prefs" ON user_preferences
FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
