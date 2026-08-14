// Sends an Expo push notification to every Admin/Moderator (anyone whose
// role has the "memberChangeQueue" page) whenever a new row lands in
// public.member_change_requests -- i.e. someone submitted a Directory
// edit for review. Meant to be invoked by the pg_net trigger in
// scripts/sql/add-change-request-webhook-trigger.sql, same pattern as
// send-message-notification.
//
// Deploy (after `npx supabase login` and
// `npx supabase link --project-ref efelttlcyjfsvpxwmwjd`):
//   npx supabase functions deploy send-change-request-notification --no-verify-jwt
//
// Reuses the same WEBHOOK_SECRET function secret and the same Vault
// secret ("message_webhook_secret") as send-message-notification -- both
// were already set up for that function, nothing new to configure.

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
    const request = payload?.record;
    if (!request?.id || !request?.member_id) {
      return jsonResponse({ error: 'Missing change request record' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Anyone whose role currently has the Change Requests page -- mirrors
    // the badge-count logic in src/app/index.js, so notification
    // recipients always match who'd actually see it in the sidebar.
    const { data: recipients, error: recipientsError } = await adminClient
      .from('profiles')
      .select('id, roles(role_pages(page_key))')
      .not('role_id', 'is', null);
    if (recipientsError) throw recipientsError;

    const recipientIds = (recipients || [])
      .filter((p) => p.roles?.role_pages?.some((rp) => rp.page_key === 'memberChangeQueue'))
      .map((p) => p.id)
      .filter((id) => id !== request.requested_by);

    if (recipientIds.length === 0) {
      return jsonResponse({ ok: true, sent: 0, reason: 'no eligible recipients' });
    }

    const { data: tokenRows, error: tokensError } = await adminClient
      .from('push_tokens')
      .select('token')
      .in('profile_id', recipientIds);
    if (tokensError) throw tokensError;
    if (!tokenRows || tokenRows.length === 0) {
      return jsonResponse({ ok: true, sent: 0, reason: 'no registered devices' });
    }

    const { data: member } = await adminClient
      .from('members')
      .select('Lastname, Firstname')
      .eq('MemberIDNo', request.member_id)
      .maybeSingle();
    const memberName = member ? `${member.Lastname}, ${member.Firstname}` : request.member_id;

    const requesterName = request.requested_by_email || 'Someone';

    const pushMessages = tokenRows.map((row) => ({
      to: row.token,
      sound: 'default',
      title: 'New Change Request',
      body: `${requesterName} wants to update ${memberName}'s record.`,
      data: { type: 'changeRequest', requestId: request.id },
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
