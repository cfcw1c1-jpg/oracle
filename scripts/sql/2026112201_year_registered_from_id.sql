-- Fills in Year Registered from the member ID where it is missing.
-- OGD member IDs carry the registration year: PM-2014-139698, IM-2013-…,
-- MM-2016-…. Formation Stats uses Year Registered to decide who counts for
-- Second, Third and Fourth Year formation.
--
-- Runs as a migration, not as a signed-in user, so nothing is queued for OGD.
-- Only blanks are filled; existing values are kept. Safe to re-run.

UPDATE public.members
   SET "YearRegistered" = substring("MemberIDNo" from '^[A-Za-z]{2}-([0-9]{4})-')::int
 WHERE "YearRegistered" IS NULL
   AND "MemberIDNo" ~ '^[A-Za-z]{2}-[0-9]{4}-';
