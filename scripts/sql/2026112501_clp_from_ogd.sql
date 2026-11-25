-- =========================================================================
-- CLP Maintenance from OGD: each chapter's CLPs are read from OGD's
-- Evangelization page (and each CLP's "Manage Details" page) and saved as
-- clp_trainings batches.
--
-- New clp_trainings columns (no personal data: clp_trainings is readable
-- without signing in, for the public registration link):
--   source              'oracle' (made in Oracle) or 'ogd' (first read from OGD)
--   ogd_key             OGD's id from the Manage Details link, or venue|start
--                       when the link has none; null for batches not on OGD
--   program_type, is_published, target_pax, ogd_area_name, ogd_url
--   synced_at           when it was last read from OGD
--
-- clp_ogd_details, one row per batch read from OGD, holds the people:
--   header          { "Supervising Unit Head": ..., "Chapter Head": ..., ... }
--   service_team    [{ role, name, gender, memberId }]
--   participants    [{ name, nickname, age, gender, memberId, attendance: [bool per session column] }]
--   session_columns the participants table's session headings ("Oct 17", ...)
--   sessions        [{ date, talk, speaker, pax }]
--   graduates       [{ memberId, name, gender, householdHead }]
--   statistics      { "SERVICE TEAM BROTHERS": 11, ... }
-- Signed-in accounts may read the details of batches in their Areas (the
-- same rule as clp_trainings' "View accessible CLP trainings"); only the
-- server writes them.
--
-- clp_syncs keeps each chapter's last CLP sync. Like activity_syncs, RLS is
-- enabled with NO policies and client roles have no grants: only the /api
-- functions read or write it.
--
-- Run once, after 2026112401_ogd_recordings.sql. Safe to re-run.
-- =========================================================================

ALTER TABLE "public"."clp_trainings"
    ADD COLUMN IF NOT EXISTS "source" "text" DEFAULT 'oracle' NOT NULL,
    ADD COLUMN IF NOT EXISTS "ogd_key" "text",
    ADD COLUMN IF NOT EXISTS "program_type" "text",
    ADD COLUMN IF NOT EXISTS "is_published" boolean,
    ADD COLUMN IF NOT EXISTS "target_pax" integer,
    ADD COLUMN IF NOT EXISTS "ogd_area_name" "text",
    ADD COLUMN IF NOT EXISTS "ogd_url" "text",
    ADD COLUMN IF NOT EXISTS "synced_at" timestamp with time zone;

DO $$ BEGIN
  ALTER TABLE "public"."clp_trainings"
    ADD CONSTRAINT "clp_trainings_source_check" CHECK ("source" = ANY (ARRAY['ogd'::"text", 'oracle'::"text"]));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "clp_trainings_area_ogd_key_idx" ON "public"."clp_trainings" ("area_id", "ogd_key");

CREATE TABLE IF NOT EXISTS "public"."clp_ogd_details" (
    "clp_training_id" bigint PRIMARY KEY REFERENCES "public"."clp_trainings"("id") ON DELETE CASCADE,
    "header" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "service_team" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "participants" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "session_columns" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "sessions" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "graduates" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "statistics" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "synced_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."clp_ogd_details" OWNER TO "postgres";
ALTER TABLE "public"."clp_ogd_details" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."clp_ogd_details" FROM "anon", "authenticated";
GRANT SELECT ON TABLE "public"."clp_ogd_details" TO "authenticated";
GRANT ALL ON TABLE "public"."clp_ogd_details" TO "service_role";

DROP POLICY IF EXISTS "View OGD details of accessible CLP trainings" ON "public"."clp_ogd_details";
CREATE POLICY "View OGD details of accessible CLP trainings" ON "public"."clp_ogd_details"
    FOR SELECT TO "authenticated"
    USING (EXISTS (
      SELECT 1 FROM "public"."clp_trainings" "t"
      WHERE "t"."id" = "clp_ogd_details"."clp_training_id"
        AND (
          "public"."is_admin"()
          OR NOT "public"."has_area_restriction"("auth"."uid"())
          OR "t"."area_id" IS NULL
          OR "t"."area_id" IN (SELECT "id" FROM "public"."visible_area_ids"("auth"."uid"()))
        )
    ));

CREATE TABLE IF NOT EXISTS "public"."clp_syncs" (
    "area_id" bigint PRIMARY KEY REFERENCES "public"."areas"("id") ON DELETE CASCADE,
    "status" "text" NOT NULL,
    "found" integer DEFAULT 0 NOT NULL,
    "is_partial" boolean DEFAULT false NOT NULL,
    "failure_code" "text",
    "status_detail" "text",
    "synced_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "synced_by" "uuid" REFERENCES "public"."profiles"("id") ON DELETE SET NULL,
    CONSTRAINT "clp_syncs_status_check" CHECK ("status" = ANY (ARRAY['synced'::"text", 'failed'::"text"]))
);

ALTER TABLE "public"."clp_syncs" OWNER TO "postgres";
ALTER TABLE "public"."clp_syncs" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."clp_syncs" FROM "anon", "authenticated";
GRANT ALL ON TABLE "public"."clp_syncs" TO "service_role";

-- Verify afterwards:
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'clp_trainings' AND column_name IN ('source', 'ogd_key', 'synced_at');
-- SELECT policyname FROM pg_policies WHERE tablename = 'clp_ogd_details';
