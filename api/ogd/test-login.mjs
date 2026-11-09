import { authorize, HttpError, route } from '../_lib/access.mjs';
import { launchBrowser } from '../_lib/browser.mjs';
import { createGmailOtpReader } from '../_lib/gmailOtp.mjs';
import { AutomationFailure, loginToOgd } from '../_lib/ogdLogin.mjs';
import { decryptSecret } from '../_lib/secrets.mjs';

// Repeated failures can lock an OGD or Gmail account, so attempts are spaced.
const COOLDOWN_MS = 60 * 1000;
const STALE_RUN_MS = 5 * 60 * 1000;

function scrub(text, secrets) {
  return secrets.reduce((result, secret) => result.split(secret).join('[hidden]'), String(text).slice(0, 500));
}

// One conditional update, so two simultaneous requests cannot both start.
async function claimRun(db, areaId, userId) {
  const now = Date.now();
  const cooldownCutoff = new Date(now - COOLDOWN_MS).toISOString();
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

async function attemptLogin(row, areaId) {
  const ogdPassword = decryptSecret(row.ogd_password_enc, areaId, 'ogd');
  const gmailPassword = decryptSecret(row.gmail_password_enc, areaId, 'gmail');
  const secrets = [ogdPassword, gmailPassword];

  let browser;
  try {
    browser = await launchBrowser();
    const readOtp = createGmailOtpReader({ address: row.gmail_address, password: gmailPassword });
    const { otpRequired } = await loginToOgd({ browser, username: row.ogd_username, password: ogdPassword, readOtp });
    return {
      status: 'connected',
      failure_code: null,
      status_detail: otpRequired ? 'Signed in to OGD using the emailed OTP.' : 'Signed in to OGD. No OTP was requested.',
    };
  } catch (error) {
    if (error instanceof AutomationFailure) {
      return { status: 'failed', failure_code: error.code, status_detail: scrub(error.message, secrets) };
    }
    console.error('[ogd] automation error:', scrub(error?.message, secrets));
    return { status: 'failed', failure_code: 'automation_error', status_detail: scrub(error?.message?.split('\n')[0] ?? 'Unknown error', secrets) };
  } finally {
    await browser?.close().catch(() => null);
  }
}

export const POST = route(async (request) => {
  const body = await request.json().catch(() => null);
  if (!body) throw new HttpError(400, 'Invalid request.');

  const { db, userId, chapters } = await authorize(request, body.scope);
  const areaId = Number(body.areaId);
  if (!chapters.some((chapter) => chapter.areaId === areaId)) throw new HttpError(403, 'You cannot manage this chapter.');

  const { data: row, error } = await db
    .from('ogd_chapter_connections')
    .select('gmail_address, gmail_password_enc, ogd_username, ogd_password_enc')
    .eq('area_id', areaId)
    .maybeSingle();
  if (error) throw error;
  if (!row?.gmail_password_enc || !row?.ogd_password_enc) {
    throw new HttpError(409, 'This chapter needs both its Gmail and its OGD login before it can be tested.');
  }

  if (!(await claimRun(db, areaId, userId))) {
    throw new HttpError(429, 'A login was attempted for this chapter moments ago. Please wait a minute and try again.');
  }

  const result = await attemptLogin(row, areaId).catch((failure) => {
    console.error('[ogd] could not start attempt:', failure?.message);
    return { status: 'failed', failure_code: 'automation_error', status_detail: 'The saved credentials could not be read. Please save them again.' };
  });

  const finishedAt = new Date().toISOString();
  const { error: updateError } = await db
    .from('ogd_chapter_connections')
    .update({ ...result, updated_at: finishedAt, ...(result.status === 'connected' ? { last_success_at: finishedAt } : {}) })
    .eq('area_id', areaId);
  if (updateError) throw updateError;

  return { status: result.status, failureCode: result.failure_code, statusDetail: result.status_detail };
});
