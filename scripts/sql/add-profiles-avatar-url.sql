-- =========================================================================
-- Profile pictures are shown in Messages (the New Message search results,
-- conversation list, and thread header) for OTHER accounts, not just your
-- own -- which needs the avatar to be queryable through a normal table.
-- Until now it only lived in auth.users.user_metadata, which is only
-- readable for your OWN session client-side, not for other users.
--
-- This adds profiles.avatar_url, backfills it once from whatever's
-- already in auth.users.raw_user_meta_data (only the SQL editor, running
-- as postgres, can read that table directly), and updates
-- get_my_conversations() to return it. src/screens/ProfileScreen.js keeps
-- both copies in sync going forward whenever someone changes their photo.
--
-- Run once. Safe to re-run.
-- =========================================================================

ALTER TABLE "public"."profiles" ADD COLUMN IF NOT EXISTS "avatar_url" "text";

UPDATE "public"."profiles" p
SET "avatar_url" = u."raw_user_meta_data" ->> 'avatar_url'
FROM "auth"."users" u
WHERE u."id" = p."id"
  AND u."raw_user_meta_data" ->> 'avatar_url' IS NOT NULL
  AND p."avatar_url" IS NULL;

-- Re-create get_my_conversations() with the extra column -- CREATE OR
-- REPLACE can't change a TABLE-returning function's column list, so the
-- old signature has to be dropped first.
DROP FUNCTION IF EXISTS "public"."get_my_conversations"();

CREATE OR REPLACE FUNCTION "public"."get_my_conversations"()
RETURNS TABLE (
  "conversation_id" bigint,
  "other_profile_id" "uuid",
  "other_email" "text",
  "other_full_name" "text",
  "other_avatar_url" "text",
  "last_message_at" timestamp with time zone,
  "last_message_body" "text",
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
    op.id,
    op.email,
    op.full_name,
    op.avatar_url,
    c.last_message_at,
    lm.body,
    lm.sender_id,
    COALESCE(uc.cnt, 0)
  FROM public.conversations c
  JOIN public.conversation_participants me_cp ON me_cp.conversation_id = c.id AND me_cp.profile_id = auth.uid()
  JOIN public.conversation_participants other_cp ON other_cp.conversation_id = c.id AND other_cp.profile_id <> auth.uid()
  JOIN public.profiles op ON op.id = other_cp.profile_id
  LEFT JOIN LATERAL (
    SELECT "body", "sender_id" FROM public.messages m
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
