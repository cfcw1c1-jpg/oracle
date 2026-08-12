-- =========================================================================
-- Data Health has moved from its own top-level sidebar page into a tab on
-- the Settings page (src/screens/Settings.js), so the standalone
-- 'dataHealth' page key no longer maps to anything in the app.
--
-- This script:
--   1. Grants 'settings' to every role that currently has 'dataHealth', so
--      nobody silently loses access to the Data Health feature -- it's now
--      reached via the Settings page instead.
--   2. Removes the 'dataHealth' role_pages rows and the 'dataHealth' pages
--      row, so it stops appearing as a dead, non-functional checkbox on
--      the Roles & Page Access screen.
--
-- Run once. Safe to re-run.
-- =========================================================================

INSERT INTO "public"."role_pages" ("role_id", "page_key")
SELECT "role_id", 'settings' FROM "public"."role_pages" WHERE "page_key" = 'dataHealth'
ON CONFLICT DO NOTHING;

DELETE FROM "public"."role_pages" WHERE "page_key" = 'dataHealth';
DELETE FROM "public"."pages" WHERE "key" = 'dataHealth';

-- Verify afterwards:
-- SELECT * FROM public.pages WHERE key IN ('dataHealth', 'settings');
-- SELECT r.name, rp.page_key FROM public.role_pages rp JOIN public.roles r ON r.id = rp.role_id WHERE rp.page_key = 'settings';
