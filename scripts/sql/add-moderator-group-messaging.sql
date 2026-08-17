-- =========================================================================
-- "Message a Moderator" (src/screens/Messages.js) used to pick ONE random
-- Moderator and open a private 1:1 conversation with just them -- so if a
-- member sent a photo (of a document, an issue, etc.) only that one
-- Moderator could ever see it, even if they never checked their inbox.
--
-- This migration turns conversations into a general many-participant model
-- and adds start_moderator_group_conversation(): a member gets ONE shared
-- group thread with every current Moderator, so the whole team can see
-- everything sent there, including images (see also
-- add-message-images.sql for the image_url column + storage bucket).
--
-- Run once, after add-messaging.sql, add-member-change-requests.sql
-- (roles must exist), add-profiles-avatar-url.sql (profiles.avatar_url
-- must exist), and add-message-images.sql (this file's
-- get_my_conversations rewrite selects messages.image_url). Safe to re-run.
-- =========================================================================

ALTER TABLE "public"."conversations" ADD COLUMN IF NOT EXISTS "is_group" boolean DEFAULT false NOT NULL;
ALTER TABLE "public"."conversations" ADD COLUMN IF NOT EXISTS "title" "text";
ALTER TABLE "public"."conversations" ADD COLUMN IF NOT EXISTS "purpose" "text";
ALTER TABLE "public"."conversations" ADD COLUMN IF NOT EXISTS "initiator_id" "uuid";

ALTER TABLE "public"."conversations" DROP CONSTRAINT IF EXISTS "conversations_initiator_id_fkey";
ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_initiator_id_fkey" FOREIGN KEY ("initiator_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;

-- One moderator-broadcast group per initiating member -- re-running
-- start_moderator_group_conversation() for the same member reuses it
-- (and tops up membership) instead of spawning a duplicate thread.
DROP INDEX IF EXISTS "idx_conversations_moderator_broadcast_initiator";
CREATE UNIQUE INDEX "idx_conversations_moderator_broadcast_initiator"
  ON "public"."conversations" ("initiator_id")
  WHERE ("purpose" = 'moderator_broadcast');


-- Finds (or creates) the caller's standing group conversation with every
-- current Moderator. SECURITY DEFINER so it can add other people as
-- participants -- same reasoning as start_direct_conversation().
CREATE OR REPLACE FUNCTION "public"."start_moderator_group_conversation"()
RETURNS bigint
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" = 'public'
AS $$
DECLARE
  me uuid := auth.uid();
  existing_id bigint;
  new_id bigint;
  mod_count int;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT count(*) INTO mod_count
  FROM public.profiles p
  JOIN public.roles r ON r.id = p.role_id
  WHERE r.name = 'Moderator' AND p.id <> me;

  IF mod_count = 0 THEN
    RAISE EXCEPTION 'No portal account currently has the Moderator role.';
  END IF;

  SELECT id INTO existing_id
  FROM public.conversations
  WHERE purpose = 'moderator_broadcast' AND initiator_id = me;

  IF existing_id IS NULL THEN
    INSERT INTO public.conversations (is_group, title, purpose, initiator_id)
    VALUES (true, 'Moderator Team', 'moderator_broadcast', me)
    RETURNING id INTO new_id;

    INSERT INTO public.conversation_participants (conversation_id, profile_id)
    VALUES (new_id, me);

    existing_id := new_id;
  END IF;

  -- Top up membership with any Moderator who wasn't already in the thread
  -- (newly promoted since it was created, etc.) -- never removes anyone,
  -- so departed Moderators keep access to what they already saw.
  INSERT INTO public.conversation_participants (conversation_id, profile_id)
  SELECT existing_id, p.id
  FROM public.profiles p
  JOIN public.roles r ON r.id = p.role_id
  WHERE r.name = 'Moderator' AND p.id <> me
  ON CONFLICT (conversation_id, profile_id) DO NOTHING;

  RETURN existing_id;
END;
$$;

ALTER FUNCTION "public"."start_moderator_group_conversation"() OWNER TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."start_moderator_group_conversation"() TO "authenticated";


-- Re-created to handle group conversations (a single row per conversation,
-- with an aggregated display name/avatar) alongside the existing 1:1 case.
-- Must DROP first: changing a RETURNS TABLE function's column set isn't a
-- valid CREATE OR REPLACE (same reason add-profiles-avatar-url.sql did this).
DROP FUNCTION IF EXISTS "public"."get_my_conversations"();

CREATE OR REPLACE FUNCTION "public"."get_my_conversations"()
RETURNS TABLE (
  "conversation_id" bigint,
  "is_group" boolean,
  "other_profile_id" "uuid",
  "other_email" "text",
  "other_full_name" "text",
  "other_avatar_url" "text",
  "last_message_at" timestamp with time zone,
  "last_message_body" "text",
  "last_message_image_url" "text",
  "last_message_sender_id" "uuid",
  "unread_count" bigint
)
LANGUAGE "sql"
SECURITY DEFINER
SET "search_path" = 'public'
STABLE
AS $$
  SELECT
    c.id,
    c.is_group,
    CASE WHEN c.is_group THEN NULL ELSE op.id END,
    CASE WHEN c.is_group THEN NULL ELSE op.email END,
    CASE WHEN c.is_group THEN COALESCE(c.title, 'Group') ELSE op.full_name END,
    CASE WHEN c.is_group THEN NULL ELSE op.avatar_url END,
    c.last_message_at,
    lm.body,
    lm.image_url,
    lm.sender_id,
    COALESCE(uc.cnt, 0)
  FROM public.conversations c
  JOIN public.conversation_participants me_cp ON me_cp.conversation_id = c.id AND me_cp.profile_id = auth.uid()
  LEFT JOIN LATERAL (
    SELECT other_cp.profile_id AS id
    FROM public.conversation_participants other_cp
    WHERE other_cp.conversation_id = c.id AND other_cp.profile_id <> auth.uid() AND NOT c.is_group
    LIMIT 1
  ) other_ref ON true
  LEFT JOIN public.profiles op ON op.id = other_ref.id
  LEFT JOIN LATERAL (
    SELECT "body", "image_url", "sender_id" FROM public.messages m
    WHERE m.conversation_id = c.id
    ORDER BY m.created_at DESC
    LIMIT 1
  ) lm ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS cnt FROM public.messages m2
    WHERE m2.conversation_id = c.id AND m2.created_at > me_cp.last_read_at AND m2.sender_id <> auth.uid()
  ) uc ON true
  ORDER BY c.last_message_at DESC;
$$;

ALTER FUNCTION "public"."get_my_conversations"() OWNER TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."get_my_conversations"() TO "authenticated";
