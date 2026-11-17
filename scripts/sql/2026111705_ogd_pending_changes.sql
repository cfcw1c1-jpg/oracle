-- =========================================================================
-- Changes waiting to be pushed from Oracle to OGD.
--
-- A trigger on members records every field a signed-in user changes (direct
-- edits, approved Change Requests, CSV imports from the site). The OGD
-- automation writes with the service role and is not recorded, so a sync
-- never queues what it copied from OGD.
--
-- One row per member and field: editing the same field again keeps the
-- original old_value and updates new_value, and editing it back to the
-- original removes the row. MSG and Chapter Heads review these on OGD
-- Accounts (Discard, Revert) and push the rest to OGD.
--
--   status   pending  waiting to be pushed
--            failed   last push could not apply it (detail says why)
--            pushed   OGD now has new_value
--
-- Also gives Chapter Head the OGD Accounts page, limited as always to the
-- chapters assigned to them.
--
-- Run after 2026111704_ogd_member_sync_parts.sql. Safe to re-run.
-- =========================================================================

CREATE TABLE IF NOT EXISTS "public"."ogd_pending_changes" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "member_id" "text" NOT NULL,
  "field" "text" NOT NULL,
  "old_value" "text",
  "new_value" "text",
  "status" "text" DEFAULT 'pending' NOT NULL,
  "detail" "text",
  "changed_by" "uuid",
  "changed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "attempted_at" timestamp with time zone,
  "pushed_at" timestamp with time zone,
  CONSTRAINT "ogd_pending_changes_member_field_key" UNIQUE ("member_id", "field"),
  CONSTRAINT "ogd_pending_changes_status_check" CHECK ("status" = ANY (ARRAY['pending'::"text", 'failed'::"text", 'pushed'::"text"]))
);

CREATE INDEX IF NOT EXISTS "ogd_pending_changes_status_idx" ON "public"."ogd_pending_changes" ("status");

-- Only the server (service role) reads and writes this table.
ALTER TABLE "public"."ogd_pending_changes" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."ogd_pending_changes" FROM "anon", "authenticated";
GRANT ALL ON TABLE "public"."ogd_pending_changes" TO "service_role";

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

  FOREACH col IN ARRAY ARRAY['Lastname', 'Firstname', 'Gender', 'Status', 'SpouseName', 'Phone', 'MobileNo', 'Email',
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

DROP TRIGGER IF EXISTS "track_ogd_member_changes" ON "public"."members";
CREATE TRIGGER "track_ogd_member_changes"
  AFTER UPDATE ON "public"."members"
  FOR EACH ROW EXECUTE FUNCTION "public"."track_ogd_member_changes"();

INSERT INTO "public"."role_pages" ("role_id", "page_key")
SELECT "id", 'ogdAccounts' FROM "public"."roles" WHERE "name" = 'Chapter Head'
  AND NOT EXISTS (
    SELECT 1 FROM "public"."role_pages" rp JOIN "public"."roles" r ON r."id" = rp."role_id"
     WHERE r."name" = 'Chapter Head' AND rp."page_key" = 'ogdAccounts'
  );

NOTIFY pgrst, 'reload schema';
