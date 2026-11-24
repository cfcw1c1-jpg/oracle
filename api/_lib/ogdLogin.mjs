// Signs in to OGD the way a person now does: log in to the CFC Members
// Portal (entering the emailed OTP when the portal asks for one), open its
// One Global Data page, press Continue and accept the "Login to this OGD?"
// prompt, which signs the browser in to cfcglobaldata.com (SSO). OTP values
// and passwords are never logged or returned.
export const PORTAL_URL = 'https://membersportal.couplesforchristglobal.org/';
const PORTAL_OGD_URL = new URL('/ogd.aspx', PORTAL_URL).href;
// OGD's own home page. The SSO may land on www. or the bare domain, so the
// one actually reached is saved with the session (see ogdHomeUrl).
export const OGD_HOME_URL = 'https://cfcglobaldata.com/default.aspx';
const OGD_HOST_PATTERN = /(^|\.)cfcglobaldata\.com$/i;

const NAVIGATION_TIMEOUT_MS = 30000;
// How long a blank or in-between page may take to turn into a known step.
const SETTLE_TIMEOUT_MS = 20000;
const SETTLE_POLL_MS = 1000;
const SIGNED_IN_TEXT_PATTERN = /log\s?out|sign\s?out|members database/i;
// A still-blank page this long after a submit is nudged to the home page once.
const BLANK_NUDGE_AFTER_MS = 6000;
const LOGOUT_TIMEOUT_MS = 10000;
const OTP_FIELD_PATTERN = /otp|one.?time|passcode|verif|token|code|\bpin\b/i;
const OTP_TEXT_PATTERN = /\bOTP\b|one[\s-]?time|verification code|security code|authentication code/i;
const SKIPPED_BUTTON_PATTERN = /resend|cancel|back|forgot/i;
const SUBMIT_BUTTON_PATTERN = /verify|submit|confirm|continue|proceed|log\s?in|sign\s?in|\bok\b/i;
// Login name fields of the portal and of OGD, never mistaken for an OTP box.
const USERNAME_FIELD_IDS = new Set(['txtUsername', 'txtMemberIDNo']);

export class AutomationFailure extends Error {
  constructor(code, detail) {
    super(detail);
    this.code = code;
  }
}

function findOtpInput(inputs, text) {
  const candidates = inputs.filter((input) => !USERNAME_FIELD_IDS.has(input.id));
  const named = candidates.find((input) => OTP_FIELD_PATTERN.test(`${input.id} ${input.name} ${input.placeholder}`));
  return named ?? (OTP_TEXT_PATTERN.test(text) ? candidates[0] : undefined);
}

// Decides which step a page represents from a snapshot that holds no field
// values. "connected" requires reaching default.aspx, the page OGD's own
// ReturnUrl sends a signed-in user to, so an unrecognized interstitial is
// reported instead of being mistaken for success.
export function classifyPage({ path, inputs, text }) {
  if (inputs.some((input) => input.id === 'txtPassword')) return { state: 'login' };

  const otpInput = findOtpInput(inputs, text);
  if (otpInput) return { state: 'otp', otpInput };

  if (/\/default\.aspx$/i.test(path)) return { state: 'connected' };
  // The site root serves the same signed-in page when OGD redirects there.
  if (path === '/' && SIGNED_IN_TEXT_PATTERN.test(text)) return { state: 'connected' };
  return { state: 'unexpected' };
}

// The same for a Members Portal page. Any page that is neither its login
// form nor an OTP form means the portal has signed the account in.
export function classifyPortalPage({ inputs, text }) {
  if (inputs.some((input) => input.id === 'txtPassword')) return { state: 'login' };
  const otpInput = findOtpInput(inputs, text);
  if (otpInput) return { state: 'otp', otpInput };
  if (!inputs.length && !text.trim()) return { state: 'unexpected' };
  return { state: 'signed_in' };
}

function describePage({ host, path, title, inputs, text }) {
  const fields = inputs.map((input) => input.id || input.name || input.type).join(', ') || 'none';
  const shown = text.replace(/\s+/g, ' ').trim().slice(0, 120);
  return `Page ${host ?? ''}${path} titled "${title}", fields: ${fields}, text: "${shown}"`;
}

function snapshotPage(page) {
  return page.evaluate(() => {
    const isVisible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const inputs = [...document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio])')]
      .filter(isVisible)
      .map((el) => ({ id: el.id, name: el.name, type: el.type, placeholder: el.placeholder }));
    const loginError = (document.getElementById('lblError')?.innerText || '').trim().slice(0, 200);
    return { host: location.hostname, path: location.pathname, title: document.title, inputs, text: (document.body?.innerText || '').slice(0, 4000), loginError };
  });
}

// Waits for the page load a submit causes. A postback that does not navigate
// simply runs out the timeout and is then inspected as-is.
export async function submitAndSettle(page, submit) {
  const loaded = page.waitForEvent('load', { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => null);
  await submit();
  await loaded;
}

function otpLocator(page, otpInput) {
  if (otpInput.id) return page.locator(`[id="${otpInput.id}"]`);
  if (otpInput.name) return page.locator(`[name="${otpInput.name}"]`);
  return page.locator('input:visible').first();
}

async function findOtpSubmitButton(page) {
  const buttons = page.locator('input[type=submit]:visible, input[type=button]:visible, button:visible');
  let fallback = null;
  for (let index = 0; index < (await buttons.count()); index += 1) {
    const button = buttons.nth(index);
    const label = (await button.getAttribute('value')) || (await button.innerText());
    if (SKIPPED_BUTTON_PATTERN.test(label)) continue;
    if (SUBMIT_BUTTON_PATTERN.test(label)) return button;
    fallback = fallback ?? button;
  }
  return fallback;
}

// OGD sometimes passes through a blank page (or redirects by script) after a
// submit, so an unrecognized page is looked at again until it settles. A page
// that stays completely blank is sent to OGD's home page once, which is where
// a signed-in browser lands anyway.
async function settledStep(page, homeUrl, classify = classifyPage) {
  const startedAt = Date.now();
  let nudged = false;
  for (;;) {
    const snapshot = await snapshotPage(page).catch(() => null);
    const step = snapshot ? classify(snapshot) : { state: 'unexpected' };
    if ((snapshot && step.state !== 'unexpected') || Date.now() - startedAt >= SETTLE_TIMEOUT_MS) {
      return { snapshot: snapshot ?? (await snapshotPage(page)), step };
    }
    const isBlank = snapshot && !snapshot.inputs.length && !snapshot.text.trim();
    if (isBlank && !nudged && Date.now() - startedAt >= BLANK_NUDGE_AFTER_MS) {
      nudged = true;
      await page.goto(homeUrl, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT_MS }).catch(() => null);
      continue;
    }
    await page.waitForLoadState('load', { timeout: SETTLE_POLL_MS }).catch(() => null);
    await page.waitForTimeout(SETTLE_POLL_MS);
  }
}

// Ends the OGD session so the next run's sign-in is not refused while this
// one still looks active. Best effort: a run never fails because of it.
async function logOut(page) {
  try {
    const clicked = await page.evaluate(() => {
      const link = [...document.querySelectorAll('a, input[type=submit], input[type=button], button')].find((el) =>
        /^\s*(log\s?out|sign\s?out)\s*$/i.test(el.innerText || el.value || ''),
      );
      if (!link) return false;
      link.click();
      return true;
    });
    if (clicked) await page.waitForEvent('load', { timeout: LOGOUT_TIMEOUT_MS }).catch(() => null);
  } catch {
    // The browser closes right after this, which drops the session anyway.
  }
}

// session.state is filled with the browser's cookies once signed in and again
// after afterLogin, even when afterLogin fails, so the caller can save them.
// With keepSession the run does not log out, leaving those cookies valid.
async function runSignedIn(page, flags, afterLogin, { keepSession, session }) {
  // The browser's user agent is kept with the cookies so the keep-alive
  // request (ogdSession.mjs) looks like the same browser.
  const capture = async () => {
    if (!keepSession) return;
    const [state, userAgent] = await Promise.all([
      page.context().storageState().catch(() => null),
      page.evaluate(() => navigator.userAgent).catch(() => null),
    ]);
    const ogdHomeUrl = new URL('/default.aspx', page.url()).href;
    if (state) session.state = { ...state, userAgent: userAgent ?? session.state?.userAgent ?? null, ogdHomeUrl };
  };
  await capture();
  try {
    return { ...flags, afterLoginResult: await afterLogin?.(page) };
  } finally {
    if (keepSession) await capture();
    else await logOut(page);
  }
}

// Opens OGD's home page with saved cookies. True when OGD still treats them as
// signed in; otherwise OGD's cookies are dropped so the SSO starts clean. The
// Members Portal's cookies are kept: while that session lasts, the portal
// goes straight to its One Global Data page with no password or OTP.
async function resumeSession(page, homeUrl) {
  await page.goto(homeUrl, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT_MS }).catch((error) => {
    // The browser itself failing is not OGD turning the cookies down.
    if (/net::ERR_(INSUFFICIENT_RESOURCES|OUT_OF_MEMORY)|Target (page|crashed)|has been closed/i.test(error?.message ?? '')) throw error;
    return null;
  });
  const { step } = await settledStep(page, homeUrl).catch(() => ({ step: { state: 'unexpected' } }));
  if (step.state === 'connected') return true;
  await page.context().clearCookies({ domain: /cfcglobaldata\.com$/i }).catch(() => null);
  return false;
}

// Fills and submits the OTP box a page shows, then waits for the next step.
async function enterOtp(page, otpInput, otp) {
  const field = otpLocator(page, otpInput);
  await field.fill(otp);
  const button = await findOtpSubmitButton(page);
  await submitAndSettle(page, () => (button ? button.click() : field.press('Enter')));
}

// Signs in to the Members Portal (when its session has ended) and leaves the
// page on its One Global Data page. Resolves to whether an OTP was needed.
async function openPortalOgdPage(page, { username, password, readOtp, dialogs }) {
  await page.goto(PORTAL_OGD_URL, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT_MS });
  const { snapshot: opened, step: openedStep } = await settledStep(page, PORTAL_OGD_URL, classifyPortalPage);
  if (openedStep.state === 'signed_in') return { otpRequired: false };
  if (openedStep.state !== 'login') throw new AutomationFailure('unexpected_page', describePage(opened));

  // The portal fills this field from script once its browser detection has loaded.
  await page
    .waitForFunction(() => document.getElementById('hdnDeviceID')?.value !== '', null, { timeout: 10000 })
    .catch(() => null);
  await page.locator('#txtMemberIDNo').fill(username);
  await page.locator('#txtPassword').fill(password);

  // Small allowance for clock drift. It stays well under the 60-second retry
  // cooldown so a retry cannot pick up the previous attempt's OTP.
  const sinceEpochSeconds = Math.floor(Date.now() / 1000) - 15;
  dialogs.last = null;
  await submitAndSettle(page, () => page.locator('#btnLogin').click());

  const { snapshot: afterPassword, step } = await settledStep(page, PORTAL_OGD_URL, classifyPortalPage);
  if (step.state === 'login') {
    const reason = afterPassword.loginError || dialogs.last;
    throw new AutomationFailure('ogd_bad_credentials', reason ? `Members Portal says: ${reason}` : 'The Members Portal returned to its login form without giving a reason.');
  }
  if (step.state === 'unexpected') throw new AutomationFailure('unexpected_page', describePage(afterPassword));

  let otpRequired = false;
  if (step.state === 'otp') {
    otpRequired = true;
    const otp = await readOtp({ sinceEpochSeconds });
    dialogs.last = null;
    await enterOtp(page, step.otpInput, otp);
    const { snapshot: afterOtp, step: otpStep } = await settledStep(page, PORTAL_OGD_URL, classifyPortalPage);
    if (otpStep.state === 'otp' || otpStep.state === 'login') {
      throw new AutomationFailure('otp_rejected', dialogs.last || afterOtp.loginError || 'The Members Portal did not accept the code from the email.');
    }
    if (otpStep.state === 'unexpected') throw new AutomationFailure('unexpected_page', describePage(afterOtp));
  }

  // The portal usually lands on its home page after signing in.
  if (!/\/ogd\.aspx$/i.test(new URL(page.url()).pathname)) {
    await page.goto(PORTAL_OGD_URL, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT_MS });
    const { snapshot, step: ogdStep } = await settledStep(page, PORTAL_OGD_URL, classifyPortalPage);
    if (ogdStep.state !== 'signed_in') throw new AutomationFailure('unexpected_page', describePage(snapshot));
  }
  return { otpRequired };
}

// Marks the Continue button of the cfcglobaldata.com card on the portal's
// One Global Data page, preferring that card when the account has several.
function markContinueButton(page) {
  return page.evaluate(() => {
    const isVisible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const controls = [...document.querySelectorAll('a, button, input[type=submit], input[type=button]')]
      .filter(isVisible)
      .filter((el) => /^\s*continue\b/i.test(el.innerText || el.value || ''));
    const cardText = (el) => {
      for (let node = el.parentElement, depth = 0; node && depth < 6; node = node.parentElement, depth += 1) {
        if (/cfcglobaldata/i.test(node.innerText || '')) return true;
      }
      return false;
    };
    const chosen = controls.find(cardText) ?? controls[0];
    if (!chosen) return false;
    chosen.setAttribute('data-oracle-continue', '1');
    return true;
  });
}

const isOgdUrl = (url) => {
  try {
    return OGD_HOST_PATTERN.test(new URL(url).hostname);
  } catch {
    return false;
  }
};

// Presses Continue (the "Login to this OGD?" prompt is accepted by the dialog
// handler) and resolves to the page that reaches cfcglobaldata.com, whether
// the portal opens OGD in the same tab or in a new one.
async function continueToOgd(page) {
  if (!(await markContinueButton(page))) {
    const snapshot = await snapshotPage(page);
    throw new AutomationFailure('portal_ogd_missing', `The Members Portal's One Global Data page has no Continue button. ${describePage(snapshot)}`);
  }

  const context = page.context();
  const reachesOgd = (target) => target
    .waitForURL((url) => OGD_HOST_PATTERN.test(url.hostname), { timeout: NAVIGATION_TIMEOUT_MS, waitUntil: 'commit' })
    .then(() => target, () => null);
  const sameTab = reachesOgd(page);
  let stopWatching = () => {};
  const newTab = new Promise((resolve) => {
    const onPage = async (opened) => {
      const reached = await reachesOgd(opened);
      if (reached) finish(reached);
    };
    const timer = setTimeout(() => finish(null), NAVIGATION_TIMEOUT_MS + 1000);
    function finish(found) {
      clearTimeout(timer);
      context.off('page', onPage);
      resolve(found);
    }
    stopWatching = () => finish(null);
    context.on('page', onPage);
  });

  await page.locator('[data-oracle-continue="1"]').first().click();
  const ogdPage = await Promise.race([
    sameTab.then((found) => found ?? newTab),
    newTab.then((found) => found ?? sameTab),
  ]);
  stopWatching();
  if (!ogdPage) {
    const snapshot = await snapshotPage(page).catch(() => null);
    throw new AutomationFailure('sso_failed', `Pressed Continue, but OGD did not open.${snapshot ? ` ${describePage(snapshot)}` : ''}`);
  }
  await ogdPage.waitForLoadState('load', { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => null);
  return ogdPage;
}

// Resolves to { otpRequired, sessionReused, sessionRejected, afterLoginResult }
// when OGD reaches its signed-in page and throws AutomationFailure otherwise.
// username and password are the Members Portal login; readOtp({
// sinceEpochSeconds }) supplies the emailed OTP; the optional afterLogin(page)
// runs on OGD's signed-in page. storageState (saved cookies) is tried first; a
// full login after it is rejected waits until notBeforeMs, keeping logins
// spaced. Pass a session object to receive the cookies to save; its
// rejected flag is set when OGD turned the saved cookies down.
export async function loginToOgd({
  browser, username, password, readOtp, afterLogin,
  storageState = null, notBeforeMs = 0, keepSession = false, session = {},
}) {
  const context = await browser.newContext(storageState ? { storageState: { cookies: storageState.cookies ?? [], origins: storageState.origins ?? [] } } : undefined);
  const dialogs = { last: null };
  // Accepts every prompt, including the portal's "Login to this OGD?", on
  // this tab and any tab the portal opens.
  const watched = new WeakSet();
  const watchDialogs = (target) => {
    if (watched.has(target)) return;
    watched.add(target);
    target.on('dialog', async (dialog) => {
      dialogs.last = dialog.message().slice(0, 200);
      await dialog.accept().catch(() => null);
    });
  };
  context.on('page', watchDialogs);
  const page = await context.newPage();
  watchDialogs(page);
  const signedIn = { keepSession, session };

  let sessionRejected = false;
  if (storageState) {
    const savedHome = isOgdUrl(storageState.ogdHomeUrl) ? storageState.ogdHomeUrl : OGD_HOME_URL;
    if (await resumeSession(page, savedHome)) return runSignedIn(page, { otpRequired: false, sessionReused: true, sessionRejected }, afterLogin, signedIn);
    sessionRejected = true;
    session.rejected = true;
    const wait = notBeforeMs - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
  }

  let { otpRequired } = await openPortalOgdPage(page, { username, password, readOtp, dialogs });
  dialogs.last = null;
  // An OTP OGD itself sends is newer than this; the portal's is older.
  const sinceEpochSeconds = Math.floor(Date.now() / 1000) - 5;
  const ogdPage = await continueToOgd(page);
  const ogdHome = new URL('/default.aspx', ogdPage.url()).href;
  const flags = () => ({ otpRequired, sessionReused: false, sessionRejected });

  const { snapshot: landed, step } = await settledStep(ogdPage, ogdHome);
  if (step.state === 'connected') return runSignedIn(ogdPage, flags(), afterLogin, signedIn);
  if (step.state === 'login') {
    throw new AutomationFailure('sso_failed', dialogs.last ? `OGD says: ${dialogs.last}` : 'The Members Portal sent the browser to OGD, but OGD showed its own login form instead of signing in.');
  }
  if (step.state === 'unexpected') throw new AutomationFailure('unexpected_page', describePage(landed));

  // OGD itself may still ask for an emailed code after the SSO.
  otpRequired = true;
  const otp = await readOtp({ sinceEpochSeconds });
  dialogs.last = null;
  await enterOtp(ogdPage, step.otpInput, otp);
  const { snapshot: afterOtp, step: finalStep } = await settledStep(ogdPage, ogdHome);
  if (finalStep.state === 'connected') return runSignedIn(ogdPage, flags(), afterLogin, signedIn);
  if (finalStep.state === 'otp' || finalStep.state === 'login') {
    throw new AutomationFailure('otp_rejected', dialogs.last || 'OGD did not accept the code from the email.');
  }
  throw new AutomationFailure('unexpected_page', describePage(afterOtp));
}
