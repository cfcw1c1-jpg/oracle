-- =========================================================================
-- Adds an "On-Going" state to member_change_requests: a moderator/admin
-- can now claim a request (assigning it to themselves) and open a direct
-- conversation with the requester right from the Change Requests queue,
-- instead of only ever approving/rejecting blind.
--
--   assigned_to / assigned_to_email -- whichever Admin/Moderator most
--     recently clicked "Message" on this request; set alongside status
--     flipping to 'on_going'.
--   conversation_id -- the direct conversation (public.conversations,
--     see add-messaging.sql) that Message opened, so the request can link
--     back to the exact thread it was discussed in.
--
-- No new RLS policy is needed -- the existing "Approvers manage change
-- requests" UPDATE policy (is_admin() OR is_moderator()) already covers
-- writing these columns, and start_direct_conversation() is already
-- callable by any authenticated account.
--
-- Run once, after add-member-change-requests.sql and add-messaging.sql.
-- Safe to re-run.
-- =========================================================================

ALTER TABLE "public"."member_change_requests" DROP CONSTRAINT IF EXISTS "member_change_requests_status_check";
ALTER TABLE "public"."member_change_requests" ADD CONSTRAINT "member_change_requests_status_check"
  CHECK (("status" = ANY (ARRAY['pending'::"text", 'on_going'::"text", 'approved'::"text", 'rejected'::"text"])));

ALTER TABLE "public"."member_change_requests" ADD COLUMN IF NOT EXISTS "assigned_to" "uuid";
ALTER TABLE "public"."member_change_requests" ADD COLUMN IF NOT EXISTS "assigned_to_email" "text";
ALTER TABLE "public"."member_change_requests" ADD COLUMN IF NOT EXISTS "conversation_id" bigint;

ALTER TABLE "public"."member_change_requests" DROP CONSTRAINT IF EXISTS "member_change_requests_assigned_to_fkey";
ALTER TABLE ONLY "public"."member_change_requests"
    ADD CONSTRAINT "member_change_requests_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;

ALTER TABLE "public"."member_change_requests" DROP CONSTRAINT IF EXISTS "member_change_requests_conversation_id_fkey";
ALTER TABLE ONLY "public"."member_change_requests"
    ADD CONSTRAINT "member_change_requests_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "idx_member_change_requests_assigned_to" ON "public"."member_change_requests" USING "btree" ("assigned_to");
