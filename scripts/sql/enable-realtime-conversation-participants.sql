-- =========================================================================
-- Messages' new "Seen by" indicator (src/screens/Messages.js) needs to know
-- live when another participant's conversation_participants.last_read_at
-- moves, so it can update without the sender having to leave and reopen the
-- thread. add-messaging.sql only ever added "messages" to the realtime
-- publication -- this adds conversation_participants too.
--
-- Run once, after add-messaging.sql. Safe to re-run.
-- =========================================================================

DO $$
BEGIN
  ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."conversation_participants";
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;
