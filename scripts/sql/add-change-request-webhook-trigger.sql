-- =========================================================================
-- Fires the send-change-request-notification Edge Function whenever a row
-- is inserted into public.member_change_requests -- i.e. notifies every
-- Admin/Moderator the moment someone submits a Directory edit for review.
-- Same pg_net + Vault-secret pattern as add-message-webhook-trigger.sql;
-- reuses that same "message_webhook_secret" Vault entry, so if you've
-- already run that script (and set the WEBHOOK_SECRET function secret),
-- there is nothing new to configure here.
--
-- Run once. Safe to re-run.
-- =========================================================================

CREATE OR REPLACE FUNCTION "public"."notify_new_change_request"()
RETURNS "trigger"
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" = 'public'
AS $$
DECLARE
  webhook_secret text;
BEGIN
  SELECT decrypted_secret INTO webhook_secret
  FROM vault.decrypted_secrets
  WHERE name = 'message_webhook_secret'
  LIMIT 1;

  PERFORM net.http_post(
    url := 'https://efelttlcyjfsvpxwmwjd.supabase.co/functions/v1/send-change-request-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', COALESCE(webhook_secret, '')
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'member_change_requests',
      'record', to_jsonb(NEW)
    )
  );

  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."notify_new_change_request"() OWNER TO "postgres";

DROP TRIGGER IF EXISTS "on_change_request_insert_notify" ON "public"."member_change_requests";
CREATE TRIGGER "on_change_request_insert_notify"
    AFTER INSERT ON "public"."member_change_requests"
    FOR EACH ROW EXECUTE FUNCTION "public"."notify_new_change_request"();
