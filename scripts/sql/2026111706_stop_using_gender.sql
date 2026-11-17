-- =========================================================================
-- Gender is no longer used in Oracle (it is not on OGD). The members.Gender
-- column and its data stay in place, untouched, so this can be undone; the
-- website and phone app simply stop reading and writing it.
--
-- This stops queueing Gender changes for OGD and removes any already queued.
--
-- Run after 2026111705_ogd_pending_changes.sql. Safe to re-run.
-- =========================================================================

CREATE OR REPLACE FUNCTION "public"."track_ogd_member_changes"() RETURNS "trigger"
  LANGUAGE "plpgsql" SECURITY DEFINER
  SET "search_path" TO 'public'
AS $$
DECLARE
  col text;
  old_text text;
  new_text text;
BEGIN
  -- Only edits made by people in Oracle are queued for OGD.
  IF coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  FOREACH col IN ARRAY ARRAY['Lastname', 'Firstname', 'Status', 'SpouseName', 'Phone', 'MobileNo', 'Email',
                             'PastoralService', 'AreaName', 'NameOfHouseholdHead', 'YearRegistered'] LOOP
    EXECUTE format('SELECT ($1).%I::text, ($2).%I::text', col, col) INTO old_text, new_text USING OLD, NEW;
    IF old_text IS DISTINCT FROM new_text THEN
      INSERT INTO ogd_pending_changes AS pending (member_id, field, old_value, new_value, changed_by)
      VALUES (NEW."MemberIDNo", col, old_text, new_text, auth.uid())
      ON CONFLICT (member_id, field) DO UPDATE SET
        old_value = CASE WHEN pending.status = 'pushed' THEN EXCLUDED.old_value ELSE pending.old_value END,
        new_value = EXCLUDED.new_value,
        status = 'pending',
        detail = NULL,
        changed_by = EXCLUDED.changed_by,
        changed_at = now(),
        pushed_at = NULL;
      -- Edited back to what it was: nothing left to push.
      DELETE FROM ogd_pending_changes
       WHERE member_id = NEW."MemberIDNo" AND field = col AND old_value IS NOT DISTINCT FROM new_value;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DELETE FROM "public"."ogd_pending_changes" WHERE "field" = 'Gender';

NOTIFY pgrst, 'reload schema';
