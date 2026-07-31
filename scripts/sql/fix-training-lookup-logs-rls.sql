-- Fixes training_lookup_logs silently logging nothing: the table has RLS
-- enabled with zero policies (confirmed live: inserting via the anon key
-- fails with 42501 "new row violates row-level security policy"), which
-- is Supabase's default for tables created via the dashboard/SQL editor —
-- I never explicitly enabled it, and the app's try/catch around the
-- logging insert swallowed the error silently (console.warn only), so it
-- looked like nothing was happening rather than erroring.
--
-- Adds:
--   - INSERT for anon  -> the public /training-lookup page (no login) can
--                          record search + view_member events.
--   - SELECT for authenticated -> the logged-in "Audit Logs" tab (and its
--                          Realtime subscription, which is also governed
--                          by RLS) can actually read the rows.
--
-- How to run:
--   Supabase Dashboard -> your project -> SQL Editor -> New query
--   -> paste this file's contents -> Run.
--
-- Safe to re-run: each policy is dropped before being recreated (CREATE
-- POLICY has no IF NOT EXISTS form in Postgres).

DROP POLICY IF EXISTS "Public can log lookup events" ON public.training_lookup_logs;
CREATE POLICY "Public can log lookup events"
ON public.training_lookup_logs FOR INSERT
TO anon
WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated can read lookup logs" ON public.training_lookup_logs;
CREATE POLICY "Authenticated can read lookup logs"
ON public.training_lookup_logs FOR SELECT
TO authenticated
USING (true);

-- Verify afterwards:
-- SELECT policyname, cmd, roles FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'training_lookup_logs';
