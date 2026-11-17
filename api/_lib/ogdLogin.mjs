// Drives the OGD login form and, when OGD asks for one, enters the emailed
// OTP. OTP values and passwords are never logged or returned.
export const OGD_LOGIN_URL = 'https://cfcglobaldata.com/login.aspx?ReturnUrl=%2fdefault.aspx';

const NAVIGATION_TIMEOUT_MS = 30000;
// How long a blank or in-between page may take to turn into a known step.
const SETTLE_TIMEOUT_MS = 20000;
const SETTLE_POLL_MS = 1000;
const SIGNED_IN_TEXT_PATTERN = /log\s?out|sign\s?out|members database/i;
const OTP_FIELD_PATTERN = /otp|one.?time|passcode|verif|token|code|\bpin\b/i;
const OTP_TEXT_PATTERN = /\bOTP\b|one[\s-]?time|verification code|security code|authentication code/i;
const SKIPPED_BUTTON_PATTERN = /resend|cancel|back|forgot/i;
const SUBMIT_BUTTON_PATTERN = /verify|submit|confirm|continue|proceed|log\s?in|sign\s?in|\bok\b/i;

export class AutomationFailure extends Error {
  constructor(code, detail) {
    super(detail);
    this.code = code;
  }
}

// Decides which step a page represents from a snapshot that holds no field
// values. "connected" requires reaching default.aspx, the page OGD's own
// ReturnUrl sends a signed-in user to, so an unrecognized interstitial is
// reported instead of being mistaken for success.
export function classifyPage({ path, inputs, text }) {
  if (inputs.some((input) => input.id === 'txtPassword')) return { state: 'login' };

  const candidates = inputs.filter((input) => input.id !== 'txtUsername');
  const named = candidates.find((input) => OTP_FIELD_PATTERN.test(`${input.id} ${input.name} ${input.placeholder}`));
  const otpInput = named ?? (OTP_TEXT_PATTERN.test(text) ? candidates[0] : undefined);
  if (otpInput) return { state: 'otp', otpInput };

  if (/\/default\.aspx$/i.test(path)) return { state: 'connected' };
  // The site root serves the same signed-in page when OGD redirects there.
  if (path === '/' && SIGNED_IN_TEXT_PATTERN.test(text)) return { state: 'connected' };
  return { state: 'unexpected' };
}

function describePage({ path, title, inputs, text }) {
  const fields = inputs.map((input) => input.id || input.name || input.type).join(', ') || 'none';
  const shown = text.replace(/\s+/g, ' ').trim().slice(0, 120);
  return `Page ${path} titled "${title}", fields: ${fields}, text: "${shown}"`;
}

function snapshotPage(page) {
  return page.evaluate(() => {
    const isVisible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const inputs = [...document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio])')]
      .filter(isVisible)
      .map((el) => ({ id: el.id, name: el.name, type: el.type, placeholder: el.placeholder }));
    const loginError = (document.getElementById('lblError')?.innerText || '').trim().slice(0, 200);
    return { path: location.pathname, title: document.title, inputs, text: (document.body?.innerText || '').slice(0, 4000), loginError };
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
// submit, so an unrecognized page is looked at again until it settles.
async function settledStep(page) {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  for (;;) {
    const snapshot = await snapshotPage(page).catch(() => null);
    const step = snapshot ? classifyPage(snapshot) : { state: 'unexpected' };
    if ((snapshot && step.state !== 'unexpected') || Date.now() >= deadline) {
      return { snapshot: snapshot ?? (await snapshotPage(page)), step };
    }
    await page.waitForLoadState('load', { timeout: SETTLE_POLL_MS }).catch(() => null);
    await page.waitForTimeout(SETTLE_POLL_MS);
  }
}

// Resolves to { otpRequired, afterLoginResult } when OGD reaches its signed-in
// page and throws AutomationFailure otherwise. readOtp({ sinceEpochSeconds })
// supplies the OTP; the optional afterLogin(page) runs on the signed-in page.
export async function loginToOgd({ browser, username, password, readOtp, afterLogin, loginUrl = OGD_LOGIN_URL }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  let dialogMessage = null;
  page.on('dialog', async (dialog) => {
    dialogMessage = dialog.message().slice(0, 200);
    await dialog.accept();
  });

  await page.goto(loginUrl, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT_MS });
  // OGD fills this field from script once its browser detection has loaded.
  await page
    .waitForFunction(() => document.getElementById('hdnDeviceID')?.value !== '', null, { timeout: 10000 })
    .catch(() => null);

  await page.locator('#txtUsername').fill(username);
  await page.locator('#txtPassword').fill(password);

  // Small allowance for clock drift. It stays well under the 60-second retry
  // cooldown so a retry cannot pick up the previous attempt's OTP.
  const sinceEpochSeconds = Math.floor(Date.now() / 1000) - 15;
  await submitAndSettle(page, () => page.locator('#btnLogin').click());

  const { snapshot: afterPassword, step: firstStep } = await settledStep(page);

  if (firstStep.state === 'connected') return { otpRequired: false, afterLoginResult: await afterLogin?.(page) };
  if (firstStep.state === 'login') {
    const reason = afterPassword.loginError || dialogMessage;
    throw new AutomationFailure('ogd_bad_credentials', reason ? `OGD says: ${reason}` : 'OGD returned to its login form without giving a reason.');
  }
  if (firstStep.state === 'unexpected') throw new AutomationFailure('unexpected_page', describePage(afterPassword));

  const otp = await readOtp({ sinceEpochSeconds });
  dialogMessage = null;
  const field = otpLocator(page, firstStep.otpInput);
  await field.fill(otp);

  const button = await findOtpSubmitButton(page);
  await submitAndSettle(page, () => (button ? button.click() : field.press('Enter')));

  const { snapshot: afterOtp, step: finalStep } = await settledStep(page);
  if (finalStep.state === 'connected') return { otpRequired: true, afterLoginResult: await afterLogin?.(page) };
  if (finalStep.state === 'otp' || finalStep.state === 'login') {
    throw new AutomationFailure('otp_rejected', dialogMessage || 'OGD did not accept the code from the email.');
  }
  throw new AutomationFailure('unexpected_page', describePage(afterOtp));
}
