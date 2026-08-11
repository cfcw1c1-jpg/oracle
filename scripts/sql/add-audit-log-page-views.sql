-- =========================================================================
-- Run this if you already executed add-system-audit-log.sql once before
-- this fix. Safe to run multiple times.
--
-- Adds a PAGE_VIEW action so clicking a sidebar menu item shows up in the
-- System Audit Log too, alongside data inserts/updates/deletes. Page
-- views have no underlying table row or trigger to log them (it's a pure
-- client-side navigation event), so the app inserts these directly --
-- restricted to logging only as yourself, and only ever as PAGE_VIEW.
-- =========================================================================

ALTER TABLE "public"."audit_log" DROP CONSTRAINT IF EXISTS "audit_log_action_check";
ALTER TABLE "public"."audit_log"
    ADD CONSTRAINT "audit_log_action_check" CHECK (("action" = ANY (ARRAY['INSERT'::"text", 'UPDATE'::"text", 'DELETE'::"text", 'PAGE_VIEW'::"text"])));

DROP POLICY IF EXISTS "Users can log their own page views" ON "public"."audit_log";
CREATE POLICY "Users can log their own page views" ON "public"."audit_log"
FOR INSERT TO "authenticated"
WITH CHECK ("actor_id" = "auth"."uid"() AND "action" = 'PAGE_VIEW');
