-- =========================================================================
-- Background syncs: Sync Members and Sync Formations keep running on the
-- server after the page is closed. Each stretch starts the next one itself
-- until the sync is done, fails for good, or is stopped.
--
--   bg_state       'running' while a background sync is under way,
--                  'stopping' once Stop was pressed (it ends after the
--                  current stretch), null when none is running
--   bg_part        'info' or 'formations'
--   bg_started_by  who started it
--   bg_run         how many stretches it has started
--   bg_retries     failed stretches in a row that were tried again
--   bg_started_at  when it was started
--
-- ogd_member_syncs already has RLS with no policies and no client grants.
--
-- Run once, after 2026112002_ogd_saved_sessions.sql. Safe to re-run.
-- =========================================================================

ALTER TABLE "public"."ogd_member_syncs"
    ADD COLUMN IF NOT EXISTS "bg_state" "text",
    ADD COLUMN IF NOT EXISTS "bg_part" "text",
    ADD COLUMN IF NOT EXISTS "bg_started_by" "uuid" REFERENCES "public"."profiles"("id") ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS "bg_run" integer DEFAULT 0 NOT NULL,
    ADD COLUMN IF NOT EXISTS "bg_retries" integer DEFAULT 0 NOT NULL,
    ADD COLUMN IF NOT EXISTS "bg_started_at" timestamp with time zone;

ALTER TABLE "public"."ogd_member_syncs" DROP CONSTRAINT IF EXISTS "ogd_member_syncs_bg_state_check";
ALTER TABLE "public"."ogd_member_syncs" ADD CONSTRAINT "ogd_member_syncs_bg_state_check"
    CHECK ("bg_state" IS NULL OR "bg_state" = ANY (ARRAY['running'::"text", 'stopping'::"text"]));
