-- Adds each member's church wedding date, read from OGD's Edit Member > Family
-- tab ("Church Wedding Date") by the Members sync. It is read from OGD only:
-- it is not queued for OGD when changed in Oracle, so the sync trigger
-- (track_ogd_member_changes) is left as it is.
--
-- Safe to re-run: IF NOT EXISTS skips the column when it is already there.

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS "WeddingDate" date;

-- PostgREST caches the schema; reload it so the column is readable and
-- writable through the API right away.
NOTIFY pgrst, 'reload schema';
