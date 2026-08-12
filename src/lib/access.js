import { supabase } from '../../lib/supabase';

// Every gate-able sidebar page. Must match the `pages` table seeded by
// scripts/sql/add-admin-roles-and-areas.sql and the NAV_ITEMS keys in
// src/app/index.js.
export const ALL_PAGE_KEYS = [
  'home',
  'members',
  'manageMembers',
  'pfo',
  'pfoReports',
  'pfoStats',
  'clp',
  'auditLogs',
  'portalUsers',
  'rolesAccess',
  'areas',
  'csvImport',
  'systemAudit',
  'settings',
];

// Loads the signed-in user's profile, role name, and the set of page keys
// their role grants access to. A profile with no role assigned yet (the
// state every new portal account starts in) resolves to zero allowed pages.
// The Admin role has no built-in "sees everything" bypass — like any other
// role, its visible pages are exactly whatever is checked for it on the
// Roles & Page Access screen (seeded to the admin-only pages by default).
export async function fetchAccessContext(userId) {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, email, full_name, role_id, roles ( id, name )')
    .eq('id', userId)
    .maybeSingle();
  if (profileError) throw profileError;

  const roleName = profile?.roles?.name || null;

  let allowedPages = [];
  if (profile?.role_id) {
    const { data: rolePages, error: rolePagesError } = await supabase
      .from('role_pages')
      .select('page_key')
      .eq('role_id', profile.role_id);
    if (rolePagesError) throw rolePagesError;
    allowedPages = (rolePages || []).map((row) => row.page_key);
  }

  return {
    profile,
    roleName,
    isAdmin: roleName === 'Admin',
    allowedPages,
  };
}
