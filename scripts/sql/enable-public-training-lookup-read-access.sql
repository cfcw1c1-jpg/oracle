-- Allows the public Training Records Lookup page (src/app/training-lookup.js,
-- served at /training-lookup — no login) to actually read member + training
-- data.
--
-- Row-Level Security is already enabled on these tables (confirmed live:
-- the anon/publishable key currently gets 0 rows back on all four, with no
-- error — the classic signature of RLS silently filtering rows rather than
-- the tables being empty) with existing policies presumably scoped to the
-- `authenticated` role for the internal admin app. This script ONLY ADDS a
-- new SELECT policy for the `anon` role — it does not touch, drop, or
-- replace any existing policy, so the logged-in admin app's insert/update/
-- delete flows are unaffected.
--
-- Heads up: this makes the full members table (names + demographic
-- fields), everyone's PFO training-completion record, and everyone's CLP
-- training/batch history readable by ANYONE with the anon key — not just
-- one name at a time through the search UI. Anyone with browser devtools
-- can already query these tables directly once this is applied. Only run
-- this if that level of public read exposure is actually intended.
--
-- How to run:
--   Supabase Dashboard -> your project -> SQL Editor -> New query
--   -> paste this file's contents -> Run.
--
-- Safe to re-run: ENABLE ROW LEVEL SECURITY is idempotent, and each policy
-- is dropped before being recreated (CREATE POLICY has no IF NOT EXISTS
-- form in Postgres).

ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pfo_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clp_trainings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clp_training_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read for training lookup" ON public.members;
CREATE POLICY "Public read for training lookup"
ON public.members FOR SELECT
TO anon
USING (true);

DROP POLICY IF EXISTS "Public read for training lookup" ON public.pfo_members;
CREATE POLICY "Public read for training lookup"
ON public.pfo_members FOR SELECT
TO anon
USING (true);

DROP POLICY IF EXISTS "Public read for training lookup" ON public.clp_trainings;
CREATE POLICY "Public read for training lookup"
ON public.clp_trainings FOR SELECT
TO anon
USING (true);

DROP POLICY IF EXISTS "Public read for training lookup" ON public.clp_training_participants;
CREATE POLICY "Public read for training lookup"
ON public.clp_training_participants FOR SELECT
TO anon
USING (true);

-- Verify afterwards:
-- SELECT policyname, tablename FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('members', 'pfo_members', 'clp_trainings', 'clp_training_participants')
-- ORDER BY tablename, policyname;
