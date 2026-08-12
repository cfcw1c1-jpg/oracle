-- =========================================================================
-- CRITICAL FIX: the public Training Lookup and CLP Registration pages
-- (no login) currently work via BLANKET anon SELECT policies added in
-- enable-public-training-lookup-read-access.sql:
--
--     CREATE POLICY "Public read for training lookup"
--     ON public.members FOR SELECT TO anon USING (true);
--     -- (same for pfo_members, clp_training_participants)
--
-- That "USING (true)" doesn't just let the search box on those pages work
-- -- it lets ANYONE holding the anon/publishable key (which is embedded in
-- every page's JS bundle, not just these two pages) query the Supabase
-- REST API directly and pull the ENTIRE members table, every PFO
-- completion record, and everyone's CLP training history. The page's own
-- URL being unlisted provides no protection at all: the anon key isn't
-- scoped to any one page, and RLS has no concept of "only allow reads that
-- came through a search box."
--
-- This script:
--   1. Drops those blanket anon SELECT policies entirely.
--   2. Replaces the two public pages' data access with narrow
--      SECURITY DEFINER functions that require BOTH an exact Member ID
--      AND an exact Last Name match before returning anything -- a
--      stranger who only knows a common surname gets nothing back, and
--      there is no way to browse/enumerate the roster through these
--      functions (each call returns at most one member's own data).
--   3. Leaves clp_trainings' anon SELECT alone -- it holds no personal
--      data (just batch venue/dates), and clp-registration.js's own
--      self-enrollment INSERT policy alone (unaffected by this script).
--
-- Run once, after enable-public-training-lookup-read-access.sql already
-- ran. Safe to re-run.
-- =========================================================================

-- ---------- 1. Remove the blanket anon reads ----------
DROP POLICY IF EXISTS "Public read for training lookup" ON public.members;
DROP POLICY IF EXISTS "Public read for training lookup" ON public.pfo_members;
DROP POLICY IF EXISTS "Public read for training lookup" ON public.clp_training_participants;

-- ---------- 2. Narrow identity check (clp-registration.js) ----------
-- Confirms a member's identity for self-registration -- returns a row
-- only when BOTH the Member ID and Last Name match exactly.
CREATE OR REPLACE FUNCTION public.find_member_by_id_and_lastname(p_member_id "text", p_lastname "text")
RETURNS TABLE("MemberIDNo" "text", "Firstname" "text", "Lastname" "text")
LANGUAGE "sql"
SECURITY DEFINER
SET "search_path" = 'public'
STABLE
AS $$
  SELECT m."MemberIDNo", m."Firstname", m."Lastname"
  FROM public.members m
  WHERE m."MemberIDNo" = trim(p_member_id)
    AND lower(trim(m."Lastname")) = lower(trim(p_lastname))
  LIMIT 1;
$$;

ALTER FUNCTION public.find_member_by_id_and_lastname("text", "text") OWNER TO "postgres";
GRANT EXECUTE ON FUNCTION public.find_member_by_id_and_lastname("text", "text") TO "anon";
GRANT EXECUTE ON FUNCTION public.find_member_by_id_and_lastname("text", "text") TO "authenticated";

-- ---------- 3. Already-registered check (clp-registration.js) ----------
CREATE OR REPLACE FUNCTION public.check_clp_registration(p_training_id bigint, p_member_id "text")
RETURNS boolean
LANGUAGE "sql"
SECURITY DEFINER
SET "search_path" = 'public'
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clp_training_participants
    WHERE "clp_training_id" = p_training_id AND "MemberIDNo" = trim(p_member_id)
  );
$$;

ALTER FUNCTION public.check_clp_registration(bigint, "text") OWNER TO "postgres";
GRANT EXECUTE ON FUNCTION public.check_clp_registration(bigint, "text") TO "anon";
GRANT EXECUTE ON FUNCTION public.check_clp_registration(bigint, "text") TO "authenticated";

-- ---------- 4. Full self-lookup (training-lookup.js) ----------
-- Same identity match as above, but returns the member's own PFO
-- completion row and CLP participation history as JSON -- pfo_members has
-- ~115 dynamically-named columns, so to_jsonb() carries them through
-- without hand-listing every one here.
CREATE OR REPLACE FUNCTION public.lookup_own_training_record(p_member_id "text", p_lastname "text")
RETURNS "jsonb"
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" = 'public'
AS $$
DECLARE
  v_member public.members%ROWTYPE;
  v_pfo public.pfo_members%ROWTYPE;
  v_clp jsonb;
BEGIN
  SELECT * INTO v_member
  FROM public.members
  WHERE "MemberIDNo" = trim(p_member_id)
    AND lower(trim("Lastname")) = lower(trim(p_lastname))
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_pfo FROM public.pfo_members WHERE "MemberIDNo" = v_member."MemberIDNo";

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', "ctp"."id",
    'type', "ctp"."type",
    'sub_type', "ctp"."sub_type",
    'venue', "ct"."venue",
    'start_date', "ct"."start_date",
    'end_date', "ct"."end_date"
  )), '[]'::jsonb)
  INTO v_clp
  FROM public.clp_training_participants "ctp"
  JOIN public.clp_trainings "ct" ON "ct"."id" = "ctp"."clp_training_id"
  WHERE "ctp"."MemberIDNo" = v_member."MemberIDNo";

  RETURN jsonb_build_object(
    'MemberIDNo', v_member."MemberIDNo",
    'Firstname', v_member."Firstname",
    'Lastname', v_member."Lastname",
    'pfo', to_jsonb(v_pfo),
    'clp', v_clp
  );
END;
$$;

ALTER FUNCTION public.lookup_own_training_record("text", "text") OWNER TO "postgres";
GRANT EXECUTE ON FUNCTION public.lookup_own_training_record("text", "text") TO "anon";
GRANT EXECUTE ON FUNCTION public.lookup_own_training_record("text", "text") TO "authenticated";

-- Verify afterwards (should now return NO anon SELECT rows for these three):
-- SELECT policyname, tablename, roles FROM pg_policies
-- WHERE schemaname = 'public' AND tablename IN ('members', 'pfo_members', 'clp_training_participants')
-- ORDER BY tablename;
