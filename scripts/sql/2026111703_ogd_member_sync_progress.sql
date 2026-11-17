-- =========================================================================
-- OGD Member Sync, live progress: a running sync writes these every few
-- seconds so the OGD Accounts page can show a progress bar.
--
--   progress_stage  signing_in / reading / saving while a run is going,
--                   NULL once it finishes
--   progress_done   the chapter's members covered so far in this pass
--   progress_total  estimate: the chapter's members already in Oracle
--   progress_page   OGD list page being read
--   progress_at     when progress was last written
--
-- Run after 2026111702_ogd_member_sync_households.sql. Safe to re-run.
-- =========================================================================

ALTER TABLE "public"."ogd_member_syncs"
  ADD COLUMN IF NOT EXISTS "progress_stage" "text",
  ADD COLUMN IF NOT EXISTS "progress_done" integer,
  ADD COLUMN IF NOT EXISTS "progress_total" integer,
  ADD COLUMN IF NOT EXISTS "progress_page" integer,
  ADD COLUMN IF NOT EXISTS "progress_at" timestamp with time zone;

NOTIFY pgrst, 'reload schema';
