import { supabase } from './supabase';

async function request(path, options = {}) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('Please sign in again.');
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || 'The server could not complete this request.');
  return payload;
}

export async function fetchOgdChapters(scope) {
  return (await request(`/api/ogd/chapters?scope=${encodeURIComponent(scope)}`)).chapters;
}

export function saveOgdCredential(values) {
  return request('/api/ogd/credentials', { method: 'POST', body: JSON.stringify(values) });
}

export function runOgdTestLogin(values) {
  return request('/api/ogd/test-login', { method: 'POST', body: JSON.stringify(values) });
}

export function fetchPastoralReports() {
  return request('/api/ogd/reports');
}

export function checkPastoralReport(values) {
  return request('/api/ogd/check-report', { method: 'POST', body: JSON.stringify(values) });
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
};
