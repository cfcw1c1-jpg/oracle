-- =========================================================================
-- Monthly Pastoral Reports: one row per Chapter per month recording whether
-- OGD lists that month's Pastoral Report, as found by the most recent check.
--
-- RLS is enabled with NO policies and client roles have no grants, matching
-- ogd_chapter_connections. Only the /api/ogd functions read or write it.
--
-- Also relabels the two OGD pages. Both appear as one "OGD Accounts" menu
-- item, so their labels here tell them apart on Roles & Page Access.
--
-- Run once, after 2026110801_ogd_chapter_connections.sql. Safe to re-run.
-- =========================================================================

CREATE TABLE IF NOT EXISTS "public"."ogd_monthly_reports" (
    "area_id" bigint NOT NULL REFERENCES "public"."areas"("id") ON DELETE CASCADE,
    "report_month" date NOT NULL,
    "status" "text" NOT NULL,
    "latest_month_year" "text",
    "failure_code" "text",
    "status_detail" "text",
    "checked_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "checked_by" "uuid" REFERENCES "public"."profiles"("id") ON DELETE SET NULL,
    PRIMARY KEY ("area_id", "report_month"),
    CONSTRAINT "ogd_monthly_reports_status_check"
      CHECK ("status" = ANY (ARRAY['generated'::"text", 'not_generated'::"text", 'failed'::"text"]))
);

ALTER TABLE "public"."ogd_monthly_reports" OWNER TO "postgres";
ALTER TABLE "public"."ogd_monthly_reports" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."ogd_monthly_reports" FROM "anon", "authenticated";
GRANT ALL ON TABLE "public"."ogd_monthly_reports" TO "service_role";


-- ---------- Page labels + registration ----------
UPDATE "public"."pages" SET "label" = 'OGD Accounts (OGD Login)' WHERE "key" = 'ogdAccounts';
UPDATE "public"."pages" SET "label" = 'OGD Accounts (Gmail)' WHERE "key" = 'ogdChapters';

INSERT INTO "public"."pages" ("key", "label", "sort_order") VALUES
    ('monthlyPastoralReports', 'Monthly Pastoral Reports', 22)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "public"."role_pages" ("role_id", "page_key")
SELECT "id", 'monthlyPastoralReports' FROM "public"."roles" WHERE "name" IN ('Admin', 'Sector Head', 'Sector MSG')
ON CONFLICT DO NOTHING;

-- Verify afterwards:
-- SELECT r.name, rp.page_key FROM public.role_pages rp JOIN public.roles r ON r.id = rp.role_id WHERE rp.page_key = 'monthlyPastoralReports';
