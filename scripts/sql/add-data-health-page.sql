-- =========================================================================
-- Enables the new "Data Health Check" page (Areas -> Data Health): flags
-- Directory members whose AreaName doesn't prefix-match any real Area --
-- these are invisible to any area-restricted account and don't count
-- toward that Area's totals, so a typo here silently breaks scoping.
--
-- Registers the 'dataHealth' page and grants it to the Admin role, same
-- pattern as add-pfo-members-unique-and-import-page.sql. No new tables or
-- policies -- the page only reads "areas"/"members" (already readable) and
-- writes "members"."AreaName" via the same UPDATE policy Manage Members
-- already relies on (added in add-manage-members-page.sql).
--
-- Run once. Safe to re-run.
-- =========================================================================

INSERT INTO "public"."pages" ("key", "label", "sort_order") VALUES
    ('dataHealth', 'Data Health', 14)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "public"."role_pages" ("role_id", "page_key")
SELECT "id", 'dataHealth' FROM "public"."roles" WHERE "name" = 'Admin'
ON CONFLICT DO NOTHING;
