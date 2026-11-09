import { supabase } from './supabase';

// Areas assigned to the signed-in account, used to narrow Area filters to what
// row-level security already limits the data to.
export async function loadAssignedAreaNames() {
  const { data: authData } = await supabase.auth.getUser();
  if (!authData?.user) return [];
  const { data, error } = await supabase.from('user_areas').select('areas ( name )').eq('profile_id', authData.user.id);
  if (error) throw error;
  return (data || []).map((row) => row.areas?.name).filter(Boolean);
}

export function buildAreaOptions(assignedNames, areaNames) {
  if (assignedNames.length > 0) return ['All', ...[...new Set(assignedNames)].sort()];
  return ['All', ...[...new Set(areaNames.map((name) => (name || 'No Area').trim()))].sort()];
}

// Prefix match, so "West 1C2" also covers variants such as "West 1C2B".
export function matchesArea(filter, areaName) {
  if (filter === 'All') return true;
  const value = (areaName || '').trim();
  return filter === 'No Area' ? !value : value.toLowerCase().startsWith(filter.toLowerCase());
}
