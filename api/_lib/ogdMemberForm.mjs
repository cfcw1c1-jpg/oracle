import { closePopup, findInPopup, openMemberPopup, readHouseholdHead, waitForPopupContent } from './ogdMembers.mjs';

// Writes Oracle changes into a member's details on OGD: member popup >
// Personal tab (or whichever tab the popup opens on), and the Family tab for
// the church wedding date. Fields are found by
// their label, only the queued fields are touched, and every save is checked
// by opening the member again and reading the values back.

// Tab names the member details may sit under; the popup's own default is
// used when none of them exists.
const DETAILS_TABS = ['personal', 'personal info', 'personal information', 'profile', 'member info', 'basic info'];
const SAVE_WAIT_MS = 20000;
const POLL_MS = 500;

// Oracle column -> how its field is labelled on OGD. `not` keeps look-alikes
// apart (a "Mobile Phone" field is not the Phone field). `tab` names the popup
// tab a field sits on when it is not the details (Personal) tab.
export const PUSH_FIELDS = {
  Lastname: { label: 'Last name', match: /^(last\s*name|surname|family\s*name)\b/i },
  Firstname: { label: 'First name', match: /^(first\s*name|given\s*name)\b/i },
  Status: { label: 'Status', match: /^(member(ship)?\s*)?status\b/i },
  SpouseName: { label: 'Spouse', match: /^spouse/i },
  MobileNo: { label: 'Mobile #', match: /^(mobile|cell)/i },
  Phone: { label: 'Phone', match: /^(home\s*|tel(ephone)?\s*|landline\s*)?(phone|tel(ephone)?|landline)\b/i, not: /mobile|cell/i },
  Email: { label: 'Email', match: /^e-?mail/i },
  PastoralService: { label: 'Pastoral service', match: /^(pastoral\s*)?service\b/i },
  AreaName: { label: 'Area', match: /^area\b/i },
  NameOfHouseholdHead: { label: 'Household head', match: /(household|hh)\s*head/i },
  YearRegistered: { label: 'Year registered', match: /year\s*(registered|joined)|date\s*(registered|joined)/i },
  Birthday: { label: 'Birthday', match: /^(birth\s*day|birth\s*date|date\s*of\s*birth)/i, date: true },
  // Family tab: "Church Wedding Date", saved with the Save button beside it.
  WeddingDate: { label: 'Church wedding date', match: /wedding\s*date|date\s*of\s*(church\s*)?(wedding|marriage)|marriage\s*date/i, date: true, tab: 'family' },
};

// OGD shows dates as m/d/yyyy; Oracle stores yyyy-mm-dd.
export function toOracleDate(siteValue) {
  const match = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(String(siteValue ?? ''));
  if (!match) return null;
  const [, month, day, year] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function toSiteDate(oracleValue) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(oracleValue ?? ''));
  return match ? `${Number(match[2])}/${Number(match[3])}/${match[1]}` : String(oracleValue ?? '');
}

// The value as OGD's form should hold it.
const toSiteValue = (field, value) => (PUSH_FIELDS[field]?.date ? toSiteDate(value) : value);

export const fieldLabel = (field) => PUSH_FIELDS[field]?.label ?? field;

const normalize = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9@.]/g, '');

// True when OGD's shown value already equals what Oracle wants.
export function sameValue(siteValue, wanted) {
  const siteDate = toOracleDate(siteValue);
  if (siteDate && /^\d{4}-\d{2}-\d{2}/.test(String(wanted ?? ''))) return siteDate === String(wanted).slice(0, 10);
  return normalize(siteValue) === normalize(wanted);
}

// Picks the OGD form field for an Oracle column. Prefers editable fields.
export function matchField(fields, column) {
  const spec = PUSH_FIELDS[column];
  if (!spec) return null;
  const fits = (text) => Boolean(text) && spec.match.test(text) && !(spec.not && spec.not.test(text));
  const candidates = fields.filter((field) => fits(field.label) || fits(field.nameLabel));
  return candidates.find((field) => field.editable) ?? candidates[0] ?? null;
}

// The option to choose for a value: same text or value, or for one-letter
// options (M/F) the value's first letter.
export function matchOption(options, wanted) {
  const target = normalize(wanted);
  if (!target) return options.find((option) => !normalize(option.text) || /^-*select/i.test(option.text)) ?? null;
  return (
    options.find((option) => normalize(option.text) === target || normalize(option.value) === target) ??
    options.find((option) => normalize(option.text).length === 1 && normalize(option.text) === target[0]) ??
    null
  );
}

// Lists the visible form fields in a frame with their labels. Each field is
// tagged with data-oracle-field so it can be filled afterwards.
function readForm(frame, memberId) {
  return frame.evaluate((memberId) => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').replace(/[:*\s]+$/, '').trim();
    const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const shortText = (el) => {
      const text = clean(el?.innerText || el?.textContent);
      return text.length && text.length <= 40 ? text : '';
    };
    // ASP.NET names such as ctl00$Body$txtMobileNo -> "Mobile No".
    const fromName = (el) => {
      const last = String(el.id || el.name || '').split(/[$_]/).pop() || '';
      return last.replace(/^(txt|ddl|cbo|cmb|dd|tb|lbl|sel)(?=[A-Z])/, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
    };
    const labelOf = (el) => {
      if (el.id) {
        const tagged = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (tagged && shortText(tagged)) return shortText(tagged);
      }
      if (el.closest('label') && shortText(el.closest('label'))) return shortText(el.closest('label'));
      let sibling = el.previousElementSibling;
      while (sibling && !shortText(sibling) && sibling.tagName !== 'INPUT' && sibling.tagName !== 'SELECT') sibling = sibling.previousElementSibling;
      if (sibling && shortText(sibling) && sibling.tagName !== 'INPUT' && sibling.tagName !== 'SELECT') return shortText(sibling);
      const cell = el.closest('td, th');
      let previous = cell?.previousElementSibling;
      while (previous && !shortText(previous)) previous = previous.previousElementSibling;
      if (previous && !previous.querySelector('input, select, textarea')) return shortText(previous);
      // Label in the row above, same column.
      const row = cell?.parentElement;
      const above = row?.previousElementSibling;
      if (cell && above?.cells?.[cell.cellIndex] && !above.cells[cell.cellIndex].querySelector('input, select, textarea')) {
        const text = shortText(above.cells[cell.cellIndex]);
        if (text) return text;
      }
      return clean(el.getAttribute('aria-label') || el.getAttribute('placeholder') || '');
    };

    const selector = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]):not([type=image]):not([type=file]), select, textarea';
    const fields = [];
    document.querySelectorAll(selector).forEach((el) => {
      if (!visible(el)) return;
      const key = String(fields.length);
      el.setAttribute('data-oracle-field', key);
      const isSelect = el.tagName === 'SELECT';
      fields.push({
        key,
        label: labelOf(el),
        nameLabel: fromName(el),
        tag: el.tagName.toLowerCase(),
        editable: !el.disabled && !el.readOnly,
        value: isSelect ? clean(el.options[el.selectedIndex]?.text) : el.value,
        options: isSelect ? [...el.options].map((option) => ({ value: option.value, text: clean(option.text) })) : undefined,
      });
    });
    const buttons = [...document.querySelectorAll('input[type=submit], input[type=button], button, a')]
      .filter(visible)
      .map((el) => clean(el.value || el.innerText || el.textContent));
    return {
      showsMember: (document.body?.innerText || '').includes(memberId) || [...document.querySelectorAll('input')].some((el) => el.value === memberId),
      fields,
      hasSave: buttons.some((text) => /^(save|update|save changes|update member|save member)$/i.test(text)),
      hasEdit: buttons.some((text) => /^(edit|edit member|edit profile)$/i.test(text)),
    };
  }, memberId);
}

// The member's details form: a frame the popup added that shows the member
// and has fields. The list's own frame (search box, member IDs) never counts.
// With wanted (Oracle columns), only a form holding one of their fields
// counts, so a tab still loading is not mistaken for the one asked for.
async function findForm(page, memberId, framesBefore, timeoutMs, wanted = null) {
  return waitForPopupContent(
    page,
    async (frame) => {
      if (framesBefore.has(frame)) return null;
      const form = await readForm(frame, memberId);
      if (wanted) return form && wanted.some((column) => matchField(form.fields, column)) ? form : null;
      return form?.fields.length ? form : form?.hasEdit ? form : null;
    },
    timeoutMs,
  );
}

async function clickButton(frame, pattern) {
  const buttons = frame.locator('input[type=submit], input[type=button], button, a');
  for (let index = 0; index < (await buttons.count()); index += 1) {
    const button = buttons.nth(index);
    if (!(await button.isVisible().catch(() => false))) continue;
    const text = ((await button.getAttribute('value')) || (await button.innerText().catch(() => '')) || '').trim();
    if (pattern.test(text)) {
      await button.click({ timeout: 10000 });
      return true;
    }
  }
  return false;
}

async function fillField(frame, field, wanted) {
  const locator = frame.locator(`[data-oracle-field="${field.key}"]`);
  if (field.tag === 'select') {
    const option = matchOption(field.options, wanted);
    if (!option) return `OGD's ${field.label || 'list'} has no "${wanted}" option (choices: ${field.options.map((item) => item.text).filter(Boolean).slice(0, 8).join(', ')}).`;
    await locator.selectOption(option.value);
    return null;
  }
  await locator.fill(String(wanted ?? ''));
  return null;
}

// Pushes one member's queued changes. changes: [{ id, field, new_value }].
// Returns [{ id, status: 'pushed' | 'failed', detail }] for every change.
// Details (Personal tab) fields are saved first, then Family tab fields.
export async function pushMemberChanges(page, member, changes) {
  const family = changes.filter((change) => PUSH_FIELDS[change.field]?.tab === 'family');
  const details = changes.filter((change) => !family.includes(change));
  const outcomes = [];
  if (details.length) outcomes.push(...(await pushOnTab(page, member, details, DETAILS_TABS)));
  if (family.length) {
    const wanted = [...new Set(family.map((change) => change.field))];
    outcomes.push(...(await pushOnTab(page, member, family, ['family'], wanted)));
  }
  return outcomes;
}

// One tab's save: fill the fields, Save, then reopen the popup and read back.
async function pushOnTab(page, member, changes, tabLabels, wanted = null) {
  const outcome = new Map();
  const finish = (change, status, detail = null) => outcome.set(change.id, { id: change.id, status, detail });
  const missingForm = wanted
    ? `The member popup has no ${tabLabels[0]} tab with a ${wanted.map(fieldLabel).join(', ')} field.`
    : 'The member popup showed no details form.';

  let framesBefore = new Set(page.frames());
  try {
    framesBefore = await openMemberPopup(page, member, tabLabels);
    let found = await findForm(page, member.memberId, framesBefore, undefined, wanted);
    if (!found) throw new Error(missingForm);

    // Some forms open read-only behind an Edit button.
    const anyEditable = found.result.fields.some((field) => field.editable);
    if (!anyEditable && found.result.hasEdit) {
      await clickButton(found.frame, /^(edit|edit member|edit profile)$/i);
      await page.waitForTimeout(1500);
      found = (await findForm(page, member.memberId, framesBefore, undefined, wanted)) ?? found;
    }

    const { frame, result: form } = found;
    const seen = form.fields.map((field) => field.label || field.nameLabel).filter(Boolean);
    const toSave = [];
    for (const change of changes) {
      const field = matchField(form.fields, change.field);
      if (!field) finish(change, 'failed', `OGD's form has no ${fieldLabel(change.field)} field (fields seen: ${seen.slice(0, 12).join(', ') || 'none'}).`);
      else if (!field.editable) finish(change, 'failed', `OGD does not allow editing ${fieldLabel(change.field)} here.`);
      else if (sameValue(field.value, change.new_value)) finish(change, 'pushed', 'OGD already had this value.');
      else {
        const problem = await fillField(frame, field, toSiteValue(change.field, change.new_value));
        if (problem) finish(change, 'failed', problem);
        else toSave.push(change);
      }
    }
    if (!toSave.length) return [...outcome.values()];

    if (!form.hasSave) {
      for (const change of toSave) finish(change, 'failed', 'OGD\'s form has no Save button.');
      return [...outcome.values()];
    }

    const messages = [];
    const onDialog = (dialog) => messages.push(dialog.message().slice(0, 200));
    page.on('dialog', onDialog);
    try {
      const reloaded = frame.waitForNavigation({ timeout: SAVE_WAIT_MS }).catch(() => null);
      await clickButton(frame, /^(save|update|save changes|update member|save member)$/i);
      await reloaded;
      await page.waitForTimeout(POLL_MS * 2);
    } finally {
      page.off('dialog', onDialog);
    }

    // Reads the saved values back from a freshly opened popup.
    await closePopup(page, member.memberId, framesBefore);
    framesBefore = await openMemberPopup(page, member, tabLabels);
    const check = await findForm(page, member.memberId, framesBefore, undefined, wanted);
    for (const change of toSave) {
      const field = check && matchField(check.result.fields, change.field);
      if (field && sameValue(field.value, change.new_value)) finish(change, 'pushed');
      else finish(change, 'failed', messages[0] ? `OGD says: ${messages[0]}` : `OGD did not keep the new ${fieldLabel(change.field)}${field ? ` (it shows "${field.value}")` : ''}.`);
    }
    return [...outcome.values()];
  } catch (error) {
    const reason = error.message.split('\n')[0].slice(0, 200);
    for (const change of changes) if (!outcome.has(change.id)) finish(change, 'failed', reason);
    return [...outcome.values()];
  } finally {
    await closePopup(page, member.memberId, framesBefore);
  }
}

// Per-member step for the Members sync, in one visit: the birthday from the
// Personal tab the popup opens on, the church wedding date from the Family
// tab, then the household head from the Service tab. A birthday or wedding
// date that cannot be read never holds up the household head, and after a few
// members in a row where it could not be found the run stops looking, so a
// form OGD changed cannot slow the whole sync down. An empty wedding date
// (not married) still counts as found.
const BIRTHDAY_WAIT_MS = 4000;
const FAMILY_WAIT_MS = 4000;
const GIVE_UP_AFTER = 5;
const birthdayMisses = new WeakMap();
const familyMisses = new WeakMap();

// Opens the Family tab and reads its Church Wedding Date field. Resolves to
// { found, weddingDate }; found is false when the tab or field is missing.
async function readWeddingDate(page, member, framesBefore) {
  const tab = await findInPopup(page, framesBefore, 'family', FAMILY_WAIT_MS);
  if (!tab) return { found: false, weddingDate: null };
  await tab.click({ timeout: 10000 });
  // Waits for the Family form itself, not the Personal one still showing.
  const found = await waitForPopupContent(
    page,
    async (frame) => {
      if (framesBefore.has(frame)) return null;
      const form = await readForm(frame, member.memberId);
      const field = form && matchField(form.fields, 'WeddingDate');
      return field ? { showsMember: form.showsMember, field } : null;
    },
    FAMILY_WAIT_MS,
  );
  if (!found) return { found: false, weddingDate: null };
  return { found: true, weddingDate: toOracleDate(found.result.field.value) };
}

export async function readMemberInfo(page, member) {
  let birthday = null;
  let wedding = { found: false, weddingDate: null };
  const missedBirthdays = birthdayMisses.get(page) ?? 0;
  const missedFamily = familyMisses.get(page) ?? 0;
  const tryBirthday = missedBirthdays < GIVE_UP_AFTER;
  const tryFamily = missedFamily < GIVE_UP_AFTER;
  const readFirstTabs = tryBirthday || tryFamily ? async (framesBefore) => {
    if (tryBirthday) {
      const found = await findForm(page, member.memberId, framesBefore, BIRTHDAY_WAIT_MS).catch(() => null);
      const field = found && matchField(found.result.fields, 'Birthday');
      birthday = field ? toOracleDate(field.value) : null;
    }
    if (tryFamily) wedding = await readWeddingDate(page, member, framesBefore).catch(() => wedding);
  } : null;
  const head = await readHouseholdHead(page, member, readFirstTabs);
  if (tryBirthday) birthdayMisses.set(page, birthday ? 0 : missedBirthdays + 1);
  if (tryFamily) familyMisses.set(page, wedding.found ? 0 : missedFamily + 1);
  const weddingDate = wedding.weddingDate;
  return head || birthday || weddingDate ? { head, birthday, weddingDate } : undefined;
}
