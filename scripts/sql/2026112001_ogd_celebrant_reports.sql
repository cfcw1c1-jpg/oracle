-- =========================================================================
-- Reports: Birthday and Wedding Anniversary celebrants generated from OGD.
-- One row per Chapter, month (1-12) and kind, holding the list as OGD showed
-- it the last time it was generated. OGD's column headings are kept as-is in
-- "headers" and each row's cells in "records".
--
-- RLS is enabled with NO policies and client roles have no grants, matching
-- ogd_monthly_reports. Only the /api/ogd functions read or write it.
--
-- Also registers the "Reports" page for Admin, MSG and Chapter Head.
--
-- Run once, after 2026110901_monthly_pastoral_reports.sql. Safe to re-run.
-- =========================================================================

CREATE TABLE IF NOT EXISTS "public"."ogd_celebrant_reports" (
    "area_id" bigint NOT NULL REFERENCES "public"."areas"("id") ON DELETE CASCADE,
    "celebration_month" smallint NOT NULL,
    "kind" "text" NOT NULL,
    "status" "text" NOT NULL,
    "headers" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "records" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "failure_code" "text",
    "status_detail" "text",
    "generated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "generated_by" "uuid" REFERENCES "public"."profiles"("id") ON DELETE SET NULL,
    PRIMARY KEY ("area_id", "celebration_month", "kind"),
    CONSTRAINT "ogd_celebrant_reports_month_check" CHECK ("celebration_month" BETWEEN 1 AND 12),
    CONSTRAINT "ogd_celebrant_reports_kind_check"
      CHECK ("kind" = ANY (ARRAY['birthday'::"text", 'anniversary'::"text"])),
    CONSTRAINT "ogd_celebrant_reports_status_check"
      CHECK ("status" = ANY (ARRAY['generated'::"text", 'failed'::"text"]))
);

ALTER TABLE "public"."ogd_celebrant_reports" OWNER TO "postgres";
ALTER TABLE "public"."ogd_celebrant_reports" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."ogd_celebrant_reports" FROM "anon", "authenticated";
GRANT ALL ON TABLE "public"."ogd_celebrant_reports" TO "service_role";


-- ---------- Page registration ----------
INSERT INTO "public"."pages" ("key", "label", "sort_order") VALUES
    ('reports', 'Reports', 23)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "public"."role_pages" ("role_id", "page_key")
SELECT "id", 'reports' FROM "public"."roles" WHERE "name" IN ('Admin', 'MSG', 'Chapter Head')
ON CONFLICT DO NOTHING;

-- Verify afterwards:
-- SELECT r.name, rp.page_key FROM public.role_pages rp JOIN public.roles r ON r.id = rp.role_id WHERE rp.page_key = 'reports';
