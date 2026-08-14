-- =========================================================================
-- Registers "Admin Dashboard" (src/screens/AdminDashboard.js): a page-view
-- usage chart across every page except Settings and Logs, sourced from the
-- existing audit_log PAGE_VIEW rows (no new tracking table).
--
-- Access is gated the normal way -- via role_pages, not a hardcoded role
-- check -- but only the Admin role is granted it here, matching "only for
-- admin" and the existing convention that nothing in this app auto-grants
-- itself to Admin; it's just the default seed, same as every other
-- Admin-only page (System Audit Log, Roles & Page Access, etc.).
--
-- No new RLS needed: "pages" is already readable by any authenticated
-- account, and audit_log SELECT already covers Admins (and Moderators, via
-- add-member-change-requests.sql) -- this page just reads both.
--
-- Run once. Safe to re-run.
-- =========================================================================

INSERT INTO "public"."pages" ("key", "label", "sort_order") VALUES
    ('adminDashboard', 'Admin Dashboard', 1)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "public"."role_pages" ("role_id", "page_key")
SELECT "id", 'adminDashboard' FROM "public"."roles" WHERE "name" = 'Admin'
ON CONFLICT DO NOTHING;
