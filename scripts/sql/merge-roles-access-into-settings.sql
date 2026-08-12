-- =========================================================================
-- Roles & Page Access has moved from its own top-level sidebar page into a
-- tab on the Settings page (src/screens/Settings.js), so the standalone
-- 'rolesAccess' page key no longer maps to anything in the app.
--
-- This script:
--   1. Grants 'settings' to every role that currently has 'rolesAccess', so
--      nobody silently loses access to the Roles & Page Access feature --
--      it's now reached via the Settings page instead.
--   2. Removes the 'rolesAccess' role_pages rows and the 'rolesAccess'
--      pages row, so it stops appearing as a dead, non-functional checkbox
--      on the Roles & Page Access screen itself.
--
-- Run once. Safe to re-run.
-- =========================================================================

INSERT INTO "public"."role_pages" ("role_id", "page_key")
SELECT "role_id", 'settings' FROM "public"."role_pages" WHERE "page_key" = 'rolesAccess'
ON CONFLICT DO NOTHING;

DELETE FROM "public"."role_pages" WHERE "page_key" = 'rolesAccess';
DELETE FROM "public"."pages" WHERE "key" = 'rolesAccess';

-- Verify afterwards:
-- SELECT * FROM public.pages WHERE key IN ('rolesAccess', 'settings');
-- SELECT r.name, rp.page_key FROM public.role_pages rp JOIN public.roles r ON r.id = rp.role_id WHERE rp.page_key = 'settings';
