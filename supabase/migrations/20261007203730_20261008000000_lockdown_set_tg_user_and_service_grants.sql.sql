/*
# Lock down set_tg_user and revoke public write grants on service tables

## Summary

Two security hardening changes:

1. **set_tg_user() EXECUTE revoked from anon/authenticated** — Previously any client
   with the anon key could call `set_tg_user(<any_id>)` to impersonate any Telegram
   user, then directly SELECT from `user_preferences` and read another user's settings.
   This bypassed the Telegram initData HMAC verification in the user-prefs edge function.
   Now only `service_role` can call `set_tg_user()`. Since all user_preferences access
   is routed through edge functions using the service role key (which bypasses RLS),
   this function is only needed by server-side code.

2. **INSERT/UPDATE/DELETE grants revoked from anon/authenticated on all service tables**
   — RLS already blocks writes (no write policies exist on these tables), but the
   underlying GRANTs were still present. Revoking them as defense-in-depth so that
   even if a write policy were accidentally added in the future, the grant wouldn't
   allow it.

## Tables affected (grant revocation):
- schedule_snapshots
- schedule_change_log
- schedule_check_state
- sent_notifications
- live_outage_status
- outage_groups
- outage_schedules
- regions
- user_preferences

All tables retain SELECT grant to anon, authenticated (read access stays public
per existing SELECT policies).

## Functions affected:
- public.set_tg_user(bigint): EXECUTE revoked from anon, authenticated; kept for service_role

## Security:
- Closes impersonation bypass via set_tg_user
- Defense-in-depth: removes unused write grants on service tables
*/

-- 1. Lock down set_tg_user to service_role only
REVOKE EXECUTE ON FUNCTION public.set_tg_user(bigint) FROM anon, authenticated;

-- 2. Revoke write grants from anon on all service tables (RLS already blocks, this is defense-in-depth)
REVOKE INSERT, UPDATE, DELETE ON TABLE schedule_snapshots FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE schedule_change_log FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE schedule_check_state FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE sent_notifications FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE live_outage_status FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE outage_groups FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE outage_schedules FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE regions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE user_preferences FROM anon, authenticated;
