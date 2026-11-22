import { Platform } from 'react-native';
import { supabase } from '../../lib/supabase';

// The web app shares an origin with /api. Native builds call the deployed
// site, or EXPO_PUBLIC_API_BASE_URL when a build sets another one.
const DEFAULT_API_BASE_URL = 'https://oracle-cfc.vercel.app';
function apiUrl(path) {
  if (Platform.OS === 'web') return path;
  const base = process.env.EXPO_PUBLIC_API_BASE_URL || DEFAULT_API_BASE_URL;
  return `${base.replace(/\/$/, '')}${path}`;
}

// The public site, for attendance links shared from the app.
export function siteUrl(path) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') return `${window.location.origin}${path}`;
  return `${(process.env.EXPO_PUBLIC_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/$/, '')}${path}`;
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

// ---------- Activities ----------

export function fetchActivities(from, to) {
  return request(`/api/ogd/activities?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
}

export async function fetchActivityMembers(areaId) {
  return (await request('/api/ogd/activities', { method: 'POST', body: JSON.stringify({ action: 'members', areaId }) })).members;
}

export async function saveActivity(activity) {
  return (await request('/api/ogd/activities', { method: 'POST', body: JSON.stringify({ action: 'save', activity }) })).activity;
}

export function deleteActivity(id) {
  return request('/api/ogd/activities', { method: 'POST', body: JSON.stringify({ action: 'delete', id }) });
}

// add: Member IDs to add; remove: attendee keys ("id:PM-..." or "name:...").
export async function updateActivityAttendees(id, { add = [], remove = [] }) {
  return (await request('/api/ogd/activities', { method: 'POST', body: JSON.stringify({ action: 'attendees', id, add, remove }) })).activity;
}

export function syncActivities({ areaId, from, to }) {
  return request('/api/ogd/browser?task=sync-activities', { method: 'POST', body: JSON.stringify({ areaId, from, to }) });
}

export function pushActivity(activityId) {
  return request('/api/ogd/browser?task=push-activity', { method: 'POST', body: JSON.stringify({ activityId }) });
}

export function pushActivityAttendees(activityId) {
  return request('/api/ogd/browser?task=push-attendees', { method: 'POST', body: JSON.stringify({ activityId }) });
}
