-- =========================================================================
-- OGD Member Sync in two parts: Part 1 (info) copies the members list and
-- household heads, Part 2 (formations) copies each member's formation talks
-- into pfo_members. Each part may take several runs.
--
--   sync_part         part the next run works on: info or formations
--   fm_next_page      list page Part 2 resumes from (hh_next_page is Part 1's)
--   formations_saved  members whose formations the latest Part 2 run wrote
--   progress_part     part the running sync is on, for the progress bar
--
-- Run after 2026111703_ogd_member_sync_progress.sql. Safe to re-run.
-- =========================================================================

ALTER TABLE "public"."ogd_member_syncs"
  ADD COLUMN IF NOT EXISTS "sync_part" "text" DEFAULT 'info' NOT NULL,
  ADD COLUMN IF NOT EXISTS "fm_next_page" integer DEFAULT 1 NOT NULL,
  ADD COLUMN IF NOT EXISTS "formations_saved" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "progress_part" "text";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ogd_member_syncs_sync_part_check') THEN
    ALTER TABLE "public"."ogd_member_syncs"
      ADD CONSTRAINT "ogd_member_syncs_sync_part_check" CHECK ("sync_part" = ANY (ARRAY['info'::"text", 'formations'::"text"]));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
