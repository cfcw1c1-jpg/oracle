-- =========================================================================
-- Exposes each account's last sign-in time to the Portal Users page.
-- Supabase tracks this on auth.users.last_sign_in_at, a schema only this
-- project's own "postgres" role can read directly -- not queryable from
-- the client via the normal REST/RPC path the way public.* tables are
-- (same reasoning as add-profiles-avatar-url.sql's avatar backfill).
--
-- This adds a SECURITY DEFINER RPC that hands back { profile_id,
-- last_sign_in_at } for every account, gated to Admins/Moderators only --
-- the same pair already trusted with every other account-level admin view
-- in this app (Change Requests, the Audit Log, etc).
--
-- Run once. Safe to re-run.
-- =========================================================================

CREATE OR REPLACE FUNCTION "public"."get_portal_users_last_sign_in"()
RETURNS TABLE ("profile_id" "uuid", "last_sign_in_at" timestamp with time zone)
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" = 'public'
AS $$
BEGIN
  IF NOT (public.is_admin() OR public.is_moderator()) THEN
    RAISE EXCEPTION 'Only Admins/Moderators can view sign-in activity';
  END IF;

  RETURN QUERY
  SELECT u.id, u.last_sign_in_at
  FROM auth.users u;
END;
$$;

ALTER FUNCTION "public"."get_portal_users_last_sign_in"() OWNER TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."get_portal_users_last_sign_in"() TO "authenticated";
