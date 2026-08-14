-- =========================================================================
-- Training Lookup Logs, System Audit Log, and Member Change History have
-- moved from three separate top-level sidebar pages into tabs on one new
-- "Logs" page (src/screens/Logs.js) -- same pattern as
-- merge-roles-access-into-settings.sql / merge-areas-into-settings.sql.
-- The standalone 'auditLogs', 'systemAudit', and 'memberChangeHistory'
-- page keys no longer map to anything in the app.
--
-- This script:
--   1. Registers the new 'logs' page.
--   2. Grants 'logs' to every role that currently has ANY of the three old
--      page keys, so nobody silently loses access.
--   3. Removes the three old role_pages rows and pages rows, so they stop
--      appearing as dead, non-functional checkboxes on the Roles & Page
--      Access screen.
--
-- Run once. Safe to re-run.
-- =========================================================================

INSERT INTO "public"."pages" ("key", "label", "sort_order") VALUES
    ('logs', 'Logs', 12)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "public"."role_pages" ("role_id", "page_key")
SELECT DISTINCT "role_id", 'logs' FROM "public"."role_pages"
WHERE "page_key" IN ('auditLogs', 'systemAudit', 'memberChangeHistory')
ON CONFLICT DO NOTHING;

DELETE FROM "public"."role_pages" WHERE "page_key" IN ('auditLogs', 'systemAudit', 'memberChangeHistory');
DELETE FROM "public"."pages" WHERE "key" IN ('auditLogs', 'systemAudit', 'memberChangeHistory');

-- Verify afterwards:
-- SELECT * FROM public.pages WHERE key IN ('auditLogs', 'systemAudit', 'memberChangeHistory', 'logs');
-- SELECT r.name, rp.page_key FROM public.role_pages rp JOIN public.roles r ON r.id = rp.role_id WHERE rp.page_key = 'logs';
