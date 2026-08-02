-- Adds a "Status" column to members: Active / Inactive / Deceased / Sold.
--
-- Column name must match exactly what src/screens/MembersList.js references
-- as a literal column name ("Status"), same convention as the Gender and
-- PastoralService fields already on this table.
--
-- Safe to re-run: IF NOT EXISTS skips the column add if it's already there;
-- the constraint add is wrapped so a duplicate_object error is ignored.
--
-- How to run:
--   Supabase Dashboard -> your project -> SQL Editor -> New query
--   -> paste this file's contents -> Run.

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS "Status" text DEFAULT 'Active';

DO $$
BEGIN
  ALTER TABLE public.members
    ADD CONSTRAINT members_status_check CHECK ("Status" IN ('Active', 'Inactive', 'Deceased', 'Sold'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

UPDATE public.members SET "Status" = 'Active' WHERE "Status" IS NULL;

-- Verify afterwards:
-- SELECT "Status", COUNT(*) FROM public.members GROUP BY "Status";
