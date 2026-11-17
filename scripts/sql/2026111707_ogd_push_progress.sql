-- =========================================================================
-- OGD push progress: one row per Chapter while a Push to OGD run is working
-- (api/_lib/tasks/push-changes.mjs), so the OGD Accounts page can show a
-- percentage and the time left. The run removes its row when it ends.
--
--   members_total  members with queued changes when this run started
--   members_done   of those, members this run has pushed so far
--   list_total     the chapter's members (Oracle's count; OGD's list does not
--                  say how many it holds until the last page)
--   list_done      chapter members this run has paged past in OGD's list
--
-- RLS is enabled with NO policies, matching the other ogd_* tables. Only the
-- /api/ogd functions read or write it. Safe to re-run.
-- =========================================================================

CREATE TABLE IF NOT EXISTS "public"."ogd_push_progress" (
    "area_id" bigint PRIMARY KEY REFERENCES "public"."areas"("id") ON DELETE CASCADE,
    "stage" "text" NOT NULL,
    "members_total" integer DEFAULT 0 NOT NULL,
    "members_done" integer DEFAULT 0 NOT NULL,
    "list_total" integer DEFAULT 0 NOT NULL,
    "list_done" integer DEFAULT 0 NOT NULL,
    "page" integer,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ogd_push_progress_stage_check"
      CHECK ("stage" = ANY (ARRAY['signing_in'::"text", 'skipping'::"text", 'pushing'::"text", 'saving'::"text"]))
);

ALTER TABLE "public"."ogd_push_progress" OWNER TO "postgres";
ALTER TABLE "public"."ogd_push_progress" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."ogd_push_progress" FROM "anon", "authenticated";
GRANT ALL ON TABLE "public"."ogd_push_progress" TO "service_role";

NOTIFY pgrst, 'reload schema';
