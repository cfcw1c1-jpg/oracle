-- =========================================================================
-- Adds a configurable retention/purge policy for audit_log and
-- training_lookup_logs, managed from the new Admin "Settings" page instead
-- of being hardcoded. Both logs currently grow forever.
--
-- Creates:
--   1. log_retention_settings -- a single-row config table (Admin-only
--      read/write) holding how many days to keep each log, NULL meaning
--      "keep forever".
--   2. purge_expired_logs() -- the actual DELETE worker. No caller check
--      inside it (see below for why), so it is NEVER granted directly to
--      "authenticated" -- only pg_cron (trusted, internal) and the wrapper
--      below can reach it.
--   3. admin_purge_expired_logs() -- thin wrapper that checks is_admin()
--      first, then calls purge_expired_logs(). This is what the "Purge
--      Now" button on the Settings page calls.
--   4. A best-effort daily pg_cron schedule calling purge_expired_logs()
--      directly (bypassing the admin check, since a scheduled job has no
--      "caller" to check). If pg_cron isn't available on your Supabase
--      plan, this section fails safely and the rest of the script still
--      applies -- "Purge Now" always works regardless as a manual
--      fallback, and you could also call admin_purge_expired_logs() from
--      an external scheduler if you have one.
--   5. admin_get_purge_schedule_status() -- lets the Settings page show
--      whether the daily schedule actually exists and is active, since
--      that can't be checked any other way from the client.
--
-- Run once. Safe to re-run.
-- =========================================================================

-- ---------- 1. Settings table ----------
CREATE TABLE IF NOT EXISTS "public"."log_retention_settings" (
    "id" boolean PRIMARY KEY DEFAULT true,
    "audit_log_retention_days" integer,
    "training_lookup_logs_retention_days" integer,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid" REFERENCES "public"."profiles"("id") ON DELETE SET NULL,
    CONSTRAINT "log_retention_settings_singleton" CHECK ("id")
);

ALTER TABLE "public"."log_retention_settings" OWNER TO "postgres";

-- Seed the single row if it doesn't exist yet. Defaults: keep audit log
-- entries for a year, public search logs for 90 days -- adjust anytime
-- from the Settings page.
INSERT INTO "public"."log_retention_settings" ("id", "audit_log_retention_days", "training_lookup_logs_retention_days")
VALUES (true, 365, 90)
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "public"."log_retention_settings" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view retention settings" ON "public"."log_retention_settings";
CREATE POLICY "Admins can view retention settings" ON "public"."log_retention_settings"
FOR SELECT TO "authenticated"
USING ("public"."is_admin"());

DROP POLICY IF EXISTS "Admins can update retention settings" ON "public"."log_retention_settings";
CREATE POLICY "Admins can update retention settings" ON "public"."log_retention_settings"
FOR UPDATE TO "authenticated"
USING ("public"."is_admin"())
WITH CHECK ("public"."is_admin"());

GRANT SELECT, UPDATE ON TABLE "public"."log_retention_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."log_retention_settings" TO "service_role";

-- ---------- 2. The actual purge worker ----------
-- No is_admin() check in here on purpose -- pg_cron's scheduled call has
-- no signed-in "caller" to check (auth.uid() is null in that context), so
-- gating here would silently block the automatic schedule too. Access
-- control lives in the wrapper (below) and in never granting EXECUTE on
-- this function to "authenticated" at all.
CREATE OR REPLACE FUNCTION "public"."purge_expired_logs"()
RETURNS TABLE("audit_log_deleted" bigint, "training_lookup_logs_deleted" bigint)
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" = 'public'
AS $$
DECLARE
  v_settings public.log_retention_settings%ROWTYPE;
  v_audit_deleted bigint := 0;
  v_lookup_deleted bigint := 0;
BEGIN
  SELECT * INTO v_settings FROM public.log_retention_settings WHERE id = true;

  IF v_settings.audit_log_retention_days IS NOT NULL THEN
    DELETE FROM public.audit_log
    WHERE changed_at < now() - (v_settings.audit_log_retention_days || ' days')::interval;
    GET DIAGNOSTICS v_audit_deleted = ROW_COUNT;
  END IF;

  IF v_settings.training_lookup_logs_retention_days IS NOT NULL THEN
    DELETE FROM public.training_lookup_logs
    WHERE created_at < now() - (v_settings.training_lookup_logs_retention_days || ' days')::interval;
    GET DIAGNOSTICS v_lookup_deleted = ROW_COUNT;
  END IF;

  RETURN QUERY SELECT v_audit_deleted, v_lookup_deleted;
END;
$$;

ALTER FUNCTION "public"."purge_expired_logs"() OWNER TO "postgres";
-- Deliberately NOT granted to "authenticated" -- see comment above.
GRANT EXECUTE ON FUNCTION "public"."purge_expired_logs"() TO "service_role";

-- ---------- 3. Admin-facing wrapper ("Purge Now" button) ----------
CREATE OR REPLACE FUNCTION "public"."admin_purge_expired_logs"()
RETURNS TABLE("audit_log_deleted" bigint, "training_lookup_logs_deleted" bigint)
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" = 'public'
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only Admins can purge logs';
  END IF;
  RETURN QUERY SELECT * FROM public.purge_expired_logs();
END;
$$;

ALTER FUNCTION "public"."admin_purge_expired_logs"() OWNER TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."admin_purge_expired_logs"() TO "authenticated";

-- ---------- 4. Best-effort daily schedule ----------
DO $outer$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron extension not available on this project -- skipping automatic scheduling. "Purge Now" on the Settings page still works manually.';
END
$outer$;

DO $outer$
BEGIN
  PERFORM cron.unschedule('purge-expired-logs-daily');
EXCEPTION WHEN OTHERS THEN
  NULL; -- fine if it didn't exist yet, or pg_cron isn't available
END
$outer$;

DO $outer$
BEGIN
  PERFORM cron.schedule(
    'purge-expired-logs-daily',
    '0 3 * * *', -- 3:00 AM UTC daily
    $cron$SELECT public.purge_expired_logs();$cron$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not schedule the automatic daily purge (pg_cron unavailable) -- use "Purge Now" manually, or trigger admin_purge_expired_logs() from an external scheduler.';
END
$outer$;

-- ---------- 5. Let the Settings page report whether the schedule is live ----------
-- Querying cron.job directly from the client isn't possible (anon/
-- authenticated roles have no access to the cron schema at all), and
-- there's no CLI/API path to check it without a direct Postgres
-- connection either -- so the Settings page asks the database itself via
-- this function, the same way it already asks for a manual purge.
CREATE OR REPLACE FUNCTION "public"."admin_get_purge_schedule_status"()
RETURNS "jsonb"
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" = 'public'
AS $$
DECLARE
  v_job record;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only Admins can view this';
  END IF;

  BEGIN
    SELECT jobname, schedule, active INTO v_job
    FROM cron.job
    WHERE jobname = 'purge-expired-logs-daily';
  EXCEPTION WHEN OTHERS THEN
    -- pg_cron extension/schema isn't installed on this project at all.
    RETURN jsonb_build_object('available', false, 'scheduled', false);
  END;

  IF v_job IS NULL THEN
    RETURN jsonb_build_object('available', true, 'scheduled', false);
  END IF;

  RETURN jsonb_build_object(
    'available', true,
    'scheduled', true,
    'active', v_job.active,
    'schedule', v_job.schedule
  );
END;
$$;

ALTER FUNCTION "public"."admin_get_purge_schedule_status"() OWNER TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."admin_get_purge_schedule_status"() TO "authenticated";

-- ---------- 6. Register the "Settings" page ----------
INSERT INTO "public"."pages" ("key", "label", "sort_order") VALUES
    ('settings', 'Settings', 15)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "public"."role_pages" ("role_id", "page_key")
SELECT "id", 'settings' FROM "public"."roles" WHERE "name" = 'Admin'
ON CONFLICT DO NOTHING;

-- Verify afterwards:
-- SELECT * FROM public.log_retention_settings;
-- SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'purge-expired-logs-daily';
