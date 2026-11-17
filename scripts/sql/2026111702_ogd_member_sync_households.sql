-- =========================================================================
-- OGD Member Sync, household heads: the sync now also reads each member's
-- present household head from their OGD Service tab, which takes a popup per
-- member, so a chapter is synced over several runs.
--
--   hh_next_page      list page the next run resumes household heads from
--                     (1 once a full pass finishes)
--   households_saved  household heads written by the latest run
--
-- Run after 2026111701_ogd_member_syncs.sql. Safe to re-run.
-- =========================================================================

ALTER TABLE "public"."ogd_member_syncs"
  ADD COLUMN IF NOT EXISTS "hh_next_page" integer DEFAULT 1 NOT NULL,
  ADD COLUMN IF NOT EXISTS "households_saved" integer DEFAULT 0 NOT NULL;

NOTIFY pgrst, 'reload schema';
