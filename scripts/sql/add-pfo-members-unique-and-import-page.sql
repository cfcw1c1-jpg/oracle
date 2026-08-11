-- =========================================================================
-- Enables the new "Import CSV" admin page:
--   1. Adds a UNIQUE constraint on pfo_members."MemberIDNo" so the app can
--      upsert (insert-or-update) by MemberIDNo instead of blindly
--      inserting duplicate rows every time a chapter's CSV gets re-imported.
--   2. Registers the 'csvImport' page and grants it to the Admin role,
--      same pattern as add-admin-roles-and-areas.sql.
--
-- Run once. Safe to re-run.
-- =========================================================================

-- If this fails with something like "could not create unique index ...
-- Key (MemberIDNo)=(...) is duplicated", it means pfo_members already has
-- more than one row for the same member (possible since nothing enforced
-- uniqueness before now). Find them first with:
--
--   SELECT "MemberIDNo", count(*) FROM public.pfo_members
--   GROUP BY "MemberIDNo" HAVING count(*) > 1;
--
-- then decide which duplicate row(s) to delete before re-running this file.
DO $$
BEGIN
  ALTER TABLE "public"."pfo_members" ADD CONSTRAINT "pfo_members_MemberIDNo_key" UNIQUE ("MemberIDNo");
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

INSERT INTO "public"."pages" ("key", "label", "sort_order") VALUES
    ('csvImport', 'Import CSV', 11)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "public"."role_pages" ("role_id", "page_key")
SELECT "id", 'csvImport' FROM "public"."roles" WHERE "name" = 'Admin'
ON CONFLICT DO NOTHING;
