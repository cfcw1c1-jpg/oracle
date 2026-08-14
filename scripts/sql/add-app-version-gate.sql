-- =========================================================================
-- Force-update gate for the native iOS/Android app: a single-row config
-- table holding the minimum app version allowed per platform, plus the
-- store link and message to show whoever's behind. The web build has no
-- equivalent gap to enforce (every page load already serves the latest
-- build), so this only ever applies on native.
--
-- Readable by literally anyone, signed in or not -- the gate has to be
-- able to run before/without auth (an outdated build shouldn't even be
-- able to reach the Login screen). Only Admins can change the required
-- version, from the new "App Update" tab on the Settings page.
--
-- Run once. Safe to re-run.
-- =========================================================================

CREATE TABLE IF NOT EXISTS "public"."app_version_requirements" (
    "id" boolean PRIMARY KEY DEFAULT true,
    "min_ios_version" "text",
    "min_android_version" "text",
    "ios_store_url" "text",
    "android_store_url" "text",
    "update_message" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid" REFERENCES "public"."profiles"("id") ON DELETE SET NULL,
    CONSTRAINT "app_version_requirements_singleton" CHECK ("id")
);

ALTER TABLE "public"."app_version_requirements" OWNER TO "postgres";

-- Seed the single row, unset -- the gate is a no-op (nobody is forced to
-- update) until an Admin fills in a minimum version for at least one
-- platform from the Settings page.
INSERT INTO "public"."app_version_requirements" ("id")
VALUES (true)
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "public"."app_version_requirements" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view app version requirements" ON "public"."app_version_requirements";
CREATE POLICY "Anyone can view app version requirements" ON "public"."app_version_requirements"
FOR SELECT TO "anon", "authenticated"
USING (true);

DROP POLICY IF EXISTS "Admins can update app version requirements" ON "public"."app_version_requirements";
CREATE POLICY "Admins can update app version requirements" ON "public"."app_version_requirements"
FOR UPDATE TO "authenticated"
USING ("public"."is_admin"())
WITH CHECK ("public"."is_admin"());

GRANT SELECT ON TABLE "public"."app_version_requirements" TO "anon";
GRANT SELECT, UPDATE ON TABLE "public"."app_version_requirements" TO "authenticated";

-- ---------- Realtime ----------
-- So an app already open picks up a newly-forced minimum version live,
-- without needing to be relaunched first.
DO $$
BEGIN
  ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."app_version_requirements";
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;
