-- =========================================================================
-- CLP Training Maintenance, per Area.
--
-- Each clp_trainings batch now belongs to exactly one Area (area_id).
-- A scoped account (Portal Users -> Areas) only sees/manages batches (and
-- their participants) within its own assigned area(s) or those areas'
-- descendants; a batch with no area (area_id IS NULL, e.g. pre-existing
-- rows from before this migration) stays visible to everyone. Unrestricted
-- accounts (no areas assigned) and Admins are unaffected, same as
-- everywhere else area-scoping has been applied.
--
-- The public self-registration / training-lookup pages are untouched --
-- those run as "anon" and already have their own separate policies scoped
-- by public_token, not by area.
--
-- Run once. Safe to re-run.
-- =========================================================================

ALTER TABLE "public"."clp_trainings" ADD COLUMN IF NOT EXISTS "area_id" bigint;

DO $$
BEGIN
  ALTER TABLE "public"."clp_trainings"
    ADD CONSTRAINT "clp_trainings_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

CREATE INDEX IF NOT EXISTS "idx_clp_trainings_area" ON "public"."clp_trainings" USING "btree" ("area_id");


-- ---------- Helpers ----------

-- Every area id a user can see: their directly assigned areas, plus every
-- area nested underneath each one. Same shape as visible_area_names() in
-- add-user-area-scoping.sql, but returning ids since clp_trainings.area_id
-- is a real foreign key (no free-text prefix matching needed here).
CREATE OR REPLACE FUNCTION "public"."visible_area_ids"("uid" "uuid")
RETURNS TABLE("id" bigint)
LANGUAGE "sql"
SECURITY DEFINER
SET "search_path" = 'public'
STABLE
AS $$
  WITH RECURSIVE assigned AS (
    SELECT a.id
    FROM public.user_areas ua
    JOIN public.areas a ON a.id = ua.area_id
    WHERE ua.profile_id = uid
  ),
  tree AS (
    SELECT id FROM assigned
    UNION
    SELECT ar.id
    FROM public.areas ar
    JOIN tree t ON ar.parent_id = t.id
  )
  SELECT DISTINCT id FROM tree;
$$;

ALTER FUNCTION "public"."visible_area_ids"("uuid") OWNER TO "postgres";

-- Whether a user can see/manage a specific CLP training batch (used by
-- clp_training_participants policies below, since a participant row's own
-- visibility follows its parent training's).
CREATE OR REPLACE FUNCTION "public"."can_access_clp_training"("uid" "uuid", "training_id" bigint)
RETURNS boolean
LANGUAGE "sql"
SECURITY DEFINER
SET "search_path" = 'public'
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clp_trainings t
    WHERE t.id = training_id
      AND (
        public.is_admin()
        OR NOT public.has_area_restriction(uid)
        OR t.area_id IS NULL
        OR t.area_id IN (SELECT id FROM public.visible_area_ids(uid))
      )
  );
$$;

ALTER FUNCTION "public"."can_access_clp_training"("uuid", bigint) OWNER TO "postgres";


-- ---------- Restrict clp_trainings by Area ----------
DROP POLICY IF EXISTS "Allow authenticated CRUD on clp_trainings" ON "public"."clp_trainings";
DROP POLICY IF EXISTS "View accessible CLP trainings" ON "public"."clp_trainings";
DROP POLICY IF EXISTS "Insert CLP trainings within scope" ON "public"."clp_trainings";
DROP POLICY IF EXISTS "Update CLP trainings within scope" ON "public"."clp_trainings";
DROP POLICY IF EXISTS "Delete CLP trainings within scope" ON "public"."clp_trainings";

CREATE POLICY "View accessible CLP trainings" ON "public"."clp_trainings"
FOR SELECT TO "authenticated"
USING (
  "public"."is_admin"()
  OR NOT "public"."has_area_restriction"("auth"."uid"())
  OR "area_id" IS NULL
  OR "area_id" IN (SELECT "id" FROM "public"."visible_area_ids"("auth"."uid"()))
);

-- A restricted (area-scoped) account must always pick one of its own
-- visible areas -- it can't leave area_id blank, which would otherwise
-- make the batch globally visible to every other scoped account too.
CREATE POLICY "Insert CLP trainings within scope" ON "public"."clp_trainings"
FOR INSERT TO "authenticated"
WITH CHECK (
  "public"."is_admin"()
  OR NOT "public"."has_area_restriction"("auth"."uid"())
  OR "area_id" IN (SELECT "id" FROM "public"."visible_area_ids"("auth"."uid"()))
);

CREATE POLICY "Update CLP trainings within scope" ON "public"."clp_trainings"
FOR UPDATE TO "authenticated"
USING (
  "public"."is_admin"()
  OR NOT "public"."has_area_restriction"("auth"."uid"())
  OR "area_id" IS NULL
  OR "area_id" IN (SELECT "id" FROM "public"."visible_area_ids"("auth"."uid"()))
)
WITH CHECK (
  "public"."is_admin"()
  OR NOT "public"."has_area_restriction"("auth"."uid"())
  OR "area_id" IN (SELECT "id" FROM "public"."visible_area_ids"("auth"."uid"()))
);

CREATE POLICY "Delete CLP trainings within scope" ON "public"."clp_trainings"
FOR DELETE TO "authenticated"
USING (
  "public"."is_admin"()
  OR NOT "public"."has_area_restriction"("auth"."uid"())
  OR "area_id" IS NULL
  OR "area_id" IN (SELECT "id" FROM "public"."visible_area_ids"("auth"."uid"()))
);


-- ---------- Restrict clp_training_participants to match their training ----------
-- (The "Public read for training lookup" / "Public self-registration for
-- CLP training" policies for the "anon" role are untouched -- separate
-- role, separate policies, unaffected by this.)
DROP POLICY IF EXISTS "Allow authenticated CRUD on clp_training_participants" ON "public"."clp_training_participants";
DROP POLICY IF EXISTS "View accessible CLP participants" ON "public"."clp_training_participants";
DROP POLICY IF EXISTS "Insert CLP participants within scope" ON "public"."clp_training_participants";
DROP POLICY IF EXISTS "Update CLP participants within scope" ON "public"."clp_training_participants";
DROP POLICY IF EXISTS "Delete CLP participants within scope" ON "public"."clp_training_participants";

CREATE POLICY "View accessible CLP participants" ON "public"."clp_training_participants"
FOR SELECT TO "authenticated"
USING ("public"."can_access_clp_training"("auth"."uid"(), "clp_training_id"));

CREATE POLICY "Insert CLP participants within scope" ON "public"."clp_training_participants"
FOR INSERT TO "authenticated"
WITH CHECK ("public"."can_access_clp_training"("auth"."uid"(), "clp_training_id"));

CREATE POLICY "Update CLP participants within scope" ON "public"."clp_training_participants"
FOR UPDATE TO "authenticated"
USING ("public"."can_access_clp_training"("auth"."uid"(), "clp_training_id"))
WITH CHECK ("public"."can_access_clp_training"("auth"."uid"(), "clp_training_id"));

CREATE POLICY "Delete CLP participants within scope" ON "public"."clp_training_participants"
FOR DELETE TO "authenticated"
USING ("public"."can_access_clp_training"("auth"."uid"(), "clp_training_id"));
