-- =========================================================================
-- Run this if you already executed add-user-area-scoping.sql once before
-- this fix. Safe to run multiple times.
--
-- Closes the gap flagged when area-scoping first shipped: pfo_members
-- itself was never RLS-restricted, only members was. A scoped account
-- could still pull pfo_members rows for out-of-area MemberIDNos (just with
-- a blank name, since the joined "members" row was hidden). This adds the
-- same has_area_restriction() / visible_area_names() prefix-match rule,
-- joined through the member's own AreaName, so the PFO Trainings grid
-- (and PFO Reports / Formation Stats, which query the same table) only
-- show rows within a scoped account's visible areas.
-- =========================================================================

DROP POLICY IF EXISTS "Allow authenticated users to view PFO records" ON "public"."pfo_members";
CREATE POLICY "Allow authenticated users to view PFO records" ON "public"."pfo_members"
FOR SELECT TO "authenticated"
USING (
  "public"."is_admin"()
  OR NOT "public"."has_area_restriction"("auth"."uid"())
  OR EXISTS (
    SELECT 1 FROM "public"."members" "m"
    WHERE "m"."MemberIDNo" = "pfo_members"."MemberIDNo"
      AND EXISTS (
        SELECT 1 FROM "public"."visible_area_names"("auth"."uid"()) "van"
        WHERE "m"."AreaName" ILIKE "van"."name" || '%'
      )
  )
);
