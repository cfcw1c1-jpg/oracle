import { pagerAction } from './ogdMembers.mjs';

// Generates OGD's Birthday and Wedding Anniversary celebrant lists for one
// month and reads the rows back. OGD's form is found by its labels rather than
// fixed element ids, and any step that does not match what is expected stops
// with a description of the page so the next fix can be made from it.

export const CELEBRANT_KINDS = {
  birthday: { label: 'Birthday', pattern: /birth/i },
  anniversary: { label: 'Wedding Anniversary', pattern: /anniv|wedding/i },
};

// Ticked under Service Types. Every other Service Type and every Service
// Group checkbox is left unticked.
export const SERVICE_TYPES = [
  'CHAPTER LEADER', 'FAMIN HOUSEHOLD HEAD', 'HOUSEHOLD HEAD', 'MEMBER', 'UNIT LEADER',
  'CHAPTER HEAD', 'FAMIN HOUSEHOLD LEADER', 'HOUSEHOLD LEADER', 'UNIT HEAD',
];

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const NAVIGATION_TIMEOUT_MS = 30000;
const RESULT_WAIT_MS = 45000;
const POLL_MS = 500;
const CLICK_SETTLE_MS = 400;
const MAX_PAGES = 50;
const MAX_ROWS = 5000;
const DETAIL_LIMIT = 3000;

export class CelebrantsFailure extends Error {
  constructor(code, detail) {
    super(String(detail).slice(0, DETAIL_LIMIT));
    this.code = code;
  }
}

// "FAMIN  Household-Head" and "Famin Household Head" are the same label.
export function normalizeLabel(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

const WANTED = new Set(SERVICE_TYPES.map(normalizeLabel));

// ---------- Reading the page ----------

// One snapshot of every frame's links and form controls. Checkboxes are
// grouped into lists by their ASP.NET name (ctl00$Main$cblServiceType$3 and
// so on), and each list carries the text just before it, which is where OGD
// prints "Service Types" or "Service Groups".
function snapshotFrame(frame) {
  return frame.evaluate(() => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const isShown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';

    function labelOf(input) {
      if (input.id) {
        const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
        if (label) return clean(label.innerText || label.textContent);
      }
      const wrapping = input.closest('label');
      if (wrapping) return clean(wrapping.innerText || wrapping.textContent);
      let next = input.nextSibling;
      while (next && next.nodeType === Node.TEXT_NODE && !clean(next.textContent)) next = next.nextSibling;
      if (next) return clean(next.textContent).slice(0, 80);
      return '';
    }

    function listKey(input) {
      const source = input.name || input.id || '';
      return source.replace(/[$_:]\d+$/, '') || source;
    }

    // The nearest text before the element that is not one of its own list's labels.
    function textBefore(el, ownLabels) {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      walker.currentNode = el;
      for (let steps = 0; steps < 40 && walker.previousNode(); steps += 1) {
        const text = clean(walker.currentNode.textContent);
        if (text && !ownLabels.has(text)) return text.slice(0, 80);
      }
      return '';
    }

    const links = [...document.querySelectorAll('a, [onclick]')]
      .map((el, index) => ({ index, text: clean(el.innerText || el.textContent), href: el.getAttribute('href') || '', shown: isShown(el) }))
      .filter((link) => link.text && link.text.length <= 80);
    document.querySelectorAll('[data-oracle-link]').forEach((el) => el.removeAttribute('data-oracle-link'));
    [...document.querySelectorAll('a, [onclick]')].forEach((el, index) => el.setAttribute('data-oracle-link', String(index)));

    const selects = [...document.querySelectorAll('select')].map((el) => ({
      id: el.id, name: el.name, label: textBefore(el, new Set()),
      options: [...el.options].map((option) => ({ value: option.value, text: clean(option.text) })),
    }));

    const radios = [...document.querySelectorAll('input[type=radio]')].map((el) => ({ id: el.id, name: el.name, label: labelOf(el), checked: el.checked }));

    const lists = new Map();
    for (const el of document.querySelectorAll('input[type=checkbox]')) {
      const key = listKey(el);
      if (!lists.has(key)) lists.set(key, { key, items: [], first: el });
      lists.get(key).items.push({ id: el.id, name: el.name, label: labelOf(el), checked: el.checked, disabled: el.disabled });
    }
    const checkboxLists = [...lists.values()].map(({ key, items, first }) => {
      const container = first.closest('fieldset');
      const legend = container?.querySelector('legend');
      return { key, items, heading: legend ? clean(legend.textContent) : textBefore(first, new Set(items.map((item) => item.label))) };
    });

    const buttons = [...document.querySelectorAll('input[type=submit], input[type=button], button, a.btn, a[id*="btn" i]')]
      .filter(isShown)
      .map((el) => ({ id: el.id, text: clean(el.value || el.innerText || el.textContent) }))
      .filter((button) => button.text);

    return { path: location.pathname, title: document.title, links, selects, radios, checkboxLists, buttons, text: clean(document.body?.innerText).slice(0, 2000) };
  });
}

async function snapshotAll(page) {
  const snapshots = [];
  for (const frame of page.frames()) {
    const snapshot = await snapshotFrame(frame).catch(() => null);
    if (snapshot) snapshots.push({ frame, snapshot });
  }
  return snapshots;
}

function describe(snapshots) {
  const parts = [];
  for (const { snapshot } of snapshots) {
    const lists = snapshot.checkboxLists.map((list) => `[${list.heading || list.key}: ${list.items.map((item) => item.label || item.id).slice(0, 25).join(', ')}]`);
    const selects = snapshot.selects.map((select) => `[${select.label || select.id}: ${select.options.map((option) => option.text).slice(0, 14).join(', ')}]`);
    const radios = snapshot.radios.map((radio) => radio.label || radio.id);
    parts.push(
      `Page ${snapshot.path} "${snapshot.title}"`
        + (selects.length ? ` | dropdowns ${selects.join(' ')}` : '')
        + (radios.length ? ` | options ${radios.join(', ')}` : '')
        + (lists.length ? ` | checkboxes ${lists.join(' ')}` : '')
        + (snapshot.buttons.length ? ` | buttons ${snapshot.buttons.map((button) => button.text).slice(0, 15).join(', ')}` : ''),
    );
  }
  return parts.join(' || ') || 'The page could not be read.';
}

function describeLinks(snapshots) {
  const texts = new Set();
  snapshots.forEach(({ snapshot }) => snapshot.links.forEach((link) => texts.add(link.text)));
  return [...texts].slice(0, 60).join(', ');
}

// ---------- Opening the report ----------

function scoreLink(text, kind) {
  let score = 0;
  if (/celebrant/i.test(text)) score += 2;
  if (CELEBRANT_KINDS[kind].pattern.test(text)) score += 3;
  const other = Object.entries(CELEBRANT_KINDS).find(([key]) => key !== kind)[1];
  if (other.pattern.test(text) && !CELEBRANT_KINDS[kind].pattern.test(text)) score -= 10;
  return score;
}

// Clicks the menu link that best names this report. A hidden menu entry with
// a real address is opened by going to that address instead.
async function openReport(page, kind) {
  const snapshots = await snapshotAll(page);
  let best = null;
  for (const { frame, snapshot } of snapshots) {
    for (const link of snapshot.links) {
      const score = scoreLink(link.text, kind);
      if (score >= 2 && (!best || score > best.score || (score === best.score && link.shown && !best.link.shown))) best = { frame, link, score };
    }
  }
  if (!best) {
    throw new CelebrantsFailure('celebrants_link_missing', `No Celebrants link on ${new URL(page.url()).pathname}. Links seen: ${describeLinks(snapshots)}`);
  }

  const loaded = page.waitForEvent('load', { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => null);
  const element = best.frame.locator(`[data-oracle-link="${best.link.index}"]`);
  const href = best.link.href;
  if (best.link.shown) {
    await element.click({ timeout: 5000 });
  } else if (href && !/^(javascript:|#)/i.test(href)) {
    await page.goto(new URL(href, best.frame.url()).href, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT_MS });
  } else {
    await element.evaluate((el) => el.click());
  }
  await loaded;
  await page.waitForTimeout(1000);
  return best.link.text;
}

// ---------- Filling the form ----------

function findForm(snapshots) {
  const monthMatches = (select) => select.options.filter((option) => MONTH_NAMES.some((name) => normalizeLabel(option.text).startsWith(name.slice(0, 3).toUpperCase()))).length;
  for (const entry of snapshots) {
    const monthSelect = entry.snapshot.selects.find((select) => monthMatches(select) >= 10);
    const hasServiceList = entry.snapshot.checkboxLists.some((list) => list.items.some((item) => WANTED.has(normalizeLabel(item.label))));
    if (monthSelect || hasServiceList) return { ...entry, monthSelect };
  }
  return null;
}

async function waitForForm(page) {
  const end = Date.now() + NAVIGATION_TIMEOUT_MS;
  let snapshots = [];
  do {
    snapshots = await snapshotAll(page);
    const form = findForm(snapshots);
    if (form) return form;
    await page.waitForTimeout(POLL_MS);
  } while (Date.now() < end);
  throw new CelebrantsFailure('celebrants_form_unexpected', `The Celebrants page has no month list or Service Types. ${describe(snapshots)}`);
}

function locatorFor(frame, item) {
  if (item.id) return frame.locator(`[id="${item.id}"]`);
  return frame.locator(`[name="${item.name}"]`);
}

// Selects an option by script so OGD's own change handler (and any postback
// it starts) runs, then waits for the page to settle.
async function chooseOption(page, frame, select, option) {
  const loaded = page.waitForEvent('load', { timeout: 3000 }).catch(() => null);
  await locatorFor(frame, select).selectOption(option.value);
  await loaded;
  await page.waitForLoadState('load').catch(() => null);
}

// Clicks a checkbox or radio by script, which fires the same handlers a real
// click does and works when OGD styles the box out of view.
async function setChecked(page, frame, item, checked) {
  const loaded = page.waitForEvent('load', { timeout: CLICK_SETTLE_MS * 3 }).catch(() => null);
  const changed = await locatorFor(frame, item).evaluate((el, want) => {
    if (el.checked === want) return false;
    el.click();
    return true;
  }, checked).catch(() => false);
  if (changed) {
    await loaded;
    await page.waitForLoadState('load').catch(() => null);
  }
}

// Picks Birthday or Wedding Anniversary when the form offers that choice.
async function chooseKind(page, form, kind) {
  const { pattern } = CELEBRANT_KINDS[kind];
  const select = form.snapshot.selects.find((candidate) => candidate !== form.monthSelect && candidate.options.some((option) => pattern.test(option.text))
    && candidate.options.some((option) => Object.values(CELEBRANT_KINDS).some((other) => other.pattern !== pattern && other.pattern.test(option.text))));
  if (select) {
    await chooseOption(page, form.frame, select, select.options.find((option) => pattern.test(option.text)));
    return true;
  }
  const radio = form.snapshot.radios.find((candidate) => pattern.test(candidate.label));
  if (radio) {
    await setChecked(page, form.frame, radio, true);
    return true;
  }
  const kindList = form.snapshot.checkboxLists.find((list) => list.items.some((item) => pattern.test(item.label))
    && list.items.every((item) => Object.values(CELEBRANT_KINDS).some((other) => other.pattern.test(item.label))));
  if (kindList) {
    for (const item of kindList.items) await setChecked(page, form.frame, item, pattern.test(item.label));
    return true;
  }
  return false;
}

function classifyLists(lists) {
  const isTypeHeading = (list) => /service\s*types?|serv\w*type|svc\w*type/i.test(`${list.heading} ${list.key}`);
  const isGroupHeading = (list) => /service\s*groups?|serv\w*group|svc\w*group/i.test(`${list.heading} ${list.key}`);
  const matches = (list) => list.items.filter((item) => WANTED.has(normalizeLabel(item.label))).length;

  const typeList = lists.find((list) => isTypeHeading(list) && !isGroupHeading(list) && matches(list) > 0)
    ?? [...lists].sort((a, b) => matches(b) - matches(a)).find((list) => matches(list) > 0);
  const groupLists = lists.filter((list) => list !== typeList && isGroupHeading(list));
  return { typeList, groupLists };
}

async function applyServiceFilters(page, form) {
  const { typeList, groupLists } = classifyLists(form.snapshot.checkboxLists);
  if (!typeList) throw new CelebrantsFailure('celebrants_form_unexpected', `Could not find the Service Types checkboxes. ${describe([form])}`);

  const found = new Set(typeList.items.map((item) => normalizeLabel(item.label)));
  const missing = SERVICE_TYPES.filter((type) => !found.has(normalizeLabel(type)));
  if (missing.length) {
    throw new CelebrantsFailure('celebrants_form_unexpected', `Service Types is missing ${missing.join(', ')}. ${describe([form])}`);
  }
  if (!groupLists.length) throw new CelebrantsFailure('celebrants_form_unexpected', `Could not find the Service Groups checkboxes. ${describe([form])}`);

  // Groups are cleared first so a "select all" box there cannot re-tick types.
  for (const list of groupLists) {
    for (const item of list.items) await setChecked(page, form.frame, item, false);
  }
  for (const item of typeList.items) await setChecked(page, form.frame, item, WANTED.has(normalizeLabel(item.label)));

  // Confirms the boxes stuck, since a postback can reset them. A postback can
  // also replace the frame, so the form is located again.
  const after = await waitForForm(page);
  const { typeList: typeAfter, groupLists: groupsAfter } = classifyLists(after.snapshot.checkboxLists);
  const wrongType = typeAfter?.items.filter((item) => item.checked !== WANTED.has(normalizeLabel(item.label))) ?? [];
  const tickedGroups = groupsAfter.flatMap((list) => list.items.filter((item) => item.checked));
  if (!typeAfter || wrongType.length || tickedGroups.length) {
    const labels = [...wrongType, ...tickedGroups].map((item) => item.label || item.id).join(', ');
    throw new CelebrantsFailure('celebrants_form_unexpected', `OGD did not keep the Service filters (${labels}).`);
  }
  return after;
}

function findGenerateButton(form) {
  const buttons = form.snapshot.buttons;
  return buttons.find((button) => /generate|extract/i.test(button.text))
    ?? buttons.find((button) => /^(search|view|show|display|go|submit|preview|ok|print)\b/i.test(button.text));
}

// ---------- Reading the results ----------

// The results table: a header row with a Name heading, and no form controls.
function readResultTable(frame) {
  return frame.evaluate((maxRows) => {
    const text = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    const noRecords = /no (records?|data|celebrants?|results?|matching)( were)? found|no records? to display|there are no/i.test(document.body?.innerText || '');
    for (const table of document.querySelectorAll('table')) {
      if (table.querySelector('table, select, input[type=checkbox]')) continue;
      const rows = [...table.rows];
      const headerIndex = rows.findIndex((row) => row.cells.length >= 2 && [...row.cells].some((cell) => /name/i.test(text(cell)) && text(cell).length <= 40));
      if (headerIndex === -1) continue;
      const headers = [...rows[headerIndex].cells].map(text);
      const records = [];
      for (const row of rows.slice(headerIndex + 1)) {
        if (row.cells.length !== headers.length) continue;
        const cells = [...row.cells].map(text);
        if (cells.every((cell) => !cell)) continue;
        records.push(cells);
        if (records.length >= maxRows) break;
      }
      return { headers, records, noRecords };
    }
    return noRecords ? { headers: [], records: [], noRecords } : null;
  }, MAX_ROWS);
}

async function findResults(pages, timeoutMs) {
  const end = Date.now() + timeoutMs;
  do {
    for (const page of pages) {
      for (const frame of page.frames()) {
        const table = await readResultTable(frame).catch(() => null);
        if (table && (table.records.length || table.noRecords)) return { page, frame, table };
      }
    }
    await pages[0].waitForTimeout(POLL_MS);
  } while (Date.now() < end);
  return null;
}

async function readAllPages(found) {
  const headers = found.table.headers;
  const records = [...found.table.records];
  let { frame } = found;
  for (let pageNumber = 1; pageNumber < MAX_PAGES && records.length < MAX_ROWS; pageNumber += 1) {
    const firstKey = found.table.records[0]?.join('|') ?? '';
    const { moved } = await pagerAction(frame, 'next').catch(() => ({ moved: false }));
    if (!moved) break;
    const end = Date.now() + NAVIGATION_TIMEOUT_MS;
    let next = null;
    while (Date.now() < end) {
      await found.page.waitForTimeout(POLL_MS);
      next = await findResults([found.page], 0);
      if (next?.table.records.length && next.table.records[0].join('|') !== firstKey) break;
      next = null;
    }
    if (!next) break;
    found = next;
    frame = next.frame;
    records.push(...next.table.records);
  }
  return { headers, records };
}

// ---------- One report ----------

async function generateOne(page, kind, month) {
  const linkText = await openReport(page, kind);
  let form = await waitForForm(page);

  const isKindPage = scoreLink(linkText, kind) >= 3;
  if (!(await chooseKind(page, form, kind)) && !isKindPage) {
    throw new CelebrantsFailure('celebrants_form_unexpected', `Could not choose ${CELEBRANT_KINDS[kind].label} on the "${linkText}" page. ${describe([form])}`);
  }
  form = await waitForForm(page);

  if (!form.monthSelect) throw new CelebrantsFailure('celebrants_form_unexpected', `The Celebrants page has no month list. ${describe([form])}`);
  const monthName = MONTH_NAMES[month - 1].toUpperCase();
  const option = form.monthSelect.options.find((candidate) => normalizeLabel(candidate.text) === monthName)
    ?? form.monthSelect.options.find((candidate) => normalizeLabel(candidate.text).startsWith(monthName.slice(0, 3)))
    ?? form.monthSelect.options.find((candidate) => Number(candidate.value) === month && /^\d+$/.test(candidate.value));
  if (!option) throw new CelebrantsFailure('celebrants_form_unexpected', `The month list has no ${MONTH_NAMES[month - 1]}.`);
  await chooseOption(page, form.frame, form.monthSelect, option);

  form = await applyServiceFilters(page, await waitForForm(page));

  const button = findGenerateButton(form);
  if (!button) throw new CelebrantsFailure('celebrants_form_unexpected', `No Generate button on the Celebrants page. ${describe([form])}`);

  const context = page.context();
  const popups = [];
  const onPage = (popup) => popups.push(popup);
  let download = null;
  const onDownload = (file) => {
    download = file.suggestedFilename();
  };
  context.on('page', onPage);
  page.on('download', onDownload);
  try {
    const loaded = page.waitForEvent('load', { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => null);
    const target = button.id ? form.frame.locator(`[id="${button.id}"]`) : form.frame.getByRole('button', { name: button.text }).first();
    await target.click({ timeout: 5000 });
    await Promise.race([loaded, page.waitForTimeout(3000)]);

    const end = Date.now() + RESULT_WAIT_MS;
    let found = null;
    while (!found && Date.now() < end && !download) {
      found = await findResults([...popups, page], 0);
      if (!found) await page.waitForTimeout(POLL_MS);
    }
    if (download) throw new CelebrantsFailure('celebrants_result_unexpected', `OGD offered a file (${download}) instead of showing the list.`);
    if (!found) {
      const pages = [...popups, page];
      const seen = [];
      for (const shown of pages) seen.push(describe(await snapshotAll(shown)));
      throw new CelebrantsFailure('celebrants_result_unexpected', `No celebrant list appeared after clicking ${button.text}. ${seen.join(' || ')}`);
    }
    if (!found.table.records.length) return { headers: found.table.headers, records: [] };
    return readAllPages(found);
  } finally {
    context.off('page', onPage);
    page.off('download', onDownload);
  }
}

// Run on OGD's signed-in page. Each kind is generated separately so one
// failing does not lose the other. Never throws for a report problem.
export function createCelebrantsReport(month, kinds = Object.keys(CELEBRANT_KINDS)) {
  return async function generateCelebrants(page) {
    const homeUrl = page.url();
    const results = {};
    for (const kind of kinds) {
      try {
        results[kind] = { ok: true, ...(await generateOne(page, kind, month)) };
      } catch (error) {
        results[kind] = error instanceof CelebrantsFailure
          ? { ok: false, failureCode: error.code, statusDetail: error.message }
          : { ok: false, failureCode: 'automation_error', statusDetail: String(error?.message ?? 'Unknown error').split('\n')[0].slice(0, 500) };
      }
      await page.goto(homeUrl, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT_MS }).catch(() => null);
    }
    return results;
  };
}
