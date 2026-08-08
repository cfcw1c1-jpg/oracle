-- Allows the public CLP Training Registration page
-- (src/app/clp-registration.js, served at /clp-registration — no login) to
-- let a member self-register into an existing CLP training batch with a
-- role (Participant, or Service Team + sub-role).
--
-- RLS is already enabled on clp_training_participants (see
-- enable-public-training-lookup-read-access.sql, which added a public
-- SELECT policy). This script ONLY ADDS a new INSERT policy for the
-- `anon` role — it does not touch, drop, or replace any existing policy,
-- so the logged-in admin app's flows (ClpMaintenance) are unaffected.
--
-- Note: this does NOT grant anon the ability to create new clp_trainings
-- batches — only to enroll into batches that already exist. Batch
-- creation stays admin-only (ClpMaintenance, authenticated).
--
-- Heads up: there is no login gate on the public page, so this lets
-- anyone with the anon key insert a roster row for any MemberIDNo into
-- any existing training batch (self-reported, unverified identity) —
-- same trust model as the rest of the public pages in this app. If you
-- need stronger guarantees (e.g. one row per member per batch), add a
-- UNIQUE constraint on (MemberIDNo, clp_training_id) at the table level.
--
-- How to run:
--   Supabase Dashboard -> your project -> SQL Editor -> New query
--   -> paste this file's contents -> Run.
--
-- Safe to re-run: each policy is dropped before being recreated (CREATE
-- POLICY has no IF NOT EXISTS form in Postgres).

ALTER TABLE public.clp_training_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public self-registration for CLP training" ON public.clp_training_participants;
CREATE POLICY "Public self-registration for CLP training"
ON public.clp_training_participants FOR INSERT
TO anon
WITH CHECK (true);

-- Verify afterwards:
-- SELECT policyname, cmd, roles FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'clp_training_participants';
