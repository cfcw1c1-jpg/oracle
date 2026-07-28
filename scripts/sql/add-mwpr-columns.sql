-- Adds the "Mission With The Poor" (MWPR) tracking columns to pfo_members.
--
-- Column names must match exactly what src/screens/PfoList.js /
-- src/screens/PfoReports.js / src/screens/PfoStatGenerator.js already
-- reference as training-column ids, since the app reads/writes these as
-- literal column names (e.g. row["MWPR_1-MWPR1:Sharing for the Common Good"]).
--
-- Safe to re-run: IF NOT EXISTS skips any column that's already there.
--
-- How to run:
--   Supabase Dashboard -> your project -> SQL Editor -> New query
--   -> paste this file's contents -> Run.

ALTER TABLE public.pfo_members
  ADD COLUMN IF NOT EXISTS "MWPR_1-MWPR1:Sharing for the Common Good" text,
  ADD COLUMN IF NOT EXISTS "MWPR_2-MWPR2:Caring for The person in need" text,
  ADD COLUMN IF NOT EXISTS "MWPR_3-MWPR3:Church of the Poor" text,
  ADD COLUMN IF NOT EXISTS "MWPR_4-MWPR4:Future Full of Hope" text;

-- Verify afterwards:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'pfo_members' AND column_name LIKE 'MWPR%'
-- ORDER BY column_name;
