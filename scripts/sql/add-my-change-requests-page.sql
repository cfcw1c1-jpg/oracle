-- =========================================================================
-- Registers "My Change Requests": lets a submitter (any role that isn't
-- Admin/Moderator, i.e. anyone whose Directory edits get queued instead of
-- applied -- see MembersList.js's applyOrQueueChange) see the status of
-- their own submissions on member_change_requests.
--
-- No new RLS is needed -- "Requesters can view their own change requests"
-- (added by add-member-change-requests.sql) already covers this read; this
-- script only registers the page and grants it.
--
-- Run once, after add-member-change-requests.sql. Safe to re-run.
-- =========================================================================

INSERT INTO "public"."pages" ("key", "label", "sort_order") VALUES
    ('myChangeRequests', 'My Change Requests', 2)
ON CONFLICT ("key") DO NOTHING;

-- Granted to every role except Admin/Moderator, since those two apply
-- Directory edits directly and never have anything queued of their own to
-- track here. A role created later needs this granted by hand on the Roles
-- & Page Access screen, same as every other page in this app -- nothing
-- auto-grants.
INSERT INTO "public"."role_pages" ("role_id", "page_key")
SELECT "id", 'myChangeRequests' FROM "public"."roles" WHERE "name" NOT IN ('Admin', 'Moderator')
ON CONFLICT DO NOTHING;
