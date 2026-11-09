import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://efelttlcyjfsvpxwmwjd.supabase.co';

// Each page edits exactly one credential type. Status is visible on both.
export const SCOPES = {
  accounts: { pageKey: 'ogdAccounts', credential: 'ogd' },
  sector: { pageKey: 'ogdChapters', credential: 'gmail' },
  reports: { pageKey: 'monthlyPastoralReports', credential: null },
};

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Wraps a handler so an unexpected error never leaks internals to the client.
export function route(handler) {
  return async (request) => {
    try {
      return Response.json(await handler(request));
    } catch (error) {
      if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
      console.error('[ogd] request failed:', error?.message);
      return Response.json({ error: 'Something went wrong on the server.' }, { status: 500 });
    }
  };
}

function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set.');
  return createClient(SUPABASE_URL, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function fetchAllRows(buildQuery) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

// Chapters the caller may manage, labelled with their Sector and Cluster.
// Unlike the Directory, a non-Admin with no assigned Areas gets nothing here:
// these rows control credentials, so this check fails closed.
export function resolveChapters(areas, assignedAreaIds, isAdmin) {
  const byId = new Map(areas.map((area) => [area.id, area]));
  const assigned = new Set(assignedAreaIds);

  function lineage(area) {
    const chain = [];
    const seen = new Set();
    for (let current = area; current && !seen.has(current.id); current = byId.get(current.parent_id)) {
      seen.add(current.id);
      chain.push(current);
    }
    return chain;
  }

  return areas
    .filter((area) => area.type === 'Chapter')
    .map((area) => ({ area, chain: lineage(area) }))
    .filter(({ chain }) => isAdmin || chain.some((node) => assigned.has(node.id)))
    .map(({ area, chain }) => ({
      areaId: area.id,
      chapter: area.name,
      cluster: chain.find((node) => node.type === 'Cluster')?.name ?? null,
      sector: chain.find((node) => node.type === 'Sector')?.name ?? null,
    }));
}

// Authenticates the bearer token and confirms the caller's role holds the
// scope's page, then returns the chapters that caller can act on.
export async function authorize(request, scopeName) {
  const scope = SCOPES[scopeName];
  if (!scope) throw new HttpError(400, 'Unknown scope.');

  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Please sign in again.');

  const db = createAdminClient();
  const { data: authData, error: authError } = await db.auth.getUser(token);
  if (authError || !authData?.user) throw new HttpError(401, 'Please sign in again.');
  const userId = authData.user.id;

  const { data: profile, error: profileError } = await db
    .from('profiles')
    .select('role_id, roles ( name )')
    .eq('id', userId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile?.role_id) throw new HttpError(403, 'You do not have access to this page.');

  const { data: grant, error: grantError } = await db
    .from('role_pages')
    .select('page_key')
    .eq('role_id', profile.role_id)
    .eq('page_key', scope.pageKey)
    .maybeSingle();
  if (grantError) throw grantError;
  if (!grant) throw new HttpError(403, 'You do not have access to this page.');

  const [areas, assignments] = await Promise.all([
    fetchAllRows(() => db.from('areas').select('id, name, type, parent_id').order('id')),
    fetchAllRows(() => db.from('user_areas').select('area_id').eq('profile_id', userId).order('id')),
  ]);

  const chapters = resolveChapters(areas, assignments.map((row) => row.area_id), profile.roles?.name === 'Admin');
  return { db, userId, scope, chapters };
}
