/*
# Expose cron secret to edge functions via a service-role-only function

1. Summary

   The cron secret lives in the private `secrets.values` table, which the
   edge functions cannot reach through the Data API (the schema is not
   exposed). This migration adds a SECURITY DEFINER function that returns the
   secret, locked down so only the service role (used by edge functions with
   the SUPABASE_SERVICE_ROLE_KEY) can execute it. Anon and authenticated
   roles have EXECUTE revoked, so no browser client can read the secret.

2. Changes

   - New function `public.get_cron_secret()` (SECURITY DEFINER, fixed
     search_path) returning the CRON_SECRET value from secrets.values.
   - EXECUTE granted to service_role only; revoked from PUBLIC, anon,
     authenticated.

3. Security

   - The function is callable only with the service role key, which never
     leaves the server environment.
   - Combined with the earlier lockdown, the secret is readable only by the
     database cron system and the project's own edge functions.
*/

CREATE OR REPLACE FUNCTION public.get_cron_secret()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'secrets'
AS $$
  SELECT value FROM secrets.values WHERE name = 'CRON_SECRET';
$$;

REVOKE ALL ON FUNCTION public.get_cron_secret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cron_secret() TO service_role;
