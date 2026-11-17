import { closePopup, openMemberPopup, waitForPopupContent } from './ogdMembers.mjs';

// Writes Oracle changes into a member's details on OGD: member popup >
// Personal tab (or whichever tab the popup opens on). Fields are found by
// their label, only the queued fields are touched, and every save is checked
// by opening the member again and reading the values back.

// Tab names the member details may sit under; the popup's own default is
// used when none of them exists.
const DETAILS_TABS = ['personal', 'personal info', 'personal information', 'profile', 'member info', 'basic info'];
const SAVE_WAIT_MS = 20000;
const POLL_MS = 500;

// Oracle column -> how its field is labelled on OGD. `not` keeps look-alikes
// apart (a "Mobile Phone" field is not the Phone field).
export const PUSH_FIELDS = {
  Lastname: { label: 'Last name', match: /^(last\s*name|surname|family\s*name)\b/i },
  Firstname: { label: 'First name', match: /^(first\s*name|given\s*name)\b/i },
  Gender: { label: 'Gender', match: /^(gender|sex)\b/i },
  Status: { label: 'Status', match: /^(member(ship)?\s*)?status\b/i },
  SpouseName: { label: 'Spouse', match: /^spouse/i },
  MobileNo: { label: 'Mobile #', match: /^(mobile|cell)/i },
  Phone: { label: 'Phone', match: /^(home\s*|tel(ephone)?\s*|landline\s*)?(phone|tel(ephone)?|landline)\b/i, not: /mobile|cell/i },
  Email: { label: 'Email', match: /^e-?mail/i },
  PastoralService: { label: 'Pastoral service', match: /^(pastoral\s*)?service\b/i },
  AreaName: { label: 'Area', match: /^area\b/i },
  NameOfHouseholdHead: { label: 'Household head', match: /(household|hh)\s*head/i },
  YearRegistered: { label: 'Year registered', match: /year\s*(registered|joined)|date\s*(registered|joined)/i },
};

export const fieldLabel = (field) => PUSH_FIELDS[field]?.label ?? field;

const normalize = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9@.]/g, '');

// True when OGD's shown value already equals what Oracle wants.
export function sameValue(siteValue, wanted) {
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
async function findForm(page, memberId, framesBefore, timeoutMs) {
  return waitForPopupContent(
    page,
    async (frame) => {
      if (framesBefore.has(frame)) return null;
      const form = await readForm(frame, memberId);
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
export async function pushMemberChanges(page, member, changes) {
  const outcome = new Map();
  const finish = (change, status, detail = null) => outcome.set(change.id, { id: change.id, status, detail });

  let framesBefore = new Set(page.frames());
  try {
    framesBefore = await openMemberPopup(page, member, DETAILS_TABS);
    let found = await findForm(page, member.memberId, framesBefore);
    if (!found) throw new Error('The member popup showed no details form.');

    // Some forms open read-only behind an Edit button.
    const anyEditable = found.result.fields.some((field) => field.editable);
    if (!anyEditable && found.result.hasEdit) {
      await clickButton(found.frame, /^(edit|edit member|edit profile)$/i);
      await page.waitForTimeout(1500);
      found = (await findForm(page, member.memberId, framesBefore)) ?? found;
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
        const problem = await fillField(frame, field, change.new_value);
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
    framesBefore = await openMemberPopup(page, member, DETAILS_TABS);
    const check = await findForm(page, member.memberId, framesBefore);
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
