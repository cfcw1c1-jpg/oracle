// Drives the OGD login form and, when OGD asks for one, enters the emailed
// OTP. OTP values and passwords are never logged or returned.
export const OGD_LOGIN_URL = 'https://cfcglobaldata.com/login.aspx?ReturnUrl=%2fdefault.aspx';

const NAVIGATION_TIMEOUT_MS = 30000;
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
  return { state: 'unexpected' };
}

function describePage({ path, title, inputs }) {
  const fields = inputs.map((input) => input.id || input.name || input.type).join(', ') || 'none';
  return `Page ${path} titled "${title}", fields: ${fields}`;
}

function snapshotPage(page) {
  return page.evaluate(() => {
    const isVisible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const inputs = [...document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio])')]
      .filter(isVisible)
      .map((el) => ({ id: el.id, name: el.name, type: el.type, placeholder: el.placeholder }));
    return { path: location.pathname, title: document.title, inputs, text: (document.body?.innerText || '').slice(0, 4000) };
  });
}

// Waits for the page load a submit causes. A postback that does not navigate
// simply runs out the timeout and is then inspected as-is.
async function submitAndSettle(page, submit) {
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

// Resolves to { otpRequired } when OGD reaches its signed-in page and throws
// AutomationFailure otherwise. readOtp({ sinceEpochSeconds }) supplies the OTP.
export async function loginToOgd({ browser, username, password, readOtp, loginUrl = OGD_LOGIN_URL }) {
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

  const afterPassword = await snapshotPage(page);
  const firstStep = classifyPage(afterPassword);

  if (firstStep.state === 'connected') return { otpRequired: false };
  if (firstStep.state === 'login') {
    throw new AutomationFailure('ogd_bad_credentials', dialogMessage || 'OGD returned to its login form after the username and password were submitted.');
  }
  if (firstStep.state === 'unexpected') throw new AutomationFailure('unexpected_page', describePage(afterPassword));

  const otp = await readOtp({ sinceEpochSeconds });
  dialogMessage = null;
  const field = otpLocator(page, firstStep.otpInput);
  await field.fill(otp);

  const button = await findOtpSubmitButton(page);
  await submitAndSettle(page, () => (button ? button.click() : field.press('Enter')));

  const afterOtp = await snapshotPage(page);
  const finalStep = classifyPage(afterOtp);
  if (finalStep.state === 'connected') return { otpRequired: true };
  if (finalStep.state === 'otp' || finalStep.state === 'login') {
    throw new AutomationFailure('otp_rejected', dialogMessage || 'OGD did not accept the code from the email.');
  }
  throw new AutomationFailure('unexpected_page', describePage(afterOtp));
}
