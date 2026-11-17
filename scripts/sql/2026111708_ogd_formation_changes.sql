-- =========================================================================
-- Queue formation changes for OGD. When someone in Oracle ticks or unticks a
-- talk (PFO Trainings grid, or Assign to Talks on the Directory), the change
-- is added to ogd_pending_changes, like member detail edits, and Push to OGD
-- ticks it in the member's "Set Formation" checklist on OGD.
--
--   field      the pfo_members training column ("CODE_N-Title")
--   old/new    'Y' for ticked, NULL for not ticked
--
-- Like track_ogd_member_changes, only signed-in people's edits are queued;
-- the OGD sync and reverts run as the service role and are not.
--
-- Run after 2026111705_ogd_pending_changes.sql. Safe to re-run.
-- =========================================================================

CREATE OR REPLACE FUNCTION "public"."track_ogd_formation_changes"() RETURNS "trigger"
  LANGUAGE "plpgsql" SECURITY DEFINER
  SET "search_path" TO 'public'
AS $$
DECLARE
  old_row jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  new_row jsonb := to_jsonb(NEW);
  col text;
  old_text text;
  new_text text;
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  FOR col IN SELECT key FROM jsonb_object_keys(new_row) AS key WHERE key ~ '^[A-Z0-9 ]+_[0-9]+-' LOOP
    old_text := CASE WHEN upper(trim(old_row ->> col)) = 'Y' THEN 'Y' END;
    new_text := CASE WHEN upper(trim(new_row ->> col)) = 'Y' THEN 'Y' END;
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
      -- Ticked back to what it was: nothing left to push.
      DELETE FROM ogd_pending_changes
       WHERE member_id = NEW."MemberIDNo" AND field = col AND old_value IS NOT DISTINCT FROM new_value;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "track_ogd_formation_changes" ON "public"."pfo_members";
CREATE TRIGGER "track_ogd_formation_changes"
  AFTER INSERT OR UPDATE ON "public"."pfo_members"
  FOR EACH ROW EXECUTE FUNCTION "public"."track_ogd_formation_changes"();

NOTIFY pgrst, 'reload schema';
