-- =========================================================================
-- Reports page (memberReports): reports worked out from Oracle's own data,
-- starting with Member Birthdays (members."Birthday" for a chosen month).
-- No new tables; members' row-level security already limits what each
-- account sees.
--
-- Registers the page for Admin, MSG and Chapter Head. Other roles can be
-- granted it from Settings > Roles & Page Access.
--
-- The older OGD celebrants page (key 'reports', hidden in the web app) is
-- relabelled 'OGD Celebrants' so the two aren't confused in Settings.
--
-- Safe to re-run.
-- =========================================================================

INSERT INTO "public"."pages" ("key", "label", "sort_order") VALUES
    ('memberReports', 'Reports', 25)
ON CONFLICT ("key") DO NOTHING;

UPDATE "public"."pages" SET "label" = 'OGD Celebrants' WHERE "key" = 'reports' AND "label" = 'Reports';

INSERT INTO "public"."role_pages" ("role_id", "page_key")
SELECT "id", 'memberReports' FROM "public"."roles" WHERE "name" IN ('Admin', 'MSG', 'Chapter Head')
ON CONFLICT DO NOTHING;

-- Verify afterwards:
-- SELECT r.name, rp.page_key FROM public.role_pages rp JOIN public.roles r ON r.id = rp.role_id WHERE rp.page_key = 'memberReports';

