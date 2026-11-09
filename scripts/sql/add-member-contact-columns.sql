-- Adds the member contact fields that the CFC Global Data members export
-- carries but the members table didn't have yet.
--
--   "SpouseName"  "Spouse Name" on the site ("LASTNAME, Firstname")
--   "Phone"       landline
--   "MobileNo"    "Mobile #" on the site
--   "Email"
--   "SiteStatus"  the member's status exactly as CFC Global Data shows it
--                 (ACTIVE / INACTIVE / DECEASED / MOVED TO HOLD /
--                 MOVED TO OTHER COMMUNITY). "Status" stays limited to the
--                 app's own values; see scripts/import-cfc-members.js for
--                 how SiteStatus maps onto it.
--
-- Safe to re-run: IF NOT EXISTS skips any column that's already there.

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS "SpouseName" text,
  ADD COLUMN IF NOT EXISTS "Phone" text,
  ADD COLUMN IF NOT EXISTS "MobileNo" text,
  ADD COLUMN IF NOT EXISTS "Email" text,
  ADD COLUMN IF NOT EXISTS "SiteStatus" text;

-- PostgREST caches the schema; reload it so the new columns are writable
-- through the API right away.
NOTIFY pgrst, 'reload schema';
