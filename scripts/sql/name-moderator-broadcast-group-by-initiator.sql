-- =========================================================================
-- start_moderator_group_conversation() (see add-moderator-group-messaging.sql)
-- titled every member's standing broadcast thread with the Moderator team
-- the same fixed "Moderator Team" -- fine for the member who owns it (they
-- only ever have one), but Moderators end up with one differently-purposed
-- group per member who's reached out, all showing that identical name in
-- their conversation list with nothing to tell them apart.
--
-- Names it "Moderators w/ <initiating member's email>" instead, set once
-- at creation time (title never changes on reuse, matching the "one
-- standing group per initiator" design -- see the unique index in
-- add-moderator-group-messaging.sql).
--
-- Run once, after add-moderator-group-messaging.sql. Safe to re-run.
-- Existing groups keep whatever title they already have; only new ones
-- (and any current row happening to still say the literal 'Moderator
-- Team' placeholder) pick up the new naming.
-- =========================================================================

CREATE OR REPLACE FUNCTION "public"."start_moderator_group_conversation"()
RETURNS bigint
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" = 'public'
AS $$
DECLARE
  me uuid := auth.uid();
  my_email text;
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
    SELECT email INTO my_email FROM public.profiles WHERE id = me;

    INSERT INTO public.conversations (is_group, title, purpose, initiator_id)
    VALUES (true, 'Moderators w/ ' || COALESCE(my_email, 'Unknown'), 'moderator_broadcast', me)
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

-- One-time backfill: rename groups that still hold the old literal
-- placeholder title. Only touches that exact string, so re-running is a
-- no-op once applied, and it never overwrites a title someone changed.
UPDATE public.conversations c
SET title = 'Moderators w/ ' || COALESCE(p.email, 'Unknown')
FROM public.profiles p
WHERE c.purpose = 'moderator_broadcast'
  AND c.title = 'Moderator Team'
  AND p.id = c.initiator_id;
