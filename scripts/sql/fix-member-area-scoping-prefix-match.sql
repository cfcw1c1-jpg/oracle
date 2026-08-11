-- =========================================================================
-- Run this if you already executed add-user-area-scoping.sql once before
-- this fix. Safe to run multiple times.
--
-- The "members" visibility policy originally matched "AreaName" exactly
-- against a visible Area's name. That's too strict: an Area named "West 1"
-- wouldn't cover a member whose AreaName is "West 1A" or "West 1 - Unit 3",
-- which is exactly what made every member disappear for any account that
-- had an Area assigned. This switches it to the same case-insensitive
-- PREFIX match already used for the "# Members" count on the Areas screen
-- — "AreaName" just needs to START WITH the Area's name.
-- =========================================================================

DROP POLICY IF EXISTS "Allow authenticated users to view members" ON "public"."members";
CREATE POLICY "Allow authenticated users to view members" ON "public"."members"
FOR SELECT TO "authenticated"
USING (
  "public"."is_admin"()
  OR NOT "public"."has_area_restriction"("auth"."uid"())
  OR EXISTS (
    SELECT 1 FROM "public"."visible_area_names"("auth"."uid"()) "van"
    WHERE "members"."AreaName" ILIKE "van"."name" || '%'
  )
);
