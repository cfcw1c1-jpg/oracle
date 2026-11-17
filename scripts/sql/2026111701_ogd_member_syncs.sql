-- =========================================================================
-- OGD Member Sync: one row per Chapter recording the latest copy of its OGD
-- Members Database list into public.members (api/ogd/sync-members.mjs).
--
--   status        synced (every page read), partial (stopped early; what was
--                 read is saved), failed (nothing saved)
--   members_saved members upserted by the latest sync
--
-- RLS is enabled with NO policies and client roles have no grants, matching
-- the other ogd_* tables. Only the /api/ogd functions read or write it.
--
-- Needs scripts/sql/add-member-contact-columns.sql. Safe to re-run.
-- =========================================================================

CREATE TABLE IF NOT EXISTS "public"."ogd_member_syncs" (
    "area_id" bigint PRIMARY KEY REFERENCES "public"."areas"("id") ON DELETE CASCADE,
    "status" "text" NOT NULL,
    "members_saved" integer DEFAULT 0 NOT NULL,
    "pages_read" integer DEFAULT 0 NOT NULL,
    "failure_code" "text",
    "status_detail" "text",
    "synced_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "synced_by" "uuid" REFERENCES "public"."profiles"("id") ON DELETE SET NULL,
    CONSTRAINT "ogd_member_syncs_status_check"
      CHECK ("status" = ANY (ARRAY['synced'::"text", 'partial'::"text", 'failed'::"text"]))
);

ALTER TABLE "public"."ogd_member_syncs" OWNER TO "postgres";
ALTER TABLE "public"."ogd_member_syncs" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."ogd_member_syncs" FROM "anon", "authenticated";
GRANT ALL ON TABLE "public"."ogd_member_syncs" TO "service_role";

NOTIFY pgrst, 'reload schema';
