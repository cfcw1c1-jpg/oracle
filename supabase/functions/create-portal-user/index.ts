// Creates a new Supabase Auth user on behalf of an Admin, from Portal
// Users -> "Add User". This has to be an Edge Function (not a client-side
// call) because creating an auth user requires the service_role key, which
// bypasses RLS entirely and must never be shipped in the app bundle.
//
// This function re-checks admin-ness itself using the CALLER's own JWT --
// holding the service role key doesn't imply the caller is authorized, so
// every request is verified against the same `is_admin()` rule the rest of
// the app relies on (profiles.role_id -> roles.name = 'Admin') before any
// privileged action runs.
//
// Deploy with (from the repo root, after `npx supabase login` and
// `npx supabase link --project-ref efelttlcyjfsvpxwmwjd`):
//   npx supabase functions deploy create-portal-user
//
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected
// automatically into every Edge Function's environment -- nothing to
// configure manually.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse({ error: 'Missing Authorization header' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  try {
    // Identify the caller using their own JWT (anon key + their Authorization
    // header), same as any normal RLS-bound request -- this client can only
    // ever see what the caller themselves is allowed to see.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller }, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !caller) return jsonResponse({ error: 'Not authenticated' }, 401);

    const { data: callerProfile } = await callerClient
      .from('profiles')
      .select('roles ( name )')
      .eq('id', caller.id)
      .maybeSingle();
    if (callerProfile?.roles?.name !== 'Admin') {
      return jsonResponse({ error: 'Only Admins can create portal users' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const email = (body.email || '').trim();
    const password = body.password || '';
    const fullName = (body.full_name || '').trim();

    if (!email) return jsonResponse({ error: 'Email is required' }, 400);
    if (password.length < 6) return jsonResponse({ error: 'Password must be at least 6 characters' }, 400);

    // Only this client (built with the service_role key) can create auth
    // users -- it's never exposed to the browser, it only lives in this
    // function's server-side environment.
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) return jsonResponse({ error: error.message }, 400);

    // The on_auth_user_created trigger already inserted a matching
    // profiles row (id + email only) -- fill in the display name too if
    // one was given.
    if (fullName) {
      await adminClient.from('profiles').update({ full_name: fullName }).eq('id', data.user.id);
    }

    return jsonResponse({ id: data.user.id, email: data.user.email });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500);
  }
});
