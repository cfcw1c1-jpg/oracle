import { HttpError } from './access.mjs';
import { launchBrowser } from './browser.mjs';
import { createGmailOtpReader } from './gmailOtp.mjs';
import { AutomationFailure, loginToOgd } from './ogdLogin.mjs';
import { decryptSecret, encryptSecret } from './secrets.mjs';

// Repeated failures can lock a Members Portal or Gmail account, so logins are spaced.
const COOLDOWN_MS = 60 * 1000;
// A run that will likely reuse a saved session needs no login, so it may
// follow the last one sooner. If the session turns out to be rejected, the
// login still waits out the full COOLDOWN_MS (see notBeforeMs).
const SESSION_COOLDOWN_MS = 10 * 1000;
const STALE_RUN_MS = 5 * 60 * 1000;
const RUN_LIMIT_MS = 285 * 1000;

// Saved OGD sessions. One older than SESSION_MAX_AGE_MS is not tried. One
// rejected while younger than SESSION_TRUSTED_MS should still have been valid,
// which means OGD does not accept sessions moved between servers, so reuse is
// switched off for that chapter for REUSE_OFF_MS and runs log out as before.
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const SESSION_TRUSTED_MS = 10 * 60 * 1000;
const REUSE_OFF_MS = 24 * 60 * 60 * 1000;

function scrub(text, secrets) {
  return secrets.reduce((result, secret) => result.split(secret).join('[hidden]'), String(text).slice(0, 500));
}

// One conditional update, so two simultaneous requests cannot both start.
async function claimRun(db, areaId, userId, cooldownMs) {
  const now = Date.now();
  const cooldownCutoff = new Date(now - cooldownMs).toISOString();
  const staleCutoff = new Date(now - STALE_RUN_MS).toISOString();
  const { data, error } = await db
    .from('ogd_chapter_connections')
    .update({
      status: 'running',
      failure_code: null,
      status_detail: null,
      last_attempt_at: new Date(now).toISOString(),
      last_attempt_by: userId,
    })
    .eq('area_id', areaId)
    .or(`last_attempt_at.is.null,and(status.neq.running,last_attempt_at.lt."${cooldownCutoff}"),last_attempt_at.lt."${staleCutoff}"`)
    .select('area_id');
  if (error) throw error;
  return data.length > 0;
}

// The saved cookies, or null when there are none worth trying.
export function savedSession(row, areaId, now) {
  if (!row.ogd_session_enc || !row.ogd_session_saved_at) return null;
  if (now - new Date(row.ogd_session_saved_at).getTime() > SESSION_MAX_AGE_MS) return null;
  try {
    return JSON.parse(decryptSecret(row.ogd_session_enc, areaId, 'session'));
  } catch {
    return null;
  }
}

export function isReuseOff(row, now) {
  return Boolean(row.ogd_session_reuse_off_until && new Date(row.ogd_session_reuse_off_until).getTime() > now);
}

function successDetail({ otpRequired, sessionReused }) {
  if (sessionReused) return 'Signed in to OGD using the saved session. No login or OTP was needed.';
  return otpRequired
    ? 'Signed in to OGD through the Members Portal using the emailed OTP.'
    : 'Signed in to OGD through the Members Portal. No OTP was requested.';
}

async function attemptLogin(row, areaId, afterLogin, { storageState, notBeforeMs, keepSession }) {
  // ogd_username and ogd_password_enc hold the Members Portal login.
  const ogdPassword = decryptSecret(row.ogd_password_enc, areaId, 'ogd');
  const gmailPassword = decryptSecret(row.gmail_password_enc, areaId, 'gmail');
  const secrets = [ogdPassword, gmailPassword];
  const session = { state: null, rejected: false };

  let browser;
  let isOutOfTime = false;
  // Close the browser before Vercel's 300s limit cuts the request off, so the
  // run still records how it ended instead of staying "running".
  const guard = setTimeout(() => {
    isOutOfTime = true;
    browser?.close().catch(() => null);
  }, RUN_LIMIT_MS);
  try {
    browser = await launchBrowser();
    const readOtp = createGmailOtpReader({ address: row.gmail_address, password: gmailPassword });
    const login = await loginToOgd({
      browser, username: row.ogd_username, password: ogdPassword, readOtp, afterLogin, storageState, notBeforeMs, keepSession, session,
    });
    return {
      status: 'connected',
      failure_code: null,
      status_detail: successDetail(login),
      afterLoginResult: login.afterLoginResult,
      sessionState: session.state,
      sessionRejected: login.sessionRejected,
    };
  } catch (error) {
    // A failure after signing in (session.state is set) still leaves a usable session.
    const base = { sessionState: session.state, sessionRejected: session.rejected };
    if (error instanceof AutomationFailure) {
      return { ...base, status: 'failed', failure_code: error.code, status_detail: scrub(error.message, secrets) };
    }
    if (isOutOfTime) {
      return { ...base, status: 'failed', failure_code: 'automation_error', status_detail: 'OGD took too long to answer, so the run was stopped. Please try again.' };
    }
    console.error('[ogd] automation error:', scrub(error?.message, secrets));
    return { ...base, status: 'failed', failure_code: 'automation_error', status_detail: scrub(error?.message?.split('\n')[0] ?? 'Unknown error', secrets) };
  } finally {
    clearTimeout(guard);
    await browser?.close().catch(() => null);
  }
}

// What to store about the session after a run: the new cookies, or nothing
// when the run never got signed in.
function sessionColumns(result, row, areaId, now) {
  const columns = {};
  if (result.sessionState) {
    try {
      columns.ogd_session_enc = encryptSecret(JSON.stringify(result.sessionState), areaId, 'session');
      columns.ogd_session_saved_at = new Date(now).toISOString();
    } catch (error) {
      console.error('[ogd] could not save the session:', error?.message);
    }
  } else if (result.sessionRejected || result.status === 'failed') {
    columns.ogd_session_enc = null;
    columns.ogd_session_saved_at = null;
  }
  const savedAt = row.ogd_session_saved_at ? new Date(row.ogd_session_saved_at).getTime() : 0;
  if (result.sessionRejected && now - savedAt < SESSION_TRUSTED_MS) {
    console.log(`[ogd] area ${areaId}: OGD rejected a fresh saved session; reuse is off for 24 hours`);
    columns.ogd_session_reuse_off_until = new Date(now + REUSE_OFF_MS).toISOString();
    columns.ogd_session_enc = null;
    columns.ogd_session_saved_at = null;
  }
  return columns;
}

// Signs a chapter in to OGD, optionally runs afterLogin on the signed-in page,
// and records the outcome as the chapter's connection status.
export async function runChapterLogin({ db, areaId, userId, afterLogin }) {
  const { data: row, error } = await db
    .from('ogd_chapter_connections')
    .select('gmail_address, gmail_password_enc, ogd_username, ogd_password_enc, last_attempt_at, ogd_session_enc, ogd_session_saved_at, ogd_session_reuse_off_until')
    .eq('area_id', areaId)
    .maybeSingle();
  if (error) throw error;
  if (!row?.gmail_password_enc || !row?.ogd_password_enc) {
    throw new HttpError(409, 'This chapter needs both its Members Portal login and its Gmail first.');
  }

  const startedAt = Date.now();
  const keepSession = !isReuseOff(row, startedAt);
  const storageState = keepSession ? savedSession(row, areaId, startedAt) : null;
  const isFreshSession = Boolean(storageState) && startedAt - new Date(row.ogd_session_saved_at).getTime() < SESSION_TRUSTED_MS;

  if (!(await claimRun(db, areaId, userId, isFreshSession ? SESSION_COOLDOWN_MS : COOLDOWN_MS))) {
    throw new HttpError(429, 'A login was attempted for this chapter moments ago. Please wait a minute and try again.');
  }

  // A login after a rejected session still keeps a minute from the last attempt.
  const notBeforeMs = row.last_attempt_at ? new Date(row.last_attempt_at).getTime() + COOLDOWN_MS : 0;
  const result = await attemptLogin(row, areaId, afterLogin, { storageState, notBeforeMs, keepSession }).catch((failure) => {
    console.error('[ogd] could not start attempt:', failure?.message);
    return { status: 'failed', failure_code: 'automation_error', status_detail: 'The saved credentials could not be read. Please save them again.' };
  });

  const { afterLoginResult, sessionState: _state, sessionRejected: _rejected, ...statusColumns } = result;
  const finishedAt = new Date().toISOString();
  const { error: updateError } = await db
    .from('ogd_chapter_connections')
    .update({
      ...statusColumns,
      ...sessionColumns(result, row, areaId, Date.now()),
      updated_at: finishedAt,
      ...(result.status === 'connected' ? { last_success_at: finishedAt } : {}),
    })
    .eq('area_id', areaId);
  if (updateError) throw updateError;

  return { ...statusColumns, afterLoginResult };
}
