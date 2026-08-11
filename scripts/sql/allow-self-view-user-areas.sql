-- =========================================================================
-- Run this if you already executed add-user-area-scoping.sql once before
-- this fix. Safe to run multiple times.
--
-- user_areas only had an Admins-only policy, so a non-admin account could
-- never read its OWN area assignment rows either -- any client query like
-- "what areas am I assigned to" (e.g. the Directory's Area filter) came
-- back empty for that account, not because it had no areas assigned, but
-- because RLS blocked seeing them at all. This adds a SELECT policy
-- letting a signed-in account read its own rows.
-- =========================================================================

DROP POLICY IF EXISTS "Users can view own area assignments" ON "public"."user_areas";
CREATE POLICY "Users can view own area assignments" ON "public"."user_areas" FOR SELECT TO "authenticated" USING ("profile_id" = "auth"."uid"());
