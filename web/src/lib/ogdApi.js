import { supabase } from './supabase';

async function request(path, options = {}) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('Please sign in again.');
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` } });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) {
    const error = new Error(payload?.error || 'The server could not complete this request.');
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function fetchOgdChapters(scope) {
  return (await request(`/api/ogd/chapters?scope=${encodeURIComponent(scope)}`)).chapters;
}

export function saveOgdCredential(values) {
  return request('/api/ogd/credentials', { method: 'POST', body: JSON.stringify(values) });
}

export function runOgdTestLogin(values) {
  return request('/api/ogd/browser?task=test-login', { method: 'POST', body: JSON.stringify(values) });
}

// Touches each saved OGD session so it does not time out while Oracle is open.
export function keepOgdSessionsAlive() {
  return request('/api/ogd/keepalive', { method: 'POST', body: '{}' });
}

export function syncOgdMembers(values) {
  return request('/api/ogd/browser?task=sync-members', { method: 'POST', body: JSON.stringify(values) });
}

// Returns { changes, pushProgress }.
export async function fetchOgdChanges(scope) {
  const { changes, pushProgress } = await request(`/api/ogd/changes?scope=${encodeURIComponent(scope)}`);
  return { changes, pushProgress: pushProgress ?? [] };
}

// action: 'discard' (drop from the queue) or 'revert' (also restore Oracle's old value).
export function updateOgdChanges(values) {
  return request('/api/ogd/changes', { method: 'POST', body: JSON.stringify(values) });
}

export function pushOgdChanges(values) {
  return request('/api/ogd/browser?task=push-changes', { method: 'POST', body: JSON.stringify(values) });
}

export function fetchPastoralReports() {
  return request('/api/ogd/reports');
}

export function checkPastoralReport(values) {
  return request('/api/ogd/browser?task=check-report', { method: 'POST', body: JSON.stringify(values) });
}

export function fetchCelebrants(month) {
  return request(`/api/ogd/celebrants?month=${encodeURIComponent(month)}`);
}

export function generateCelebrants(values) {
  return request('/api/ogd/browser?task=celebrants', { method: 'POST', body: JSON.stringify(values) });
}

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

export function syncActivities(values) {
  return request('/api/ogd/browser?task=sync-activities', { method: 'POST', body: JSON.stringify(values) });
}

export function pushActivity(activityId) {
  return request('/api/ogd/browser?task=push-activity', { method: 'POST', body: JSON.stringify({ activityId }) });
}

// The live progress of a push while it runs, or null.
export async function fetchActivityProgress(activityId) {
  return (await request(`/api/ogd/activities?progress=${encodeURIComponent(activityId)}`)).progress ?? null;
}

export function pushActivityAttendees(activityId) {
  return request('/api/ogd/browser?task=push-attendees', { method: 'POST', body: JSON.stringify({ activityId }) });
}

export function readActivityForm(areaId) {
  return request('/api/ogd/browser?task=read-activity-form', { method: 'POST', body: JSON.stringify({ areaId }) });
}

export const FAILURE_MESSAGES = {
  ogd_bad_credentials: 'The Members Portal did not accept this login.',
  otp_rejected: 'The emailed code was not accepted.',
  portal_ogd_missing: 'Signed in to the Members Portal, but it offers no One Global Data access for this account.',
  sso_failed: 'The Members Portal could not sign in to OGD.',
  otp_not_found: 'No OTP email reached this Gmail in time.',
  gmail_bad_password: 'Google rejected this Gmail address and App Password. Check them, or create a new App Password.',
  gmail_connection_error: 'Could not connect to Gmail. Please try again.',
  unexpected_page: 'OGD showed a page the automation does not recognize.',
  run_interrupted: 'The last login did not finish. Please try again.',
  automation_error: 'The automated browser hit an error.',
  report_page_unexpected: 'Signed in, but could not read the Pastoral Report page.',
  members_page_unexpected: 'Signed in, but could not read the Members Database list.',
  celebrants_link_missing: 'Signed in, but could not find the Celebrants page in OGD.',
  celebrants_form_unexpected: 'Signed in, but could not fill in the Celebrants form.',
  celebrants_result_unexpected: 'Signed in, but could not read the celebrant list.',
  activities_page_unexpected: 'Signed in, but could not read the Activities page in OGD.',
  activity_form_unexpected: 'Signed in, but could not fill in OGD\'s New Activity form. Nothing was saved in OGD.',
  activity_save_failed: 'OGD did not save the new activity.',
  activity_attendees_unexpected: 'Signed in, but could not add every attendee in OGD.',
};
