import { Platform } from 'react-native';
import { supabase } from '../../lib/supabase';

// The web app shares an origin with /api. Native builds need the deployed
// site's address in EXPO_PUBLIC_API_BASE_URL.
function apiUrl(path) {
  if (Platform.OS === 'web') return path;
  const base = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (!base) throw new Error('OGD setup is available on the web app only in this build.');
  return `${base.replace(/\/$/, '')}${path}`;
}

async function request(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Please sign in again.');

  const response = await fetch(apiUrl(path), {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || 'The server could not complete this request.');
  return payload;
}

export async function fetchOgdChapters(scope) {
  const { chapters } = await request(`/api/ogd/chapters?scope=${encodeURIComponent(scope)}`);
  return chapters;
}

export function saveOgdCredential({ scope, areaId, identifier, password }) {
  return request('/api/ogd/credentials', { method: 'POST', body: JSON.stringify({ scope, areaId, identifier, password }) });
}

export function fetchPastoralReports() {
  return request('/api/ogd/reports');
}

export function checkPastoralReport({ areaId }) {
  return request('/api/ogd/check-report', { method: 'POST', body: JSON.stringify({ areaId }) });
}

export function runOgdTestLogin({ scope, areaId }) {
  return request('/api/ogd/test-login', { method: 'POST', body: JSON.stringify({ scope, areaId }) });
}
