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

export const FAILURE_MESSAGES = {
  ogd_bad_credentials: 'OGD did not accept this login.',
  otp_rejected: 'OGD did not accept the emailed code.',
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
};
