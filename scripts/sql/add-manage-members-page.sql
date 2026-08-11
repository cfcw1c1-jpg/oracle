-- =========================================================================
-- Enables the new "Manage Members" page: a full CRUD member directory (no
-- Area filtering, unlike the regular Directory), letting a portal user add,
-- edit, or delete members directly.
--   1. Registers the 'manageMembers' page and grants it to the Admin role,
--      same pattern as add-pfo-members-unique-and-import-page.sql.
--   2. Ensures authenticated users can INSERT/UPDATE/DELETE on "members".
--      An UPDATE policy on this table already predates this project's
--      scripts (the Directory's Gender/Role/Status editors already work),
--      but nothing in these incremental scripts has added INSERT/DELETE
--      policies before, so both are added explicitly here rather than
--      assumed. Redundant with any pre-existing UPDATE policy is harmless
--      -- permissive RLS policies simply OR together.
--
-- Run once. Safe to re-run.
-- =========================================================================

INSERT INTO "public"."pages" ("key", "label", "sort_order") VALUES
    ('manageMembers', 'Manage Members', 13)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "public"."role_pages" ("role_id", "page_key")
SELECT "id", 'manageMembers' FROM "public"."roles" WHERE "name" = 'Admin'
ON CONFLICT DO NOTHING;

DROP POLICY IF EXISTS "Authenticated can insert members" ON "public"."members";
CREATE POLICY "Authenticated can insert members" ON "public"."members"
FOR INSERT TO "authenticated"
WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated can update members" ON "public"."members";
CREATE POLICY "Authenticated can update members" ON "public"."members"
FOR UPDATE TO "authenticated"
USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated can delete members" ON "public"."members";
CREATE POLICY "Authenticated can delete members" ON "public"."members"
FOR DELETE TO "authenticated"
USING (true);

DROP POLICY IF EXISTS "Authenticated can delete pfo_members" ON "public"."pfo_members";
CREATE POLICY "Authenticated can delete pfo_members" ON "public"."pfo_members"
FOR DELETE TO "authenticated"
USING (true);
