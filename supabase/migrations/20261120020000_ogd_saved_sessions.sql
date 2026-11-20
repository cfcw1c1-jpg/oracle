-- =========================================================================
-- Saved OGD sessions: after a chapter signs in to OGD, its browser cookies are
-- kept (AES-256-GCM encrypted, like the passwords) so the next OGD action can
-- skip the login and the emailed OTP while OGD still accepts the session.
--
-- ogd_session_reuse_off_until: set when OGD rejects a session that should
-- still have been valid. Until then runs sign in fresh and log out at the
-- end, as they did before sessions were saved.
--
-- ogd_chapter_connections already has RLS with no policies and no client
-- grants, so these columns are only read by the /api/ogd functions.
--
-- Run once, after 2026112001_ogd_celebrant_reports.sql. Safe to re-run.
-- =========================================================================

ALTER TABLE "public"."ogd_chapter_connections"
    ADD COLUMN IF NOT EXISTS "ogd_session_enc" "text",
    ADD COLUMN IF NOT EXISTS "ogd_session_saved_at" timestamp with time zone,
    ADD COLUMN IF NOT EXISTS "ogd_session_reuse_off_until" timestamp with time zone;
