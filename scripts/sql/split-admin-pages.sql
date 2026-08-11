-- =========================================================================
-- Run this ONLY IF you already executed add-admin-roles-and-areas.sql once
-- before the Administration screen was split into three separate pages
-- (Portal Users / Roles & Page Access / Areas) and the Admin role's page
-- grants were narrowed. Re-running the full original script would fail
-- ("relation ... already exists") because its tables/sequences/policies
-- were already created — this file only touches the seed data that
-- changed, and is safe to run more than once.
-- =========================================================================

-- Drop the old single "admin" page and the Admin role's old blanket grant.
DELETE FROM "public"."role_pages" WHERE "role_id" = (SELECT "id" FROM "public"."roles" WHERE "name" = 'Admin');
DELETE FROM "public"."pages" WHERE "key" = 'admin';

-- Register the three new solo admin pages.
INSERT INTO "public"."pages" ("key", "label", "sort_order") VALUES
    ('portalUsers', 'Portal Users', 8),
    ('rolesAccess', 'Roles & Page Access', 9),
    ('areas', 'Areas', 10)
ON CONFLICT ("key") DO NOTHING;

UPDATE "public"."roles"
SET "description" = 'Manages portal users, roles, page access, and the Area hierarchy. Grant data pages via other roles.'
WHERE "name" = 'Admin';

-- Admin now only sees the admin-only pages by default (Dashboard,
-- Directory, PFO Trainings/Reports, Formation Stats, CLP Maintenance are
-- no longer auto-granted — assign those to other roles as needed from the
-- Roles & Page Access screen).
INSERT INTO "public"."role_pages" ("role_id", "page_key")
SELECT (SELECT "id" FROM "public"."roles" WHERE "name" = 'Admin'), "key"
FROM "public"."pages"
WHERE "key" IN ('auditLogs', 'portalUsers', 'rolesAccess', 'areas')
ON CONFLICT DO NOTHING;
