-- =========================================================================
-- Fires the send-message-notification Edge Function whenever a row is
-- inserted into public.messages, via pg_net (an outbound HTTP call from
-- inside Postgres) instead of the Dashboard's Database Webhooks UI --
-- that page isn't present in every project's current Database sidebar,
-- and this approach keeps the shared secret out of git entirely.
--
-- ONE-TIME MANUAL STEP, before running this script: store the webhook
-- secret in Supabase Vault (Dashboard SQL Editor, run once, do not commit
-- this line anywhere -- use the SAME value you passed to
-- `npx supabase secrets set WEBHOOK_SECRET=...` when deploying the
-- function):
--
--   select vault.create_secret('<your-random-secret-value>', 'message_webhook_secret');
--
-- If you ever need to change it later:
--
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'message_webhook_secret'),
--     '<new-value>'
--   );
--
-- Run this script once after that. Safe to re-run.
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";

CREATE OR REPLACE FUNCTION "public"."notify_new_message"()
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
    url := 'https://efelttlcyjfsvpxwmwjd.supabase.co/functions/v1/send-message-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', COALESCE(webhook_secret, '')
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'messages',
      'record', to_jsonb(NEW)
    )
  );

  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."notify_new_message"() OWNER TO "postgres";

DROP TRIGGER IF EXISTS "on_message_insert_notify" ON "public"."messages";
CREATE TRIGGER "on_message_insert_notify"
    AFTER INSERT ON "public"."messages"
    FOR EACH ROW EXECUTE FUNCTION "public"."notify_new_message"();
