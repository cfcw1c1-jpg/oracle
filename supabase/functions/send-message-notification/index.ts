// Sends an Expo push notification to the other participant(s) of a
// conversation whenever a new row lands in public.messages. Meant to be
// invoked by a Supabase Database Webhook (Database > Webhooks > Create):
//   Table: messages | Events: Insert | Type: Supabase Edge Functions
//   Edge Function: send-message-notification
//   HTTP Headers: x-webhook-secret: <same value as the WEBHOOK_SECRET secret below>
//
// Deploy:
//   npx supabase login
//   npx supabase link --project-ref efelttlcyjfsvpxwmwjd
//   npx supabase secrets set WEBHOOK_SECRET=<a-random-string-you-pick>
//   npx supabase functions deploy send-message-notification
//
// Then add the same WEBHOOK_SECRET value as a custom HTTP header on the
// Database Webhook (see above) so this endpoint rejects requests that
// don't come from that webhook.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const MAX_BODY_PREVIEW = 120;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const webhookSecret = Deno.env.get('WEBHOOK_SECRET');
    if (webhookSecret && req.headers.get('x-webhook-secret') !== webhookSecret) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const payload = await req.json();
    const message = payload?.record;
    if (!message?.conversation_id || !message?.sender_id) {
      return jsonResponse({ error: 'Missing message record' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: participants, error: participantsError } = await adminClient
      .from('conversation_participants')
      .select('profile_id')
      .eq('conversation_id', message.conversation_id)
      .neq('profile_id', message.sender_id);

    if (participantsError) throw participantsError;
    if (!participants || participants.length === 0) {
      return jsonResponse({ ok: true, sent: 0, reason: 'no other participants' });
    }

    const recipientIds = participants.map((p) => p.profile_id);

    const { data: tokenRows, error: tokensError } = await adminClient
      .from('push_tokens')
      .select('token')
      .in('profile_id', recipientIds);

    if (tokensError) throw tokensError;
    if (!tokenRows || tokenRows.length === 0) {
      return jsonResponse({ ok: true, sent: 0, reason: 'no registered devices' });
    }

    const { data: sender } = await adminClient
      .from('profiles')
      .select('full_name, email')
      .eq('id', message.sender_id)
      .maybeSingle();
    const senderName = sender?.full_name || sender?.email || 'New message';

    const bodyText = String(message.body ?? '');
    const bodyPreview = bodyText
      ? (bodyText.length > MAX_BODY_PREVIEW ? `${bodyText.slice(0, MAX_BODY_PREVIEW - 1)}…` : bodyText)
      : (message.image_url ? '📷 Photo' : '');

    const pushMessages = tokenRows.map((row) => ({
      to: row.token,
      sound: 'default',
      title: senderName,
      body: bodyPreview,
      data: { conversationId: message.conversation_id },
    }));

    const pushRes = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(pushMessages),
    });
    const pushResult = await pushRes.json();

    return jsonResponse({ ok: true, sent: pushMessages.length, result: pushResult });
  } catch (error) {
    console.error(error);
    return jsonResponse({ error: error?.message || 'Unexpected error' }, 500);
  }
});
