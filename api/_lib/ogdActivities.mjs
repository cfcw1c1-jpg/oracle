import { AutomationFailure, submitAndSettle } from './ogdLogin.mjs';
import { pagerAction } from './ogdMembers.mjs';

// Reads OGD's Activities page (Activity Name, Type, Area, Start Date, End
// Date, Team Leader, Venue, Attendance) for a date range, opens each activity
// for its details and attendees, and creates new activities from Oracle.
// OGD's controls are found by their headings and labels rather than fixed
// element ids. Any step that does not match stops with a description of what
// was on the page, so the next fix can be made from it.

const TABLE_WAIT_MS = 20000;
const PAGE_CHANGE_WAIT_MS = 30000;
const OPEN_WAIT_MS = 15000;
const NAVIGATION_TIMEOUT_MS = 30000;
const POLL_MS = 500;
const MAX_PAGES = 40;
const DETAIL_LIMIT = 3000;
const MODAL_CONTAINERS = '#simplemodal-container, .simplemodal-container, .simplemodal-wrap, .ui-dialog, .modal.show, [role=dialog]';
const MODAL_CLOSE = '.simplemodal-close, .modalCloseImg, a.modalClose, #simplemodal-container a.close, .ui-dialog-titlebar-close, .modal.show [data-dismiss=modal], .modal.show .close';
const MEMBER_ID = /^[A-Z]{2}-\d{4}-\d+$/i;
const NEW_ACTIVITY_TEXT = /^\s*(\+\s*)?(add\s+)?new\s+activity\s*$|^\s*(\+\s*)?add\s+activity\s*$/i;

export const ACTIVITY_FAILURES = {
  page: 'activities_page_unexpected',
  form: 'activity_form_unexpected',
  save: 'activity_save_failed',
  attendees: 'activity_attendees_unexpected',
};

// ---------- Dates ----------

// OGD shows Philippine time: "11/20/2026 07:00 PM (GMT+8:00)". Returns an ISO
// string, or null when the text is not a date.
export function parseOgdDate(text) {
  const match = /(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)?)?/i.exec(String(text ?? ''));
  if (!match) return null;
  const [, month, day, year, hourText, minute = '00', meridiem] = match;
  let hour = Number(hourText ?? 0);
  if (meridiem) {
    if (/pm/i.test(meridiem) && hour < 12) hour += 12;
    if (/am/i.test(meridiem) && hour === 12) hour = 0;
  }
  const pad = (value) => String(value).padStart(2, '0');
  const date = new Date(`${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${minute}:00+08:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// The Manila wall-clock parts of an ISO time, for filling OGD's form.
export function manilaParts(iso) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true,
  }).formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  const hour12 = parts.hour === '00' ? '12' : parts.hour;
  const hour24 = String((Number(hour12) % 12) + (/pm/i.test(parts.dayPeriod) ? 12 : 0)).padStart(2, '0');
  return {
    mdy: `${parts.month}/${parts.day}/${parts.year}`,
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
    hour12, hour24, minute: parts.minute, meridiem: parts.dayPeriod.toUpperCase(),
    time12: `${hour12}:${parts.minute} ${parts.dayPeriod.toUpperCase()}`,
  };
}

export function normalizeText(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

// OGD's own id for an activity, from its link, when the link carries one.
export function ogdIdFromHref(href) {
  const match = /[?&](?:activity_?id|actid|aid|id)=([\w-]+)/i.exec(String(href ?? ''));
  return match ? match[1] : null;
}

export function activityKey(row) {
  const id = ogdIdFromHref(row.nameHref) ?? ogdIdFromHref(row.attendanceHref);
  return id ? `id:${id}` : `${normalizeText(row.name)}|${row.startsAt ?? row.start}`;
}

// ---------- Attendees ----------

// Turns OGD's attendee table into { memberId, name, cells } entries.
// Details saved before page furniture was filtered out are cleaned on the way out.
export function cleanDetails(details) {
  return Object.fromEntries(Object.entries(details ?? {}).filter(([label, value]) => !/[$]|^ctl\d|^(txt|cbo|ddl|btn|chk|lbl|hdn)[A-Z]/.test(label)
    && !/^-+\s*(show all|select|all|choose|none)[^-]*-*$/i.test(String(value ?? '').trim())));
}

export function toAttendees({ headers, records }) {
  const lower = headers.map((header) => String(header).toLowerCase());
  let idColumn = lower.findIndex((header) => /member\s*id|id\s*no|^id$|member\s*no/.test(header));
  if (idColumn === -1) idColumn = headers.findIndex((_, column) => records.some((cells) => MEMBER_ID.test(String(cells[column] ?? '').trim())));
  const last = lower.findIndex((header) => /last\s*name|surname/.test(header));
  const first = lower.findIndex((header) => /first\s*name|given/.test(header));
  const nameColumn = lower.findIndex((header) => /name/.test(header) && !/last|first|team|activity|household/.test(header));
  return records.map((cells) => {
    const memberId = idColumn === -1 ? null : (String(cells[idColumn] ?? '').match(/[A-Z]{2}-\d{4}-\d+/i)?.[0]?.toUpperCase() ?? null);
    let name = '';
    if (last !== -1 && first !== -1) name = `${cells[last] ?? ''}, ${cells[first] ?? ''}`;
    else if (nameColumn !== -1) name = cells[nameColumn] ?? '';
    else name = cells.find((cell, column) => column !== idColumn && /[a-z]{2}/i.test(cell)) ?? '';
    return { memberId, name: String(name).replace(/\s+/g, ' ').trim(), cells, source: 'ogd' };
  }).filter((attendee) => attendee.memberId || attendee.name);
}

// ---------- Reading the list ----------

const COLUMN_PATTERNS = {
  name: /activity\s*name/i, type: /^type$/i, area: /^area$/i, start: /start/i, end: /end/i,
  leader: /leader/i, venue: /venue/i, attendance: /attend/i,
};

function readActivitiesTable(frame) {
  return frame.evaluate((patterns) => {
    const text = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const regex = Object.fromEntries(Object.entries(patterns).map(([key, source]) => [key, new RegExp(source, 'i')]));
    for (const table of document.querySelectorAll('table')) {
      const rows = [...table.rows];
      const headerIndex = rows.findIndex((row) => {
        const labels = [...row.cells].map(text);
        return labels.some((label) => regex.name.test(label)) && labels.some((label) => regex.start.test(label));
      });
      if (headerIndex === -1) continue;
      const headers = [...rows[headerIndex].cells].map(text);
      const column = Object.fromEntries(Object.keys(regex).map((key) => [key, headers.findIndex((header) => regex[key].test(header))]));
      document.querySelectorAll('[data-oracle-act]').forEach((el) => el.removeAttribute('data-oracle-act'));
      const records = [];
      for (const row of rows.slice(headerIndex + 1)) {
        if (row.cells.length !== headers.length || row.querySelector('table')) continue;
        const cells = [...row.cells].map(text);
        if (!cells[column.name]) continue;
        const index = records.length;
        const linkIn = (columnIndex, tag) => {
          if (columnIndex === -1) return { href: null, tagged: false };
          const link = row.cells[columnIndex].querySelector('a, [onclick]');
          if (!link) return { href: null, tagged: false };
          link.setAttribute('data-oracle-act', `${index}-${tag}`);
          return { href: link.getAttribute('href') || '', tagged: true };
        };
        const nameLink = linkIn(column.name, 'name');
        const attendanceLink = linkIn(column.attendance, 'attendance');
        const pick = (key) => (column[key] === -1 ? '' : cells[column[key]]);
        records.push({
          index, cells,
          name: pick('name'), type: pick('type'), area: pick('area'), start: pick('start'), end: pick('end'),
          leader: pick('leader'), venue: pick('venue'), attendance: pick('attendance'),
          nameHref: nameLink.href, hasNameLink: nameLink.tagged,
          attendanceHref: attendanceLink.href, hasAttendanceLink: attendanceLink.tagged,
        });
      }
      return { headers, records };
    }
    return null;
  }, Object.fromEntries(Object.entries(COLUMN_PATTERNS).map(([key, value]) => [key, value.source])));
}

async function findActivitiesTable(page, timeoutMs) {
  const end = Date.now() + timeoutMs;
  do {
    for (const frame of page.frames()) {
      const table = await readActivitiesTable(frame).catch(() => null);
      if (table) return { frame, table };
    }
    if (timeoutMs) await page.waitForTimeout(POLL_MS);
  } while (Date.now() < end);
  return null;
}

async function visibleLinkTexts(page) {
  const texts = new Set();
  for (const frame of page.frames()) {
    const found = await frame.evaluate(() => [...document.querySelectorAll('a, input[type=submit], input[type=button], button')]
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => (el.value || el.innerText || '').replace(/\s+/g, ' ').trim())
      .filter((text) => text && text.length <= 40)).catch(() => []);
    found.forEach((text) => texts.add(text));
  }
  return [...texts].slice(0, 60).join(', ');
}

async function clickFirstVisible(page, makeLocator) {
  for (const frame of page.frames()) {
    const locator = makeLocator(frame);
    for (let index = 0; index < (await locator.count().catch(() => 0)); index += 1) {
      const element = locator.nth(index);
      if (await element.isVisible().catch(() => false)) {
        await submitAndSettle(page, () => element.click());
        return true;
      }
    }
  }
  return false;
}

// Opens the Activities tab from OGD's signed-in page.
async function openActivities(page) {
  const menuText = /^\s*activities\s*$/i;
  const menu = (frame) => frame.locator('a').filter({ hasText: menuText }).or(frame.locator('[onclick]').filter({ hasText: menuText }));
  if (await clickFirstVisible(page, menu)) {
    const found = await findActivitiesTable(page, TABLE_WAIT_MS);
    if (found) return found;
  }
  const go = (frame) => frame.locator('input[type=submit], input[type=button], button').filter({ hasText: /^\s*(go|search)\s*$/i })
    .or(frame.locator('input[type=submit][value="GO" i], input[type=button][value="GO" i]'));
  if (await clickFirstVisible(page, go)) {
    const found = await findActivitiesTable(page, TABLE_WAIT_MS);
    if (found) return found;
  }
  throw new AutomationFailure(ACTIVITY_FAILURES.page, `No Activities list on ${new URL(page.url()).pathname} titled "${await page.title()}". Links seen: ${await visibleLinkTexts(page)}`);
}

const firstKey = (table) => table.records[0]?.cells.join('|') ?? '';

async function waitForNextPage(page, previousKey) {
  const end = Date.now() + PAGE_CHANGE_WAIT_MS;
  while (Date.now() < end) {
    await page.waitForTimeout(POLL_MS);
    const found = await findActivitiesTable(page, 0);
    if (found?.table.records.length && firstKey(found.table) !== previousKey) return found;
  }
  return null;
}

// ---------- Opening one activity ----------

// Label/value fields on an activity's page: form controls with their labels,
// and two-cell "Label | value" rows.
function readDetailFields(frame, activityName) {
  return frame.evaluate((name) => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    // OGD's own control names (ctl00$ContentPlaceHolder1$cboType) and
    // unchosen filter values ("-- show all --") are page furniture, not details.
    const isJunkLabel = (label) => /[$_]|^ctl\d|^(txt|cbo|ddl|btn|chk|lbl|hdn)[A-Z]/.test(label) || !/\s/.test(label) && /[a-z][A-Z]/.test(label);
    const isJunkValue = (value) => /^-+\s*(show all|select|all|choose|none)[^-]*-*$/i.test(value);
    const norm = (value) => clean(value).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
    const body = norm(document.body?.innerText);
    const shows = (value) => body.includes(norm(value)) || [...document.querySelectorAll('input, textarea')].some((el) => norm(el.value) === norm(value));
    if (!shows(name)) return null;
    const isShown = (el) => el.getClientRects().length > 0;
    const fields = {};
    const labelOf = (el) => {
      if (el.id) {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (label) return clean(label.innerText);
      }
      const cell = el.closest('td, th');
      let previous = cell?.previousElementSibling;
      while (previous && !clean(previous.innerText)) previous = previous.previousElementSibling;
      if (previous) return clean(previous.innerText);
      return clean(el.getAttribute('placeholder') || el.getAttribute('title') || el.name || el.id);
    };
    for (const el of document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image]), select, textarea')) {
      if (!isShown(el)) continue;
      const label = labelOf(el).replace(/[:*]+$/, '').trim();
      if (!label || label.length > 60 || isJunkLabel(label)) continue;
      let value = '';
      if (el.tagName === 'SELECT') value = clean(el.options[el.selectedIndex]?.text);
      else if (el.type === 'checkbox' || el.type === 'radio') { if (!el.checked) continue; value = 'Yes'; }
      else value = clean(el.value);
      if (value && !isJunkValue(value)) fields[label] = fields[label] ? `${fields[label]} ${value}` : value;
    }
    for (const row of document.querySelectorAll('tr')) {
      if (row.querySelector('table, input, select, textarea') || row.cells.length !== 2) continue;
      const label = clean(row.cells[0].innerText).replace(/[:*]+$/, '').trim();
      const value = clean(row.cells[1].innerText);
      if (label && value && label.length <= 60 && !fields[label] && !isJunkLabel(label) && !isJunkValue(value)) fields[label] = value;
    }
    return Object.keys(fields).length >= 2 ? { fields } : null;
  }, activityName);
}

// The attendee list: a table with a Name heading that is not the Activities list.
function readAttendeeTable(frame) {
  return frame.evaluate(() => {
    const text = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    const idPattern = /^[A-Z]{2}-\d{4}-\d+$/i;
    let best = null;
    for (const table of document.querySelectorAll('table')) {
      if (table.querySelector('table')) continue;
      const rows = [...table.rows];
      const headerIndex = rows.findIndex((row) => row.cells.length >= 2 && [...row.cells].some((cell) => /name/i.test(text(cell)) && text(cell).length <= 40));
      if (headerIndex === -1) continue;
      const headers = [...rows[headerIndex].cells].map(text);
      if (headers.some((header) => /activity\s*name/i.test(header))) continue;
      const records = rows.slice(headerIndex + 1).filter((row) => row.cells.length === headers.length).map((row) => [...row.cells].map(text)).filter((cells) => cells.some(Boolean));
      const score = records.length + (records.some((cells) => cells.some((cell) => idPattern.test(cell))) ? 1000 : 0) + (/attend|participant|member/i.test(headers.join(' ')) ? 100 : 0);
      if (!best || score > best.score) best = { headers, records, score, table };
    }
    if (!best) return null;
    document.querySelectorAll('[data-oracle-att]').forEach((el) => el.removeAttribute('data-oracle-att'));
    best.table.setAttribute('data-oracle-att', '1');
    return { headers: best.headers, records: best.records };
  });
}

// Shows as many attendee rows per page as the list allows ("Show 10 entries"
// lists and page-size dropdowns). Returns true when it changed something.
function widenAttendeeTable(frame) {
  return frame.evaluate(() => {
    const selects = [...document.querySelectorAll('select')].filter((select) => select.getClientRects().length > 0
      && (/_length$|pagesize|page_size|rows|perpage|per_page/i.test(`${select.name} ${select.id}`) || select.closest('.dataTables_length, .dt-length'))
      && [...select.options].every((option) => /^(-1|\d+|all)$/i.test(option.value.trim()) || /^(\d+|all)$/i.test(option.text.trim())));
    let changed = false;
    for (const select of selects) {
      const best = [...select.options].reduce((top, option) => {
        const size = option.value.trim() === '-1' || /all/i.test(option.text) ? Infinity : Number(option.value || option.text);
        return size > top.size ? { option, size } : top;
      }, { option: null, size: -Infinity });
      if (best.option && select.value !== best.option.value) {
        select.value = best.option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        changed = true;
      }
    }
    return changed;
  });
}

// Moves an attendee list to its next page. Looks only around the attendee
// table (never at the Activities list's own pager): a Next button or link, the
// next page number, a page dropdown, else the ASP.NET GridView pager. Marks
// the control and clicks it for real, so OGD's postbacks run as usual.
// current is the page number now showing (1 at the start).
async function nextAttendeePage(frame, current) {
  const how = await frame.evaluate((pageNow) => {
    const text = (el) => (el.value || el.innerText || el.textContent || el.title || el.alt || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    const shown = (el) => el.getClientRects().length > 0;
    document.querySelectorAll('[data-oracle-next]').forEach((el) => el.removeAttribute('data-oracle-next'));
    const table = document.querySelector('[data-oracle-att]');
    if (!table) return null;
    const activities = [...document.querySelectorAll('table')].find((other) => other !== table && !table.contains(other)
      && [...other.rows].slice(0, 3).some((row) => /activity\s*name/i.test(text(row))));
    // The widest container around the table that does not hold the Activities list.
    let scope = table;
    for (let up = table.parentElement; up && up !== document.documentElement; up = up.parentElement) {
      if (activities && up.contains(activities)) break;
      scope = up;
    }
    // Links inside the attendee rows themselves (names, edit buttons) are not paging.
    const inDataRow = (el) => {
      const row = el.closest('tr');
      return Boolean(row) && row.closest('table') === table && row.cells.length > 2 && !/pager|pgr|paging|pagination/i.test(row.className);
    };
    const disabled = (el) => el.disabled || /disabled|inactive/i.test(el.className) || el.closest('.disabled') || el.getAttribute('aria-disabled') === 'true';
    const clickables = [...scope.querySelectorAll('a, button, input[type=button], input[type=submit], input[type=image], [onclick], li[role=button], span[role=button]')]
      .filter((el) => shown(el) && !inDataRow(el));
    const mark = (el, kind) => { el.setAttribute('data-oracle-next', '1'); return kind; };
    const next = clickables.find((el) => /^(next|next page|>|›|»|>>|→|next\s*[>›»]+)$/i.test(text(el)) || /\bnext\b/i.test(el.getAttribute('aria-label') || el.className || ''));
    if (next) return disabled(next) ? 'end' : mark(next, 'next');
    const numbered = clickables.find((el) => text(el) === String(pageNow + 1) && !disabled(el));
    if (numbered) return mark(numbered, 'number');
    const dots = clickables.find((el) => /^(\.\.\.|…)$/.test(text(el)) && (!el.closest('td, li')?.previousElementSibling || /\d/.test(text(el.closest('td, li').previousElementSibling))));
    if (dots && pageNow % 10 === 0) return mark(dots, 'dots');
    const pageSelect = [...scope.querySelectorAll('select')].find((select) => shown(select) && select.options.length > 1
      && [...select.options].every((option, index) => text(option) === String(index + 1) || /^page\s*\d+/i.test(text(option))));
    if (pageSelect) {
      if (pageSelect.selectedIndex + 1 >= pageSelect.options.length) return 'end';
      pageSelect.selectedIndex += 1;
      pageSelect.dispatchEvent(new Event('change', { bubbles: true }));
      return 'select';
    }
    // The page-wide GridView pager is only safe when the Activities list is not on this page.
    return activities ? 'end' : null;
  }, current).catch(() => null);
  if (how === 'end') return false;
  if (how === 'select') return true;
  if (how) {
    await frame.locator('[data-oracle-next]').first().click({ timeout: 10000 }).catch(() => null);
    return true;
  }
  return (await pagerAction(frame, 'next').catch(() => ({ moved: false }))).moved;
}

// What sits around the attendee table, for fixing paging when it fails.
function describeAttendeePager(frame) {
  return frame.evaluate(() => {
    const table = document.querySelector('[data-oracle-att]');
    if (!table) return 'attendee table not found';
    const text = (el) => (el.value || el.innerText || el.textContent || el.title || el.alt || '').replace(/\s+/g, ' ').trim().slice(0, 30);
    const activities = [...document.querySelectorAll('table')].find((other) => other !== table && !table.contains(other)
      && [...other.rows].slice(0, 3).some((row) => /activity\s*name/i.test(row.innerText || '')));
    let scope = table;
    for (let up = table.parentElement; up && up !== document.documentElement; up = up.parentElement) {
      if (activities && up.contains(activities)) break;
      scope = up;
    }
    const items = [...scope.querySelectorAll('a, button, input:not([type=hidden]), select, [onclick]')]
      .filter((el) => el.getClientRects().length > 0 && !(el.closest('tr')?.closest('table') === table && el.closest('tr').cells.length > 2))
      .slice(0, 25)
      .map((el) => `${el.tagName.toLowerCase()}${el.type ? `[${el.type}]` : ''}${el.className ? `.${String(el.className).split(/\s+/)[0]}` : ''} "${text(el)}"${el.getAttribute('href') ? ` href=${el.getAttribute('href').slice(0, 50)}` : ''}${el.getAttribute('onclick') ? ` onclick=${el.getAttribute('onclick').slice(0, 50)}` : ''}`);
    const lastRow = table.rows[table.rows.length - 1];
    return `rows ${table.rows.length}; last row: ${(lastRow?.innerText || '').replace(/\s+/g, ' ').slice(0, 80)}; controls near it: ${items.join(' | ') || 'none'}`;
  }).catch(() => 'could not describe the attendee list');
}

const MAX_ATTENDEE_LIST_PAGES = 50;
const recordsKey = (table) => JSON.stringify(table?.records ?? []);

// The whole attendee list across all its pages. Paging looks only around the
// attendee table, so the Activities list's own pager is never touched.
async function readAllAttendees(frame) {
  let table = await readAttendeeTable(frame);
  if (!table) return null;
  const page = frame.page();
  const waitForChange = async (before) => {
    for (let wait = 0; wait < 30; wait += 1) {
      await page.waitForTimeout(POLL_MS);
      const now = await readAttendeeTable(frame).catch(() => null);
      if (now && recordsKey(now) !== before) return now;
    }
    return null;
  };
  if (await widenAttendeeTable(frame).catch(() => false)) table = await waitForChange(recordsKey(table)) ?? table;
  const seen = new Set(table.records.map((cells) => cells.join('|')));
  const records = [...table.records];
  let pages = 1;
  let stopped = '';
  for (; pages < MAX_ATTENDEE_LIST_PAGES; pages += 1) {
    const before = recordsKey(await readAttendeeTable(frame).catch(() => null));
    if (!(await nextAttendeePage(frame, pages))) { stopped = 'no next page control'; break; }
    const next = await waitForChange(before);
    if (!next) { stopped = 'the list did not change after next page'; break; }
    const fresh = next.records.filter((cells) => !seen.has(cells.join('|')));
    if (!fresh.length) { stopped = 'next page showed no new rows'; break; }
    fresh.forEach((cells) => seen.add(cells.join('|')));
    records.push(...fresh);
  }
  // Kept for when OGD's count is higher than what was read.
  const pager = stopped && pages === 1 ? `${stopped}; ${await describeAttendeePager(frame)}` : null;
  return { headers: table.headers, records, pages, pager };
}

function isRealHref(href) {
  return Boolean(href) && !/^(javascript:|#)/i.test(href);
}

async function closeOverlays(page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let open = false;
    for (const frame of page.frames()) {
      if (await frame.locator(MODAL_CONTAINERS).first().isVisible().catch(() => false)) open = true;
      const close = frame.locator(MODAL_CLOSE).first();
      if (await close.isVisible().catch(() => false)) {
        await close.click({ force: true, timeout: 5000 }).catch(() => null);
        open = true;
        break;
      }
    }
    if (!open) return;
    await page.keyboard.press('Escape').catch(() => null);
    await page.waitForTimeout(POLL_MS);
  }
}

// Opens one of a row's links and runs read(frame) on whatever it shows: a
// new tab, a popup, or the page itself. Real addresses open in their own tab
// so the list stays put. Returns { result } or { result: null, lost } where
// lost means the list page could not be got back.
async function openAndRead(page, list, row, tag, read) {
  const href = tag === 'name' ? row.nameHref : row.attendanceHref;
  const context = page.context();
  if (isRealHref(href)) {
    const tab = await context.newPage();
    try {
      await tab.goto(new URL(href, list.frame.url()).href, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT_MS });
      const end = Date.now() + OPEN_WAIT_MS;
      do {
        for (const frame of tab.frames()) {
          const result = await read(frame).catch(() => null);
          if (result) return { result, url: tab.url() };
        }
        await tab.waitForTimeout(POLL_MS);
      } while (Date.now() < end);
      return { result: null, url: tab.url() };
    } finally {
      await tab.close().catch(() => null);
    }
  }

  const before = new Set(page.frames());
  const startUrl = page.url();
  const opened = [];
  const onPage = (newPage) => opened.push(newPage);
  context.on('page', onPage);
  let found = null;
  try {
    await list.frame.locator(`[data-oracle-act="${row.index}-${tag}"]`).first().click({ timeout: 10000 });
    const end = Date.now() + OPEN_WAIT_MS;
    while (!found && Date.now() < end) {
      await page.waitForTimeout(POLL_MS);
      const navigated = page.url() !== startUrl || list.frame.isDetached();
      // New tabs, new frames (OGD's popups load in their own frame), the whole
      // page after it navigated, or the list's frame once a dialog shows in it.
      const dialogInList = !navigated && await list.frame.locator(MODAL_CONTAINERS).first().isVisible().catch(() => false);
      const frames = [
        ...opened.flatMap((shown) => (shown.isClosed() ? [] : shown.frames())),
        ...page.frames().filter((frame) => navigated || !before.has(frame) || (dialogInList && frame === list.frame)),
      ];
      for (const frame of frames) {
        const result = await read(frame).catch(() => null);
        if (result) {
          found = { result, url: frame.url() };
          break;
        }
      }
    }
  } finally {
    context.off('page', onPage);
    for (const shown of opened) await shown.close().catch(() => null);
  }
  await closeOverlays(page);
  if (page.url() !== startUrl) {
    await page.goBack({ waitUntil: 'load', timeout: NAVIGATION_TIMEOUT_MS }).catch(() => null);
  }
  const back = await findActivitiesTable(page, TABLE_WAIT_MS);
  const lost = !back || firstKey(back.table) !== firstKey(list.table);
  if (back && !lost) {
    list.frame = back.frame;
    list.table = back.table;
  }
  return { ...(found ?? { result: null }), lost };
}

// ---------- Sync ----------

// Run on OGD's signed-in page. Reads every activity starting between from and
// to (YYYY-MM-DD, Manila dates, inclusive), newest first, with details and
// attendees, until deadline. Never throws once the list is open, so what was
// read is kept.
export function createActivitiesSync({ from, to, deadline }) {
  const fromMs = new Date(`${from}T00:00:00+08:00`).getTime();
  const toMs = new Date(`${to}T23:59:59+08:00`).getTime();
  return async function syncActivities(page) {
    const list = await openActivities(page);
    const activities = [];
    const notes = [];
    let isPartial = false;
    let pageNumber = 1;
    try {
      for (; pageNumber <= MAX_PAGES; pageNumber += 1) {
        let olderOnPage = 0;
        for (const record of list.table.records) {
          const startsAt = parseOgdDate(record.start);
          const startMs = startsAt ? new Date(startsAt).getTime() : null;
          if (startMs !== null && startMs < fromMs) { olderOnPage += 1; continue; }
          if (startMs !== null && startMs > toMs) continue;
          const activity = {
            name: record.name, type: record.type, area: record.area, start: record.start, end: record.end,
            startsAt, endsAt: parseOgdDate(record.end), leader: record.leader, venue: record.venue,
            attendanceCount: Number((record.attendance.match(/\d+/) ?? [])[0] ?? NaN),
            nameHref: isRealHref(record.nameHref) ? new URL(record.nameHref, list.frame.url()).href : null,
            attendanceHref: isRealHref(record.attendanceHref) ? new URL(record.attendanceHref, list.frame.url()).href : null,
            details: null, attendeeTable: null,
          };
          if (Number.isNaN(activity.attendanceCount)) activity.attendanceCount = null;
          activities.push(activity);
          if (Date.now() > deadline) { isPartial = true; continue; }

          const row = list.table.records.find((candidate) => candidate.cells.join('|') === record.cells.join('|')) ?? record;
          if (row.hasAttendanceLink) {
            const opened = await openAndRead(page, list, row, 'attendance', readAllAttendees).catch((error) => ({ result: null, error }));
            if (opened.result) {
              activity.attendeeTable = opened.result;
              if (opened.result.pager && activity.attendanceCount > opened.result.records.length) {
                notes.push(`${record.name}: read ${opened.result.records.length} of ${activity.attendanceCount} attendees (${opened.result.pager})`);
              }
            }
            else notes.push(`${record.name}: attendees not found${opened.error ? ` (${String(opened.error.message).split('\n')[0].slice(0, 120)})` : ''}`);
            if (opened.lost) throw new Error('the Activities list did not come back after opening an attendance list');
          }
          if (row.hasNameLink && Date.now() < deadline) {
            const freshRow = list.table.records.find((candidate) => candidate.cells.join('|') === record.cells.join('|')) ?? row;
            const opened = await openAndRead(page, list, freshRow, 'name', async (frame) => {
              const details = await readDetailFields(frame, record.name);
              if (!details) return null;
              const attendees = activity.attendeeTable ? null : await readAllAttendees(frame).catch(() => null);
              return { ...details, attendees, url: frame.url() };
            }).catch((error) => ({ result: null, error }));
            if (opened.result) {
              activity.details = opened.result.fields;
              if (!activity.attendeeTable && opened.result.attendees?.records.length) activity.attendeeTable = opened.result.attendees;
              if (!activity.nameHref && /[?&]\w+=/.test(opened.url ?? '')) activity.nameHref = opened.url;
            } else notes.push(`${record.name}: details not found`);
            if (opened.lost) throw new Error('the Activities list did not come back after opening an activity');
          }
        }
        // OGD lists the newest first, so a page that is all older is the end.
        if (olderOnPage && olderOnPage === list.table.records.length) break;
        if (Date.now() > deadline) { isPartial = true; break; }
        const key = firstKey(list.table);
        const { moved } = await pagerAction(list.frame, 'next').catch(() => ({ moved: false }));
        if (!moved) break;
        const next = await waitForNextPage(page, key);
        if (!next) { notes.push(`page ${pageNumber + 1} did not load`); isPartial = true; break; }
        list.frame = next.frame;
        list.table = next.table;
      }
    } catch (error) {
      isPartial = true;
      notes.push(`Stopped early: ${String(error?.message ?? error).split('\n')[0].slice(0, 300)}`);
    }
    return { activities, isPartial, pagesRead: pageNumber, notes: notes.join('; ').slice(0, DETAIL_LIMIT) };
  };
}

// ---------- Creating an activity ----------

function snapshotForm(frame) {
  return frame.evaluate((modalCss) => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const isShown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    // A popup form (OGD's Add New Activity) is read on its own, not with the page behind it.
    const root = [...document.querySelectorAll(modalCss)].find((el) => isShown(el) && el.querySelector('input, select, textarea')) ?? document;
    // Text written right before a control in the same cell ("Topic [list]").
    // Stops at another control, so "to" between two date boxes is skipped.
    const inlineLabel = (el) => {
      for (let node = el; node && !/^(TD|TH|BODY|FORM|TR|TABLE)$/.test(node.tagName); node = node.parentElement) {
        for (let prev = node.previousSibling; prev; prev = prev.previousSibling) {
          if (prev.nodeType === 3) {
            const text = clean(prev.textContent);
            if (!text || /^(to|and|-|–|from|:)$/i.test(text)) continue;
            return text.length <= 40 ? text : '';
          }
          if (prev.nodeType !== 1) continue;
          if (prev.tagName === 'BR') continue;
          if (prev.matches('input, select, textarea, button') || prev.querySelector('input, select, textarea')) return '';
          const text = clean(prev.innerText || prev.textContent);
          if (!text) continue;
          return text.length <= 40 ? text : '';
        }
      }
      return '';
    };
    const labelOf = (el) => {
      if (el.id) {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (label) return clean(label.innerText);
      }
      const wrapping = el.closest('label');
      if (wrapping) return clean(wrapping.innerText);
      const inline = inlineLabel(el);
      if (inline) return inline;
      const cell = el.closest('td, th');
      let previous = cell?.previousElementSibling;
      while (previous && !clean(previous.innerText)) previous = previous.previousElementSibling;
      if (previous) return clean(previous.innerText);
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      walker.currentNode = el;
      for (let steps = 0; steps < 15 && walker.previousNode(); steps += 1) {
        const text = clean(walker.currentNode.textContent);
        if (text) return text.slice(0, 60);
      }
      return clean(el.getAttribute('placeholder') || el.name || el.id);
    };
    // A Select2 search box (OGD's Team Leader) hides its real list beside it.
    const select2Of = (el) => {
      if (el.tagName !== 'SELECT') return null;
      if (!el.matches('.select2-hidden-accessible, .select2-offscreen') && isShown(el)) return null;
      const next = el.nextElementSibling;
      if (next?.matches('.select2, .select2-container') && isShown(next)) return next;
      const old = el.id && document.getElementById(`s2id_${el.id}`);
      return old && isShown(old) ? old : null;
    };
    const controls = [...root.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image]):not([type=checkbox]):not([type=radio]), select, textarea')]
      .filter((el) => !el.closest('.select2-container, .select2-drop, .select2-dropdown') && (select2Of(el) || isShown(el)))
      .map((el, index) => {
        el.setAttribute('data-oracle-field', String(index));
        const select2 = select2Of(el);
        if (select2) select2.setAttribute('data-oracle-select2', String(index));
        return {
          dressed: Boolean(select2),
          index, tag: el.tagName.toLowerCase(), type: (el.getAttribute('type') || '').toLowerCase(), id: el.id, name: el.name,
          label: labelOf(el).replace(/[:*]+$/, '').trim(), readOnly: el.readOnly, value: el.value,
          hint: clean(`${el.name} ${el.id} ${el.getAttribute('placeholder') || ''}`),
          options: el.tagName === 'SELECT' ? [...el.options].map((option) => ({ value: option.value, text: clean(option.text) })) : [],
        };
      });
    const buttons = [...root.querySelectorAll('input[type=submit], input[type=button], button, a.btn, a[id*="btn" i]')]
      .filter(isShown).map((el, index) => {
        el.setAttribute('data-oracle-button', String(index));
        return { index, text: clean(el.value || el.innerText || el.textContent) };
      }).filter((button) => button.text);
    return { path: location.pathname, controls, buttons, text: clean((root === document ? document.body : root)?.innerText).slice(0, 1500) };
  }, MODAL_CONTAINERS);
}

function describeForm(form) {
  const controls = form.controls.map((control) => `${control.label || control.hint || control.tag}${control.options.length ? ` [${control.options.map((option) => option.text).slice(0, 15).join(' / ')}]` : ''}`);
  return `Form ${form.path}: fields ${controls.join('; ')} | buttons ${form.buttons.map((button) => button.text).slice(0, 15).join(', ')}`.slice(0, DETAIL_LIMIT);
}

const looksLikeForm = (form) => form.controls.some((control) => /name|title/i.test(`${control.label} ${control.hint}`))
  && form.controls.some((control) => /start|date|from/i.test(`${control.label} ${control.hint}`));

async function waitForNewActivityForm(page, opened) {
  const end = Date.now() + TABLE_WAIT_MS;
  let seen = '';
  while (Date.now() < end) {
    const pages = [...opened.filter((shown) => !shown.isClosed()), page];
    for (const shown of pages) {
      for (const frame of shown.frames()) {
        const form = await snapshotForm(frame).catch(() => null);
        // The list's own Search box is not the form, so the form needs a few boxes.
        if (form && looksLikeForm(form) && form.controls.length >= 3) return { page: shown, frame, form };
        if (form) seen = describeForm(form);
      }
    }
    await page.waitForTimeout(POLL_MS);
  }
  throw new AutomationFailure(ACTIVITY_FAILURES.form, `The New Activity form did not open. ${seen}`);
}

function findControl(form, pattern, { tag, exclude } = {}) {
  return form.controls.find((control) => (!tag || control.tag === tag)
    && pattern.test(control.label || control.hint) && !(exclude && exclude.test(control.label || control.hint)))
    ?? form.controls.find((control) => (!tag || control.tag === tag) && pattern.test(control.hint) && !(exclude && exclude.test(control.hint)));
}

function pickOption(control, wanted) {
  const target = normalizeText(wanted);
  if (!target) return null;
  return control.options.find((option) => normalizeText(option.text) === target)
    ?? control.options.find((option) => normalizeText(option.value) === target)
    ?? control.options.find((option) => normalizeText(option.text).includes(target) && option.value)
    ?? control.options.find((option) => target.includes(normalizeText(option.text)) && normalizeText(option.text).length > 3 && option.value);
}

async function setControl(page, frame, control, value) {
  const locator = frame.locator(`[data-oracle-field="${control.index}"]`);
  if (control.tag === 'select') {
    const loaded = page.waitForEvent('load', { timeout: 3000 }).catch(() => null);
    await locator.selectOption(value);
    await loaded;
    return;
  }
  // Script sets the value too, since OGD's date pickers are often read-only.
  await locator.evaluate((el, next) => {
    el.removeAttribute('readonly');
    el.focus();
    el.value = next;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
  }, value);
}

// Picks a person in a Select2 search box (v4 or v3): opens it, types the
// name (last name first, then the whole name) and clicks the result whose
// text holds every part of the name. Returns { ok, text } or { ok: false, reason }.
const SELECT2_SEARCH = '.select2-container--open .select2-search__field, .select2-drop-active input.select2-input, .select2-dropdown input[type=search], .select2-search input';
const SELECT2_RESULTS = '.select2-results__option, .select2-results li.select2-result-selectable, .select2-result-selectable';
const nameParts = (text) => normalizeText(text).split(' ').filter((part) => part.length > 1);

// Marks the Select2 box (and the field holding its value) on the row whose
// label matches, inside the open popup. Returns { found, html }, where html is
// a trimmed copy of the row for the error message when it cannot be used.
function markSearchBox(frame, labelPattern, key) {
  return frame.evaluate(({ modalCss, source, flags, key }) => {
    const pattern = new RegExp(source, flags);
    const isShown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const root = [...document.querySelectorAll(modalCss)].find((el) => isShown(el) && el.querySelector('input, select, textarea')) ?? document.body;
    const label = [...root.querySelectorAll('label, td, th, span, div, b, strong, p')]
      .find((el) => isShown(el) && pattern.test(el.innerText || '') && !el.querySelector('input, select, textarea'));
    if (!label) return { found: false, html: '' };
    let row = label.closest('tr, .form-group, .row, li') ?? label.parentElement;
    while (row && row !== root && !row.querySelector('.select2-container, .select2, input, select')) row = row.parentElement;
    if (!row) return { found: false, html: '' };
    const box = [...row.querySelectorAll('.select2-container, span.select2')].find((el) => isShown(el) && !el.closest('.select2-drop, .select2-dropdown'));
    const value = row.querySelector('select, input[type=hidden]:not([name^="__"])');
    const html = row.outerHTML.replace(/\s(value|style|onclick|onchange)="[^"]*"/g, '').replace(/\s+/g, ' ').slice(0, 900);
    if (!box) return { found: false, html };
    box.setAttribute('data-oracle-box', key);
    if (value) value.setAttribute('data-oracle-value', key);
    return { found: true, html };
  }, { modalCss: MODAL_CONTAINERS, source: labelPattern.source, flags: labelPattern.flags, key });
}

// Closes an open Select2 dropdown in this frame. Never with the Escape key:
// OGD's popups (simplemodal) close on Escape too, taking the form with them.
async function closeSelect2(frame) {
  await frame.evaluate(() => {
    const $ = window.jQuery;
    if ($?.fn?.select2) {
      $('select, input[type=hidden], input[type=text]').each((_, el) => {
        try { if ($(el).data('select2')) $(el).select2('close'); } catch { /* not a Select2 box */ }
      });
    }
    // Select2 v3 also closes when its mask behind the dropdown is pressed.
    document.getElementById('select2-drop-mask')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  }).catch(() => null);
}

async function chooseSearchOption(page, frame, key, wanted, prefer = '') {
  const parts = nameParts(wanted);
  if (!parts.length) return { ok: false, reason: 'no name to search for' };
  const container = frame.locator(`[data-oracle-box="${key}"]`).first();
  const lastName = String(wanted).split(',')[0].trim();
  const terms = [...new Set([lastName, String(wanted).trim()].filter((term) => term && term.length > 1))];
  let seen = [];
  for (const term of terms) {
    await closeSelect2(frame);
    const opener = container.locator('.select2-selection, .select2-choice, .select2-choices, .select2-search__field, input.select2-input').first();
    if (await opener.count()) await opener.click({ timeout: 8000 }); else await container.click({ timeout: 8000 });
    const search = frame.locator(SELECT2_SEARCH).locator('visible=true').first();
    if (!(await search.isVisible({ timeout: 4000 }).catch(() => false))) return { ok: false, reason: 'its search box did not open' };
    await search.fill('');
    await search.pressSequentially(term, { delay: 60 });
    // Results come from OGD as you type; wait for them to stop changing.
    const end = Date.now() + 12000;
    let last = '';
    let stable = 0;
    while (Date.now() < end) {
      await page.waitForTimeout(500);
      const texts = await frame.locator(SELECT2_RESULTS).locator('visible=true').allInnerTexts().catch(() => []);
      const real = texts.map((text) => text.replace(/\s+/g, ' ').trim()).filter((text) => text && !/searching|loading|please enter|no (results|matches)|not found|more characters/i.test(text));
      const key2 = real.join('|');
      stable = key2 && key2 === last ? stable + 1 : 0;
      last = key2;
      seen = real;
      if (stable >= 2) break;
    }
    const matches = seen.filter((text) => parts.every((part) => normalizeText(text).split(' ').includes(part) || normalizeText(text).includes(part)));
    if (matches.length) {
      const byPrefer = prefer ? matches.find((text) => normalizeText(text).includes(normalizeText(prefer))) : null;
      // With a Member ID to go by, a same-name match showing another ID is someone else.
      const showsIds = matches.some((text) => /[A-Z]{2}-\d{4}-\d+/i.test(text));
      if (prefer && showsIds && !byPrefer) {
        await closeSelect2(frame);
        return { ok: false, reason: `not among OGD's matches (${matches.slice(0, 8).join(' / ')})` };
      }
      const pick = byPrefer ?? matches.find((text) => normalizeText(text) === normalizeText(wanted)) ?? matches[0];
      const option = frame.locator(SELECT2_RESULTS).locator('visible=true').filter({ hasText: pick }).first();
      const loaded = page.waitForEvent('load', { timeout: 3000 }).catch(() => null);
      await option.click({ timeout: 8000 });
      await loaded;
      await page.waitForTimeout(300);
      const value = await frame.locator(`[data-oracle-value="${key}"]`).first().inputValue({ timeout: 2000 }).catch(() => '');
      const shown = await container.innerText({ timeout: 2000 }).catch(() => '');
      if ((value && value !== '0') || parts.every((part) => normalizeText(shown).includes(part))) return { ok: true, text: pick };
      return { ok: false, reason: `clicked "${pick}" but OGD did not keep it` };
    }
  }
  await closeSelect2(frame);
  return { ok: false, reason: seen.length ? `not among OGD's matches (${seen.slice(0, 8).join(' / ')})` : 'OGD found nobody by that name' };
}

// Fills one Start or End group: a single date-time box, or a date box with
// time boxes or hour/minute/AM-PM lists.
async function fillWhen(page, frame, form, pattern, iso, filled) {
  const parts = manilaParts(iso);
  const group = form.controls.filter((control) => pattern.test(control.label || control.hint) || pattern.test(control.hint));
  if (!group.length) return false;
  for (const control of group) {
    const label = `${control.label} ${control.hint}`;
    if (control.tag === 'select') {
      const texts = control.options.map((option) => option.text.toUpperCase());
      let wanted = null;
      if (texts.includes('AM') && texts.includes('PM')) wanted = parts.meridiem;
      else if (texts.some((text) => text === '59' || text === '45' || text === '30') && !texts.some((text) => text === '13')) {
        wanted = /hour|hh/i.test(label) ? parts.hour12 : parts.minute;
      } else if (texts.some((text) => /^(0?[1-9]|1[0-2])$/.test(text)) && texts.length <= 14) wanted = parts.hour12;
      else if (texts.some((text) => text === '23')) wanted = parts.hour24;
      else if (texts.some((text) => /\d{1,2}:\d{2}\s*[AP]M/.test(text))) wanted = parts.time12;
      if (!wanted) continue;
      const option = control.options.find((candidate) => candidate.text.toUpperCase() === wanted || candidate.text.replace(/^0/, '') === String(wanted).replace(/^0/, ''))
        ?? control.options.find((candidate) => candidate.text.toUpperCase().replace(/^0/, '') === String(wanted).toUpperCase().replace(/^0/, ''));
      if (option) await setControl(page, frame, control, option.value);
    } else if (control.type === 'date') {
      await setControl(page, frame, control, parts.ymd);
    } else if (control.type === 'datetime-local') {
      await setControl(page, frame, control, `${parts.ymd}T${parts.hour24}:${parts.minute}`);
    } else if (control.type === 'time' || (/time/i.test(label) && !/date/i.test(label))) {
      await setControl(page, frame, control, control.type === 'time' ? `${parts.hour24}:${parts.minute}` : parts.time12);
    } else {
      const alone = group.filter((other) => other.tag !== 'select').length === 1 && !group.some((other) => other.tag === 'select');
      await setControl(page, frame, control, alone ? `${parts.mdy} ${parts.time12}` : parts.mdy);
    }
    filled.push(control.label || control.hint);
  }
  return true;
}

// Run on OGD's signed-in page: opens Activities > New Activity, fills it from
// the Oracle activity, saves, and finds the new activity's link.
export function createActivityPush(activity, { onProgress = () => null } = {}) {
  return async function pushActivity(page) {
    await onProgress({ stage: 'opening', label: 'Opening New Activity in OGD', force: true });
    await openActivities(page);
    const context = page.context();
    const opened = [];
    const onPage = (newPage) => opened.push(newPage);
    context.on('page', onPage);
    try {
      const newButton = (frame) => frame.locator('input[type=submit], input[type=button], button, a').filter({ hasText: NEW_ACTIVITY_TEXT })
        .or(frame.locator('input[type=submit][value="New Activity" i], input[type=button][value="New Activity" i], input[type=submit][value="Add New Activity" i], input[type=button][value="Add New Activity" i], input[type=button][value="Add Activity" i]'));
      if (!(await clickFirstVisible(page, newButton))) {
        throw new AutomationFailure(ACTIVITY_FAILURES.form, `No New Activity button on the Activities page. Buttons seen: ${await visibleLinkTexts(page)}`);
      }
      const { page: formPage, frame: firstFrame } = await waitForNewActivityForm(page, opened);
      await onProgress({ stage: 'filling', label: "Filling in OGD's New Activity form", force: true });
      let frame = firstFrame;
      let form = await snapshotForm(frame);
      const filled = [];
      const problems = [];

      const nameControl = findControl(form, /activity\s*name|^name$|^title$|activity\s*title/i, { exclude: /leader|venue/i })
        ?? findControl(form, /name/i, { exclude: /leader|venue|area|type/i });
      if (!nameControl) problems.push('no Activity Name box');
      else { await setControl(formPage, frame, nameControl, activity.name); filled.push(nameControl.label); }

      const typeControl = findControl(form, /type/i, { tag: 'select' });
      if (activity.activity_type) {
        if (!typeControl) problems.push('no Type list');
        else {
          const option = pickOption(typeControl, activity.activity_type);
          if (!option) problems.push(`Type has no "${activity.activity_type}" (choices: ${typeControl.options.map((choice) => choice.text).filter(Boolean).join(', ')})`);
          else {
            await setControl(formPage, frame, typeControl, option.value);
            filled.push(typeControl.label);
            // Choosing a Type can post back and bring extra fields.
            frame = (await settledFields(formPage, frame)).frame ?? frame;
            form = await snapshotForm(frame);
          }
        }
      }

      // OGD's own Area/Chapter search box already holds the signed-in chapter.
      const areaControl = form.controls.find((control) => control.tag === 'select' && !control.dressed && /^area|area\s*name/i.test(control.label || control.hint));
      if (areaControl && activity.area_name) {
        const option = pickOption(areaControl, activity.area_name);
        if (option) { await setControl(formPage, frame, areaControl, option.value); filled.push(areaControl.label); form = await snapshotForm(frame); }
        else problems.push(`Area has no "${activity.area_name}" (choices: ${areaControl.options.map((choice) => choice.text).filter(Boolean).slice(0, 30).join(', ')})`);
      }

      // The extra fields the chosen Type brings (read from OGD's form in Oracle).
      if (activity.ogd_fields && Object.keys(activity.ogd_fields).length) {
        const extra = await fillExtraFields(formPage, frame, activity.ogd_fields);
        frame = extra.frame;
        filled.push(...extra.filled);
        problems.push(...extra.problems);
        form = await snapshotForm(frame);
      }

      // OGD's "Start/End Dates": one label, a start box and an end box, each "11/22/2026 07:00 PM".
      const pair = form.controls.filter((control) => control.tag !== 'select' && /start\s*\/?\s*end|from\s*\/?\s*to/i.test(control.label));
      if (pair.length === 2) {
        const start = manilaParts(activity.starts_at);
        // No end given: OGD's own default length, three hours.
        const end = manilaParts(activity.ends_at ?? new Date(new Date(activity.starts_at).getTime() + 3 * 60 * 60 * 1000).toISOString());
        await setControl(formPage, frame, pair[0], `${start.mdy} ${start.time12}`);
        await setControl(formPage, frame, pair[1], `${end.mdy} ${end.time12}`);
        filled.push('Start date', 'End date');
      } else {
        if (!(await fillWhen(formPage, frame, form, /start|date\s*from|^from|^date$/i, activity.starts_at, filled))) problems.push('no Start Date box');
        if (activity.ends_at && !(await fillWhen(formPage, frame, form, /end|date\s*to|^to$/i, activity.ends_at, filled))) problems.push('no End Date box');
      }

      // Team Leader: a search box that looks the name up as it is typed.
      // Found by its label, since OGD's box may sit on a hidden field.
      const leaderControl = findControl(form, /team\s*leader|leader/i, { tag: 'select' });
      const leaderBox = leaderControl && !leaderControl.dressed ? null : await markSearchBox(frame, /^\s*team\s*leader\s*[:*]*\s*$/i, 'leader');
      if (leaderBox?.found) {
        if (!activity.team_leader) problems.push('OGD needs a Team Leader; add one in Oracle and push again');
        else {
          const chosen = await chooseSearchOption(formPage, frame, 'leader', activity.team_leader);
          if (chosen.ok) filled.push(`Team Leader (${chosen.text})`);
          else problems.push(`Team Leader "${activity.team_leader}": ${chosen.reason}. Its box: ${leaderBox.html}`);
        }
        form = await snapshotForm(frame);
      } else if (leaderBox && activity.team_leader) {
        problems.push(`could not find how to fill Team Leader. Its row: ${leaderBox.html || 'no "Team Leader" label found'}`);
      }

      const optional = [
        [/team\s*leader|leader/i, leaderBox ? null : activity.team_leader],
        [/venue|location|place/i, activity.venue],
        [/desc|remark|note|detail|purpose|agenda|objective/i, activity.description],
      ];
      for (const [pattern, value] of optional) {
        if (!value) continue;
        const control = findControl(form, pattern);
        if (!control) continue;
        if (control.tag === 'select') {
          const option = pickOption(control, value);
          if (option) { await setControl(formPage, frame, control, option.value); filled.push(control.label); }
        } else { await setControl(formPage, frame, control, value); filled.push(control.label); }
      }

      if (problems.length) throw new AutomationFailure(ACTIVITY_FAILURES.form, `Did not save: ${problems.join('; ')}. ${describeForm(await snapshotForm(frame))}`);

      form = await snapshotForm(frame);
      await onProgress({ stage: 'saving', label: 'Saving the activity in OGD', force: true });
      const save = form.buttons.find((button) => /^(save|submit|create|save activity|add activity|add)$/i.test(button.text))
        ?? form.buttons.find((button) => /save|submit|create/i.test(button.text));
      if (!save) throw new AutomationFailure(ACTIVITY_FAILURES.form, `No Save button on the New Activity form. ${describeForm(form)}`);
      const beforeUrl = formPage.url();
      await submitAndSettle(formPage, () => frame.locator(`[data-oracle-button="${save.index}"]`).first().click({ timeout: 10000 }));
      await formPage.waitForTimeout(1500);

      const afterText = await frame.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').trim()).catch(() => '');
      const stillOpen = !frame.isDetached() && looksLikeForm(await snapshotForm(frame).catch(() => ({ controls: [] })));
      const errorText = /(is required|required field|invalid|error|please (enter|select|fill))[^.]{0,120}/i.exec(afterText)?.[0];
      if (stillOpen && errorText) throw new AutomationFailure(ACTIVITY_FAILURES.save, `OGD did not save the activity: ${errorText}. Filled: ${filled.join(', ')}`);

      // Its link: the page OGD moved to, else the new row in the list.
      let ogdUrl = formPage.url() !== beforeUrl && ogdIdFromHref(formPage.url()) ? formPage.url() : null;
      if (!ogdUrl && !frame.isDetached() && ogdIdFromHref(frame.url())) ogdUrl = frame.url();
      let ogdKey = ogdUrl ? `id:${ogdIdFromHref(ogdUrl)}` : null;
      await closeOverlays(page);
      const listed = await findActivitiesTable(page, TABLE_WAIT_MS).catch(() => null) ?? await openActivities(page).catch(() => null);
      const startsAt = activity.starts_at ? new Date(activity.starts_at).getTime() : null;
      const row = listed?.table.records.find((record) => normalizeText(record.name) === normalizeText(activity.name)
        && (!startsAt || Math.abs(new Date(parseOgdDate(record.start) ?? 0).getTime() - startsAt) < 60 * 1000));
      if (row) {
        if (!ogdUrl && isRealHref(row.nameHref)) ogdUrl = new URL(row.nameHref, listed.frame.url()).href;
        ogdKey = ogdKey ?? activityKey({ ...row, startsAt: parseOgdDate(row.start) });
      } else if (!stillOpen) {
        // Saved, but the list did not show it (yet): the Activities page still leads to it.
      } else {
        throw new AutomationFailure(ACTIVITY_FAILURES.save, `The activity did not appear in OGD after Save. ${afterText.slice(0, 600)}`);
      }
      return {
        ogdUrl: ogdUrl ?? (listed ? listed.frame.url() : page.url()),
        isDirectLink: Boolean(ogdUrl),
        ogdKey: ogdKey ?? `${normalizeText(activity.name)}|${activity.starts_at}`,
        filled,
        listed: Boolean(row),
      };
    } finally {
      context.off('page', onPage);
      for (const shown of opened) await shown.close().catch(() => null);
    }
  };
}

// ---------- Adding attendees to an activity in OGD ----------

const SEARCH_BOX = /member|id\s*no|search|find|keyword|name|attendee|participant/i;
const NOT_SEARCH_BOX = /activity|venue|leader|date|start|end|desc|remark|time/i;
const ADD_BUTTON = /^\s*\+?\s*(add|add attendees?|add members?|add participants?|add to (list|attendance)|include|tag|enroll)\s*$/i;
const SEARCH_BUTTON = /^\s*(search|find|go|look\s*up|search member)\s*$/i;
const SAVE_BUTTON = /^\s*(save|update|submit|save attendance|save attendees|save changes|done|ok|confirm)\s*$/i;
const OPEN_ADD_BUTTON = /add\s*(attendees?|members?|participants?|attendance)|encode|tag\s*attendees?|^\s*add\s*$/i;
const ATTENDEE_STEP_WAIT_MS = 1500;

// The text keys a member's row may show: the Member ID, "LAST FIRST" or "FIRST LAST".
export function attendeeTargets(members) {
  return members.map((member) => {
    const last = normalizeText(member.Lastname ?? member.last);
    const first = normalizeText(member.Firstname ?? member.first);
    const name = [member.Lastname ?? member.last, member.Firstname ?? member.first].map((part) => String(part ?? '').trim()).filter(Boolean).join(', ');
    return { memberId: String(member.MemberIDNo ?? member.memberId ?? '').toUpperCase(), name, keys: [`${last} ${first}`, `${first} ${last}`].filter((key) => key.trim().includes(' ')) };
  });
}

// Each member's row in one frame: 'listed' (shown, nothing to do), 'checked'
// or 'checkable' (a picker row with a checkbox), 'addable' (a row with an Add
// or Select link) or 'missing'. Marks the checkbox or link for clicking.
function scanFrame(frame, targets) {
  return frame.evaluate((list) => {
    const norm = (value) => ` ${String(value ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()} `;
    document.querySelectorAll('[data-oracle-pick]').forEach((el) => el.removeAttribute('data-oracle-pick'));
    const rows = [...document.querySelectorAll('tr, li')].filter((row) => !row.querySelector('table, ul') && row.getClientRects().length > 0);
    const texts = rows.map((row) => norm(row.innerText || row.textContent));
    const showsIds = texts.some((text) => / [A-Z]{2} \d{4} \d+ /.test(text));
    return list.map((target, index) => {
      const id = target.memberId ? norm(target.memberId) : null;
      // By Member ID, else by name. A name-only match on a page that shows
      // Member IDs still counts as already listed (so nobody is added twice),
      // but is not ticked or clicked, since it may be someone else's row.
      let rowIndex = id ? texts.findIndex((text) => text.includes(id)) : -1;
      const byNameOnly = rowIndex === -1;
      if (byNameOnly) rowIndex = texts.findIndex((text) => target.keys.some((key) => text.includes(` ${key} `)));
      if (rowIndex === -1) return 'missing';
      const row = rows[rowIndex];
      if (byNameOnly && showsIds) {
        const box = row.querySelector('input[type=checkbox]');
        if (box) return box.checked ? 'checked' : 'missing';
        return row.querySelector('a, button, input[type=button], input[type=submit]') && /add|select|tag|include|choose/i.test(row.innerText || '') ? 'missing' : 'listed';
      }
      const box = row.querySelector('input[type=checkbox]');
      if (box) {
        box.setAttribute('data-oracle-pick', `${index}`);
        return box.checked ? 'checked' : 'checkable';
      }
      const add = [...row.querySelectorAll('a, button, input[type=button], input[type=submit], input[type=image]')]
        .find((el) => /add|select|tag|include|present|attend|choose/i.test(`${el.value || ''} ${el.innerText || ''} ${el.title || ''} ${el.alt || ''}`)
          && !/remove|delete|absent/i.test(`${el.value || ''} ${el.innerText || ''} ${el.title || ''}`));
      if (add) {
        add.setAttribute('data-oracle-pick', `${index}`);
        return 'addable';
      }
      return 'listed';
    });
  }, targets);
}

const STATE_RANK = { listed: 4, checked: 4, checkable: 3, addable: 2, missing: 0 };

// The best state for each member across every frame of a page.
async function scanPage(page, targets) {
  const best = targets.map(() => ({ state: 'missing', frame: null }));
  for (const frame of page.frames()) {
    const states = await scanFrame(frame, targets).catch(() => null);
    if (!states) continue;
    states.forEach((state, index) => {
      if (STATE_RANK[state] > STATE_RANK[best[index].state]) best[index] = { state, frame };
    });
  }
  return best;
}

// scanPage across every page of a paged attendee list, so a member listed on
// page 2 or later still counts as already in OGD. Frames that hold the
// Activities list itself are not paged.
const MAX_ATTENDEE_PAGES = 20;
async function scanAllPages(page, targets) {
  const best = await scanPage(page, targets);
  if (best.every((entry) => STATE_RANK[entry.state] === 4)) return best;
  for (const frame of page.frames()) {
    if (!(await readAttendeeTable(frame).catch(() => null))) continue;
    const merge = (states) => states?.forEach((state, index) => {
      if (STATE_RANK[state] === 4 && STATE_RANK[best[index].state] < 4) best[index] = { state, frame: null };
    });
    if (await widenAttendeeTable(frame).catch(() => false)) {
      await page.waitForTimeout(ATTENDEE_STEP_WAIT_MS);
      merge(await scanFrame(frame, targets).catch(() => null));
      if (best.every((entry) => STATE_RANK[entry.state] === 4)) break;
    }
    for (let pageNumber = 2; pageNumber <= MAX_ATTENDEE_PAGES; pageNumber += 1) {
      const before = JSON.stringify((await readAttendeeTable(frame).catch(() => null))?.records ?? []);
      if (!(await nextAttendeePage(frame, pageNumber - 1))) break;
      let changed = false;
      for (let wait = 0; wait < 20 && !changed; wait += 1) {
        await page.waitForTimeout(POLL_MS);
        changed = JSON.stringify((await readAttendeeTable(frame).catch(() => null))?.records ?? []) !== before;
      }
      if (!changed) break;
      merge(await scanFrame(frame, targets).catch(() => null));
      if (best.every((entry) => STATE_RANK[entry.state] === 4)) break;
    }
  }
  return best;
}

async function visibleButton(page, pattern, preferFrame) {
  const frames = preferFrame ? [preferFrame, ...page.frames().filter((frame) => frame !== preferFrame)] : page.frames();
  for (const frame of frames) {
    const locator = frame.locator('input[type=submit], input[type=button], button, a');
    const count = Math.min(await locator.count().catch(() => 0), 300);
    for (let index = 0; index < count; index += 1) {
      const element = locator.nth(index);
      if (!(await element.isVisible().catch(() => false))) continue;
      const label = await element.evaluate((el) => (el.value || el.innerText || el.textContent || el.title || '').replace(/\s+/g, ' ').trim()).catch(() => '');
      if (label && label.length <= 40 && pattern.test(label)) return element;
    }
  }
  return null;
}

async function clickAndSettle(page, element) {
  await submitAndSettle(page, () => element.click({ timeout: 10000 })).catch(() => null);
  await page.waitForTimeout(ATTENDEE_STEP_WAIT_MS);
}

// A button inside OGD's attendance popup (its own frame), like "+ Add": the
// postback reloads that frame, not the page, so wait for the frame instead.
const FRAME_POSTBACK_WAIT_MS = 10000;
async function clickInFrameAndSettle(page, element) {
  const reloaded = page.waitForEvent('framenavigated', { predicate: (frame) => frame !== page.mainFrame(), timeout: FRAME_POSTBACK_WAIT_MS }).catch(() => null);
  await element.click({ timeout: 10000 }).catch(() => null);
  const frame = await reloaded;
  if (frame) await frame.waitForLoadState('load', { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => null);
  await page.waitForTimeout(ATTENDEE_STEP_WAIT_MS);
}

// A member search box in any frame: a text box labelled for members, IDs or names.
async function findSearchBox(page) {
  for (const frame of page.frames()) {
    const form = await snapshotForm(frame).catch(() => null);
    if (!form) continue;
    const boxes = form.controls.filter((control) => control.tag === 'input' && ['', 'text', 'search'].includes(control.type) && !control.readOnly
      && SEARCH_BOX.test(`${control.label} ${control.hint}`) && !NOT_SEARCH_BOX.test(control.label || ''));
    const usable = [];
    for (const control of boxes) {
      // A data grid's own filter box (DataTables "Search:") only filters the
      // rows already listed; it never adds anyone.
      const isFilter = await frame.locator(`[data-oracle-field="${control.index}"]`).evaluate((el) => Boolean(
        el.closest('.dataTables_filter, .dt-search, .dataTables_wrapper .top, .gridFilter') || el.getAttribute('aria-controls'),
      )).catch(() => false);
      if (!isFilter) usable.push(control);
    }
    const box = usable.find((control) => /member|id/i.test(`${control.label} ${control.hint}`)) ?? usable[0];
    if (box) return { frame, locator: frame.locator(`[data-oracle-field="${box.index}"]`), label: box.label || box.hint };
  }
  return null;
}

// OGD's attendance popup: a "Member Name:" Select2 box with its own "+ Add"
// button (the "Non-CFC Member:" box below it is for guests and is left alone).
const MEMBER_NAME_LABEL = /^\s*(cfc\s*)?member\s*(name)?\s*[:*]*\s*$/i;
async function findMemberNameBox(page) {
  for (const frame of page.frames()) {
    const marked = await markSearchBox(frame, MEMBER_NAME_LABEL, 'attendee').catch(() => null);
    if (!marked?.found) continue;
    // Its "+ Add" is the nearest Add button after the box in the same row.
    await frame.evaluate(() => {
      document.querySelectorAll('[data-oracle-add]').forEach((el) => el.removeAttribute('data-oracle-add'));
      const box = document.querySelector('[data-oracle-box="attendee"]');
      for (let row = box?.parentElement; row && row !== document.body; row = row.parentElement) {
        const add = [...row.querySelectorAll('input[type=button], input[type=submit], button, a')]
          .find((el) => /^\s*\+?\s*add\s*$/i.test(el.value || el.innerText || '') && (box.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
        if (add) { add.setAttribute('data-oracle-add', 'attendee'); return; }
      }
    }).catch(() => null);
    return { frame, picker: true, ownAdd: true, label: 'Member Name' };
  }
  return null;
}

// A Select2 member picker (like OGD's Team Leader box) in any frame.
const MEMBER_PICKER_LABEL = /member|attendee|participant|name|search|add/i;
async function findMemberPicker(page) {
  for (const frame of page.frames()) {
    const form = await snapshotForm(frame).catch(() => null);
    if (!form) continue;
    const picker = form.controls.find((control) => control.dressed && MEMBER_PICKER_LABEL.test(`${control.label} ${control.hint}`) && !/leader|area|chapter|type|formation|talk|topic/i.test(control.label || ''))
      ?? form.controls.find((control) => control.dressed && !/leader|area|chapter|type|formation|talk|topic|status|service/i.test(`${control.label} ${control.hint}`));
    if (!picker) continue;
    const marked = await frame.evaluate((index) => {
      document.querySelectorAll('[data-oracle-box="attendee"], [data-oracle-value="attendee"]').forEach((el) => { el.removeAttribute('data-oracle-box'); el.removeAttribute('data-oracle-value'); });
      const box = document.querySelector(`[data-oracle-select2="${index}"]`);
      const value = document.querySelector(`[data-oracle-field="${index}"]`);
      if (!box) return false;
      box.setAttribute('data-oracle-box', 'attendee');
      value?.setAttribute('data-oracle-value', 'attendee');
      return true;
    }, picker.index).catch(() => false);
    if (marked) return { frame, picker: true, label: picker.label || picker.hint };
  }
  return null;
}

// What the attendee page offers, for working out OGD's add flow when it does
// not match: every frame's fields, buttons and links (also those inside hidden
// popups), Select2 boxes and grid headers. Field values and row contents are
// left out.
export async function attendeePageMap(page, note = '') {
  const parts = [`[${note}] ${page.url().replace(/[?#].*$/, '')}`];
  for (const frame of page.frames()) {
    const map = await frame.evaluate(() => {
      const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
      const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
      const tagOf = (el) => {
        const cls = clean(el.className && typeof el.className === 'string' ? el.className : '').split(' ').filter((c) => c && !/^ng-|^col-/.test(c)).slice(0, 4).join('.');
        return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.name ? `[name=${el.name}]` : ''}${el.type && el.tagName === 'INPUT' ? `[type=${el.type}]` : ''}${cls ? `.${cls}` : ''}${shown(el) ? '' : '(hidden)'}`;
      };
      const labelNear = (el) => {
        if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) return clean(l.innerText).slice(0, 40); }
        const cell = el.closest('td, .form-group, label, div');
        const prev = cell?.previousElementSibling;
        return clean(el.getAttribute('placeholder') || (prev ? prev.innerText : '') || '').slice(0, 40);
      };
      const fields = [...document.querySelectorAll('input:not([type=hidden]), select, textarea')]
        .filter((el) => !el.closest('.select2-drop, .select2-dropdown'))
        .slice(0, 60).map((el) => `${tagOf(el)}${labelNear(el) ? ` "${labelNear(el)}"` : ''}${el.tagName === 'SELECT' ? ` (${el.options.length} options)` : ''}`);
      const buttons = [...document.querySelectorAll('input[type=submit], input[type=button], input[type=image], button, a')]
        .map((el) => ({ el, text: clean(el.value || el.innerText || el.title || el.getAttribute('aria-label') || el.alt || '') }))
        .filter(({ el, text }) => (text || el.querySelector('i, img, span.glyphicon, span.fa')) && text.length <= 40 && !/^\d+$/.test(text))
        .filter(({ el }) => !el.closest('tbody tr td:not(:first-child)') || /add|tag|select/i.test(el.innerText || el.title || ''))
        .slice(0, 80).map(({ el, text }) => {
          const href = el.getAttribute('href') || '';
          const action = /^javascript:/i.test(href) ? href.slice(0, 90) : href.replace(/[?#].*$/, '').slice(0, 60);
          const click = clean(el.getAttribute('onclick') || '').slice(0, 90);
          const target = el.getAttribute('data-target') || el.getAttribute('data-toggle') || '';
          return `${tagOf(el)} "${text}"${action ? ` href=${action}` : ''}${click ? ` onclick=${click}` : ''}${target ? ` data=${target}` : ''}`;
        });
      const select2 = [...document.querySelectorAll('.select2-container, span.select2')].filter((el) => !el.closest('.select2-drop, .select2-dropdown')).map(tagOf);
      const modals = [...document.querySelectorAll('.modal, [role=dialog], .ui-dialog, #simplemodal-container, .popup, [id*="popup" i], [id*="modal" i]')].slice(0, 10)
        .map((el) => `${tagOf(el)} "${clean(el.querySelector('h1, h2, h3, h4, .modal-title, .ui-dialog-title')?.innerText || '').slice(0, 50)}"`);
      const grids = [...document.querySelectorAll('table')].filter((t) => t.rows.length > 1 && !t.querySelector('table')).slice(0, 6)
        .map((t) => `${tagOf(t)} rows=${t.rows.length} head=${[...t.rows[0].cells].map((c) => clean(c.innerText).slice(0, 20)).join('|')}`);
      const headings = [...document.querySelectorAll('h1, h2, h3, h4, legend, .panel-title, .card-title')].map((el) => clean(el.innerText).slice(0, 50)).filter(Boolean).slice(0, 12);
      if (!fields.length && !buttons.length && !grids.length) return null;
      return [
        `frame ${location.pathname}`,
        headings.length ? `headings: ${headings.join(' / ')}` : '',
        `fields: ${fields.join('; ') || 'none'}`,
        `buttons/links: ${buttons.join('; ') || 'none'}`,
        select2.length ? `select2: ${select2.join('; ')}` : '',
        modals.length ? `popups: ${modals.join('; ')}` : '',
        grids.length ? `grids: ${grids.join('; ')}` : '',
      ].filter(Boolean).join('\n');
    }).catch(() => null);
    if (map) parts.push(map);
  }
  return parts.join('\n').slice(0, 12000);
}

async function describeAttendeePage(page) {
  const parts = [];
  for (const frame of page.frames()) {
    const form = await snapshotForm(frame).catch(() => null);
    if (form && (form.controls.length || form.buttons.length)) parts.push(describeForm(form));
    const table = await readAttendeeTable(frame).catch(() => null);
    if (table) parts.push(`table: ${table.headers.join(' | ')} (${table.records.length} rows)`);
  }
  return parts.join(' || ').slice(0, DETAIL_LIMIT) || `nothing readable on ${page.url()}`;
}

// Adds one member through a search box: types the Member ID, picks it from a
// suggestion list if one shows, then Add (or Search, then the member's row).
async function addBySearch(page, search, target) {
  if (search.picker) return addByPicker(page, search, target);
  const { frame, locator } = search;
  await locator.click({ timeout: 5000 }).catch(() => null);
  await locator.fill('').catch(() => null);
  await locator.pressSequentially(target.memberId, { delay: 25 }).catch(() => locator.fill(target.memberId));
  await page.waitForTimeout(ATTENDEE_STEP_WAIT_MS);
  const suggestion = frame.locator('.ui-autocomplete li, .ui-menu-item, [role=option], .autocomplete-suggestion, .tt-suggestion, .select2-results li')
    .filter({ hasText: new RegExp(target.memberId.replace(/[-]/g, '.?'), 'i') }).first();
  let seen = false;
  if (await suggestion.isVisible().catch(() => false)) {
    seen = true;
    await suggestion.click({ timeout: 5000 }).catch(() => null);
    await page.waitForTimeout(500);
  }
  const add = await visibleButton(page, ADD_BUTTON, frame);
  const searchButton = add ? null : await visibleButton(page, SEARCH_BUTTON, frame);
  if (add) await clickAndSettle(page, add);
  else if (searchButton) await clickAndSettle(page, searchButton);
  else {
    await submitAndSettle(page, () => locator.press('Enter')).catch(() => null);
    await page.waitForTimeout(ATTENDEE_STEP_WAIT_MS);
  }
  // A result row to tick or click, then Add or Save to confirm it.
  const [found] = await scanPage(page, [target]);
  if (found.state !== 'missing') seen = true;
  if (found.state === 'checkable' || found.state === 'addable') {
    const pick = found.frame.locator('[data-oracle-pick="0"]').first();
    if (found.state === 'checkable') await pick.check({ timeout: 5000, force: true }).catch(() => null);
    else await clickAndSettle(page, pick);
    const confirm = await visibleButton(page, ADD_BUTTON, found.frame) ?? await visibleButton(page, SAVE_BUTTON, found.frame);
    if (confirm) await clickAndSettle(page, confirm);
  }
  return seen;
}

// Adds one member through a Select2 member picker: searches the name, picks
// the match (by Member ID when OGD shows it), then presses Add if there is one.
async function addByPicker(page, search, target) {
  const wanted = target.name || target.keys[0];
  const chosen = await chooseSearchOption(page, search.frame, 'attendee', wanted, target.memberId).catch((error) => ({ ok: false, reason: error.message }));
  if (!chosen.ok) {
    search.lastReason = chosen.reason;
    // Only "OGD found nobody by that name" counts as not in OGD.
    return !/found nobody/.test(chosen.reason ?? '');
  }
  // The member is picked; its own "+ Add" saves them (and reloads the popup).
  const own = search.frame.locator('[data-oracle-add="attendee"]').first();
  const add = (await own.isVisible().catch(() => false)) ? own : await visibleButton(page, ADD_BUTTON, search.frame);
  if (add) await (search.ownAdd ? clickInFrameAndSettle(page, add) : clickAndSettle(page, add));
  return true;
}

// Does the adding on an opened activity or attendance page.
async function addOnPage(page, targets, deadline, onProgress = () => null) {
  const actions = [];
  const maps = [];
  const notFound = new Set();
  await onProgress({ stage: 'checking', label: 'Checking who is already in OGD', force: true });
  // Members already on OGD's attendee list (any page of it) are left alone.
  const already = new Set((await scanAllPages(page, targets))
    .map((entry, index) => (STATE_RANK[entry.state] === 4 ? index : -1)).filter((index) => index !== -1));
  if (already.size) actions.push(`${already.size} already in OGD, not added again`);
  if (already.size === targets.length) return { states: targets.map(() => ({ state: 'listed' })), actions, already, notFound };
  // Paging may have moved the list off its first page, so scan afresh.
  let states = (await scanPage(page, targets)).map((entry, index) => (already.has(index) ? { state: 'listed', frame: null } : entry));
  const refresh = async () => (await scanPage(page, targets)).map((entry, index) => (already.has(index) ? { state: 'listed', frame: null } : entry));

  // Picker rows already on the page: tick them all, or click each Add.
  let ticked = 0;
  for (let index = 0; index < targets.length; index += 1) {
    if (Date.now() > deadline) break;
    if (states[index].state === 'checkable') {
      await states[index].frame.locator(`[data-oracle-pick="${index}"]`).first().check({ timeout: 5000, force: true }).catch(() => null);
      ticked += 1;
    } else if (states[index].state === 'addable') {
      await clickAndSettle(page, states[index].frame.locator(`[data-oracle-pick="${index}"]`).first());
      actions.push(`clicked add for ${targets[index].memberId}`);
      states = await refresh();
    }
  }
  if (ticked) {
    const save = await visibleButton(page, SAVE_BUTTON) ?? await visibleButton(page, ADD_BUTTON);
    if (save) await clickAndSettle(page, save);
    actions.push(`ticked ${ticked}${save ? ' and saved' : ' (no Save button found)'}`);
    states = await refresh();
  }

  // The rest through a member search box (or Select2 member picker), opening the Add form first if needed.
  const missing = targets.map((_, index) => index).filter((index) => states[index].state === 'missing');
  if (missing.length && Date.now() < deadline) {
    maps.push(await attendeePageMap(page, 'attendee page').catch(() => ''));
    const findAdder = async () => await findMemberNameBox(page) ?? await findSearchBox(page) ?? await findMemberPicker(page);
    let search = await findAdder();
    if (!search) {
      const opener = await visibleButton(page, OPEN_ADD_BUTTON);
      if (opener) {
        await clickAndSettle(page, opener);
        actions.push('opened the add form');
        maps.push(await attendeePageMap(page, 'after opening the add form').catch(() => ''));
        search = await findAdder();
      }
    }
    if (!search) return { states: await refresh(), actions, already, notFound, maps, problem: `No way to add attendees found. ${await describeAttendeePage(page)}` };
    actions.push(`used ${search.picker ? 'the member picker' : 'the box'} "${search.label || 'unlabelled'}"`);
    let done = 0;
    let stoppedEarly = false;
    const firstPage = (() => { try { return new URL(search.frame.url()).pathname; } catch { return ''; } })();
    await onProgress({ stage: 'adding', label: 'Adding attendees in OGD', done, total: missing.length, force: true });
    for (const index of missing) {
      if (Date.now() > deadline) break;
      // Check again just before adding: an earlier add may have brought them in.
      const [now] = await scanPage(page, [targets[index]]);
      if (STATE_RANK[now.state] !== 4) {
        // OGD showing no such member at all: skipped, not a failure.
        if (!(await addBySearch(page, search, targets[index]))) notFound.add(index);
        if (done === 0) maps.push(await attendeePageMap(page, `after the first search${search.lastReason ? ` (${search.lastReason})` : ''}`).catch(() => ''));
        // OGD's attendance popup can reload or close after an add. Only the
        // same kind of box on the same page may be used next; anything else
        // (like the Activities list's own Search) would wrongly skip members.
        const next = await findAdder();
        const pageOf = (adder) => { try { return new URL(adder.frame.url()).pathname; } catch { return ''; } };
        if (!next || next.picker !== search.picker || pageOf(next) !== firstPage) {
          done += 1;
          actions.push(`stopped after ${done}: OGD's add box was gone (now on ${next ? pageOf(next) : (new URL(page.url()).pathname)})`);
          stoppedEarly = true;
          break;
        }
        search = next;
      }
      done += 1;
      await onProgress({ stage: 'adding', label: 'Adding attendees in OGD', done, total: missing.length });
    }
    if (!stoppedEarly) actions.push(`searched ${done}`);
    await onProgress({ stage: 'saving', label: 'Saving in OGD', done, total: missing.length, force: true });
    // Each "+ Add" saves on its own; the popup's Save is for the capture schedule.
    const save = search.ownAdd ? null : await visibleButton(page, SAVE_BUTTON);
    if (save) { await clickAndSettle(page, save); actions.push('saved'); }
    states = await refresh();
    // Nobody at all turning up means the search itself did not work, not
    // that every member is missing from OGD: report it, skip no one.
    const searchedIds = missing.filter((index) => !already.has(index));
    if (searchedIds.length >= 3 && searchedIds.every((index) => notFound.has(index))) {
      notFound.clear();
      return { states, actions, already, notFound, maps, problem: `OGD's search found none of the ${searchedIds.length} members, so the add step does not match OGD's page; nobody was marked skipped.` };
    }
  }
  return { states, actions, already, notFound, maps };
}

async function findActivityRow(page, list, activity, deadline) {
  const startMs = activity.starts_at ? new Date(activity.starts_at).getTime() : null;
  const matches = (record) => {
    const recordStart = parseOgdDate(record.start);
    if (activity.ogd_key?.startsWith('id:') && activityKey({ ...record, startsAt: recordStart }) === activity.ogd_key) return true;
    return normalizeText(record.name) === normalizeText(activity.name)
      && (!startMs || Math.abs(new Date(recordStart ?? 0).getTime() - startMs) < 60 * 1000);
  };
  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
    const row = list.table.records.find(matches);
    if (row) return row;
    const allOlder = startMs && list.table.records.length && list.table.records.every((record) => {
      const recordStart = parseOgdDate(record.start);
      return recordStart && new Date(recordStart).getTime() < startMs - 60 * 1000;
    });
    if (allOlder || Date.now() > deadline) return null;
    const key = firstKey(list.table);
    const { moved } = await pagerAction(list.frame, 'next').catch(() => ({ moved: false }));
    if (!moved) return null;
    const next = await waitForNextPage(page, key);
    if (!next) return null;
    list.frame = next.frame;
    list.table = next.table;
  }
  return null;
}

// Opens the activity's attendance (else its own) page and runs work(page) once it has loaded.
async function onActivityPage(page, activity, deadline, work) {
  const list = await openActivities(page);
  const row = await findActivityRow(page, list, activity, deadline);
  if (!row) throw new AutomationFailure(ACTIVITY_FAILURES.attendees, `"${activity.name}" was not found in OGD's Activities list.`);
  const tag = row.hasAttendanceLink ? 'attendance' : row.hasNameLink ? 'name' : null;
  if (!tag) throw new AutomationFailure(ACTIVITY_FAILURES.attendees, `"${activity.name}" has no link to open in OGD's Activities list.`);
  let started = false;
  const opened = await openAndRead(page, list, row, tag, async (frame) => {
    if (started) return null;
    const ready = await readAttendeeTable(frame).catch(() => null) || await readDetailFields(frame, activity.name).catch(() => null);
    if (!ready) return null;
    started = true;
    try {
      return { value: await work(frame.page()) };
    } catch (error) {
      return { error };
    }
  });
  if (!opened.result) throw new AutomationFailure(ACTIVITY_FAILURES.attendees, `"${activity.name}" did not open in OGD.`);
  if (opened.result.error) throw opened.result.error;
  return opened.result.value;
}

// Run on OGD's signed-in page: adds members to an activity's attendees, then
// opens the activity again to check which ones OGD kept. members are rows
// from the members table. Returns { added, failed: [{ memberId, reason }], detail }.
export function createAttendeePush(activity, members, { deadline, onProgress = () => null }) {
  const targets = attendeeTargets(members);
  return async function pushAttendees(page) {
    const workDeadline = deadline - 45 * 1000;
    await onProgress({ stage: 'opening', label: 'Opening the activity in OGD', force: true });
    const result = await onActivityPage(page, activity, workDeadline, (shown) => addOnPage(shown, targets, workDeadline, onProgress));
    // Read the attendee list fresh, so only what OGD saved counts.
    let finalStates = result.states.map((entry) => entry.state);
    let checked = false;
    if (Date.now() < deadline) {
      await onProgress({ stage: 'verifying', label: 'Checking what OGD kept', force: true });
      const fresh = await onActivityPage(page, activity, deadline, (shown) => scanAllPages(shown, targets)).catch(() => null);
      if (fresh) { finalStates = fresh.map((entry) => entry.state); checked = true; }
    }
    const added = [];
    const failed = [];
    const skipped = [];
    const alreadyIds = [...result.already].map((index) => targets[index].memberId);
    targets.forEach((target, index) => {
      if (result.already.has(index)) added.push(target.memberId);
      else if (finalStates[index] === 'listed' || finalStates[index] === 'checked') added.push(target.memberId);
      else if (result.notFound.has(index)) skipped.push(target.memberId);
      else failed.push({ memberId: target.memberId, reason: Date.now() > deadline && finalStates[index] === 'missing' ? 'not reached' : `not in OGD's list (${finalStates[index]})` });
    });
    const detail = [
      `In OGD: ${added.length} of ${targets.length}${alreadyIds.length ? ` (${alreadyIds.length} already there, not added again)` : ''}${skipped.length ? `; ${skipped.length} not found in OGD, skipped` : ''}${checked ? ', checked against OGD\'s attendee list' : ' (could not reopen the activity to check)'}.`,
      result.actions.length ? `Steps: ${result.actions.join(', ')}.` : '',
      result.problem ?? '',
    ].filter(Boolean).join(' ').slice(0, DETAIL_LIMIT);
    return { added, already: alreadyIds, failed, skipped, detail, pageMap: (result.maps ?? []).filter(Boolean).join('\n\n').slice(0, 30000) || null };
  };
}

// ---------- Reading the New Activity form (never saves) ----------

// Every field on the form, including checkbox and radio groups, as plain
// descriptions. A field's id is its name (else id, else label), which stays
// the same across OGD's postbacks.
function readFormFields(frame) {
  return frame.evaluate((modalCss) => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const isShown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const root = [...document.querySelectorAll(modalCss)].find((el) => isShown(el) && el.querySelector('input, select, textarea')) ?? document;
    // Text written right before a control in the same cell ("Topic [list]").
    // Stops at another control, so "to" between two date boxes is skipped.
    const inlineLabel = (el) => {
      for (let node = el; node && !/^(TD|TH|BODY|FORM|TR|TABLE)$/.test(node.tagName); node = node.parentElement) {
        for (let prev = node.previousSibling; prev; prev = prev.previousSibling) {
          if (prev.nodeType === 3) {
            const text = clean(prev.textContent);
            if (!text || /^(to|and|-|–|from|:)$/i.test(text)) continue;
            return text.length <= 40 ? text : '';
          }
          if (prev.nodeType !== 1) continue;
          if (prev.tagName === 'BR') continue;
          if (prev.matches('input, select, textarea, button') || prev.querySelector('input, select, textarea')) return '';
          const text = clean(prev.innerText || prev.textContent);
          if (!text) continue;
          return text.length <= 40 ? text : '';
        }
      }
      return '';
    };
    // Lists dressed up by a script (Select2 search boxes, "None selected"
    // pick-several buttons) hide the real <select> next to what is shown.
    const dressed = (el) => {
      if (el.tagName !== 'SELECT') return false;
      if (el.classList.contains('select2-hidden-accessible')) return true;
      const next = el.nextElementSibling;
      return Boolean(next && isShown(next) && /select2|multiselect|btn-group|chosen|selectize|dropdown/i.test(`${next.className} ${next.querySelector('button')?.className ?? ''}`));
    };
    const strip = (text) => clean(text).replace(/[:*]+$/, '').trim();
    const before = (el) => {
      const cell = el.closest('td, th');
      let previous = cell?.previousElementSibling;
      while (previous && !clean(previous.innerText)) previous = previous.previousElementSibling;
      if (previous) return clean(previous.innerText);
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      walker.currentNode = el;
      for (let steps = 0; steps < 15 && walker.previousNode(); steps += 1) {
        const text = clean(walker.currentNode.textContent);
        if (text && !(el.contains?.(walker.currentNode.parentElement))) return text.slice(0, 60);
      }
      return '';
    };
    const labelOf = (el) => {
      if (el.id) {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (label) return clean(label.innerText);
      }
      const wrapping = el.closest('label');
      if (wrapping) return clean(wrapping.innerText);
      return inlineLabel(el) || before(el) || clean(el.getAttribute('placeholder') || el.name || el.id);
    };
    const tidyName = (name) => String(name || '').replace(/^.*\$/, '').replace(/^(txt|cbo|ddl|chk|rbl|cbl|rdo|opt|lst)/i, '').replace(/([a-z])([A-Z])/g, '$1 $2');
    const fields = [];
    for (const el of root.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image]):not([type=checkbox]):not([type=radio]), select, textarea')) {
      if (el.closest('.multiselect-container, .select2-container, .dropdown-menu')) continue;
      const isDressed = dressed(el);
      if (!isShown(el) && !isDressed) continue;
      fields.push({
        id: el.name || el.id || strip(labelOf(el)), label: strip(labelOf(el)) || tidyName(el.name || el.id), name: el.name || null,
        kind: el.tagName === 'SELECT' ? (el.multiple ? 'multiselect' : 'select') : el.tagName === 'TEXTAREA' ? 'textarea' : (el.getAttribute('type') || 'text').toLowerCase(),
        dressed: isDressed || undefined,
        required: el.required || /\*/.test(labelOf(el)), readOnly: el.readOnly || false,
        options: el.tagName === 'SELECT' ? [...el.options].map((option) => ({ value: option.value, text: clean(option.text) })) : undefined,
      });
    }
    // Checkbox and radio groups: ASP.NET lists share a name stem (…$chkTalks$0) or a radio name.
    const groups = new Map();
    for (const el of root.querySelectorAll('input[type=checkbox], input[type=radio]')) {
      if (!isShown(el) || el.closest('.multiselect-container, .select2-container, .dropdown-menu')) continue;
      const stem = el.type === 'radio' ? el.name : String(el.name || el.id).replace(/[$_]\d+$/, '');
      const optionLabel = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText) || el.closest('label')?.innerText || el.nextSibling?.textContent || el.value;
      if (!groups.has(stem)) {
        // The group's own wrapper (ASP.NET puts a list in a span or table with an id), never the whole form.
        const box = el.closest('span[id], div[id], table[id]');
        const grouped = box && root.contains(box) && !box.querySelector('input[type=text], select, textarea')
          && box.querySelectorAll('input[type=checkbox], input[type=radio]').length > 1;
        groups.set(stem, {
          id: stem, name: stem, kind: el.type === 'radio' ? 'radio' : 'checkboxes',
          label: strip((grouped ? before(box) : '') || before(el) || tidyName(stem)) || tidyName(stem), options: [],
        });
      }
      groups.get(stem).options.push({ value: el.value, text: clean(optionLabel) });
    }
    for (const group of groups.values()) {
      if (group.kind === 'checkboxes' && group.options.length === 1) fields.push({ ...group, kind: 'checkbox', label: strip(group.options[0].text) || group.label });
      else fields.push(group);
    }
    return fields.filter((field) => field.label && field.label.length <= 80);
  }, MODAL_CONTAINERS);
}

const isTimeSelect = (field) => {
  const texts = (field.options ?? []).map((option) => option.text.toUpperCase());
  return (texts.includes('AM') && texts.includes('PM')) || texts.filter((text) => /^\d{1,2}$/.test(text)).length > texts.length * 0.8;
};

async function locateForm(page, previous) {
  const end = Date.now() + 8000;
  do {
    if (previous && !previous.isDetached()) {
      const form = await snapshotForm(previous).catch(() => null);
      if (form && looksLikeForm(form)) return previous;
    }
    for (const frame of page.frames()) {
      const form = await snapshotForm(frame).catch(() => null);
      if (form && looksLikeForm(form) && form.controls.length >= 3) return frame;
    }
    await page.waitForTimeout(POLL_MS);
  } while (Date.now() < end);
  return null;
}

// Waits for the form to settle after a choice (OGD may post back) and reads it.
async function settledFields(page, frame) {
  let last = '';
  let fields = null;
  let current = frame;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await page.waitForTimeout(attempt === 0 ? 1200 : POLL_MS);
    current = await locateForm(page, current);
    if (!current) return { frame: null, fields: null };
    // Lists filled by a background request (Formation -> Talk(s)) are read once it finishes.
    const busy = await current.evaluate(() => (window.jQuery?.active ?? 0) > 0 || (window.Sys?.WebForms?.PageRequestManager?.getInstance?.()?.get_isInAsyncPostBack?.() ?? false)).catch(() => false);
    if (busy) continue;
    fields = await readFormFields(current).catch(() => null);
    const signature = JSON.stringify(fields);
    if (fields && signature === last) break;
    last = signature;
  }
  return { frame: current, fields };
}

async function chooseOption(page, frame, field, option) {
  const locator = (field.name ? frame.locator(`select[name="${field.name}"]`) : frame.locator(`select[id="${field.id}"]`)).first();
  const loaded = page.waitForEvent('load', { timeout: 4000 }).catch(() => null);
  // force: Select2 and similar keep the real list hidden.
  await locator.selectOption(option.value, { timeout: 8000, force: true });
  if (field.dressed) await locator.evaluate((el) => window.jQuery?.(el).trigger?.('change.select2')).catch(() => null);
  await loaded;
}

const optionsKey = (field) => JSON.stringify((field.options ?? []).map((option) => option.text));

// Run on OGD's signed-in page. Opens Activities > New Activity and reads every
// field; then picks each Type option (and each option of any list that
// appears because of it) to see which extra fields each one brings. Never
// presses Save. Returns the form description stored in Oracle.
export function createActivityFormReader({ deadline, previous = null }) {
  return async function readActivityForm(page) {
    await openActivities(page);
    const context = page.context();
    const opened = [];
    const onPage = (newPage) => opened.push(newPage);
    context.on('page', onPage);
    try {
      const newButton = (frame) => frame.locator('input[type=submit], input[type=button], button, a').filter({ hasText: NEW_ACTIVITY_TEXT })
        .or(frame.locator('input[type=submit][value="New Activity" i], input[type=button][value="New Activity" i], input[type=submit][value="Add New Activity" i], input[type=button][value="Add New Activity" i], input[type=button][value="Add Activity" i]'));
      if (!(await clickFirstVisible(page, newButton))) {
        throw new AutomationFailure(ACTIVITY_FAILURES.form, `No New Activity button on the Activities page. Buttons seen: ${await visibleLinkTexts(page)}`);
      }
      const { page: formPage, frame: firstFrame } = await waitForNewActivityForm(page, opened);
      let frame = firstFrame;
      const base = await readFormFields(frame);
      const typeField = base.find((field) => field.kind === 'select' && /type/i.test(field.label) && !isTimeSelect(field))
        ?? base.find((field) => field.kind === 'select' && /type|category|kind/i.test(`${field.label} ${field.name}`));
      const buttons = (await snapshotForm(frame)).buttons.map((button) => button.text);
      // A partial earlier run is continued: its findings are kept and its finished paths skipped.
      const dependents = { ...(previous?.isPartial ? previous.dependents : {}) };
      const finished = new Set(previous?.isPartial ? previous.finished ?? [] : []);
      // Every field each Type shows, to tell fields every Type has from those only some have.
      const typePresent = { ...(previous?.isPartial ? previous.typePresent ?? {} : {}) };
      const notes = [];
      let isPartial = false;

      // Picks each option of a list and records what it changes: fields that
      // appear, and lists whose choices change (Formation -> its Talk(s)).
      // Then goes deeper for lists that changed, up to three levels (FIG
      // ACTIVITY -> Program -> Formation -> Talk(s)). Keys are paths:
      // "Activity Type::FORMATION >> Formation::[CPR] ...". Paths finished in
      // an earlier, partial run are skipped.
      async function explore(field, baseline, depth, prefix = '') {
        const options = (field.options ?? []).filter((option) => option.value && !/^-+|^select\b|^choose\b/i.test(option.text));
        for (const option of options) {
          if (Date.now() > deadline) { isPartial = true; return; }
          const key = `${prefix}${field.label}::${option.text}`;
          if (finished.has(key)) continue;
          try {
            await chooseOption(formPage, frame, field, option);
          } catch (error) {
            notes.push(`${field.label} "${option.text}": ${String(error.message).split('\n')[0].slice(0, 100)}`);
            continue;
          }
          const settled = await settledFields(formPage, frame);
          if (!settled.frame) { notes.push(`the form closed after choosing ${field.label} "${option.text}"`); isPartial = true; return; }
          frame = settled.frame;
          const changed = settled.fields.filter((candidate) => candidate.id !== field.id
            && (!baseline.has(candidate.id) || baseline.get(candidate.id) !== optionsKey(candidate)));
          if (changed.length) dependents[key] = changed;
          if (depth === 1) typePresent[key] = settled.fields;
          let complete = true;
          if (depth < 3) {
            const here = new Map(settled.fields.map((candidate) => [candidate.id, optionsKey(candidate)]));
            const children = changed.filter((candidate) => candidate.kind === 'select' && !isTimeSelect(candidate)
              && (candidate.options?.length ?? 0) > 1 && (candidate.options?.length ?? 0) <= 80);
            for (const child of children) {
              await explore(child, here, depth + 1, `${key} >> `);
              if (Date.now() > deadline) { complete = false; break; }
              // Back to this option, so the next child list is read in the right state.
              await chooseOption(formPage, frame, field, option).catch(() => null);
              frame = (await settledFields(formPage, frame)).frame ?? frame;
            }
          }
          if (complete) finished.add(key);
        }
      }

      let fields = base;
      if (typeField) {
        await explore(typeField, new Map(base.map((field) => [field.id, optionsKey(field)])), 1);
        // A field on the form when it opened but missing for some Types (Topic,
        // shown for the Type selected at first) belongs to the Types that show it.
        const lists = Object.values(typePresent);
        if (lists.length > 1) {
          const common = new Set(lists[0].map((field) => field.id).filter((id) => lists.every((list) => list.some((field) => field.id === id))));
          for (const [key, list] of Object.entries(typePresent)) {
            const own = list.filter((field) => !common.has(field.id) && field.id !== typeField.id);
            const known = new Set((dependents[key] ?? []).map((field) => field.id));
            const extra = own.filter((field) => !known.has(field.id));
            if (extra.length) dependents[key] = [...extra, ...(dependents[key] ?? [])];
          }
          fields = base.filter((field) => common.has(field.id) || field.id === typeField.id);
        }
      } else notes.push('no Type list found on the form');
      return {
        capturedAt: new Date().toISOString(),
        typeFieldLabel: typeField?.label ?? null,
        fields,
        dependents,
        typePresent: isPartial ? typePresent : undefined,
        finished: [...finished],
        buttons,
        isPartial,
        notes: notes.join('; ').slice(0, DETAIL_LIMIT),
      };
    } finally {
      context.off('page', onPage);
      for (const shown of opened) await shown.close().catch(() => null);
      await closeOverlays(page).catch(() => null);
    }
  };
}

// Sets one extra field. Returns true, or a problem to report.
async function setExtraField(page, frame, field, value) {
  if (field.kind === 'multiselect') {
    // A pick-several list (Talk(s)): select the chosen options on the real
    // list, then let its "None selected" button catch up.
    const wanted = (Array.isArray(value) ? value : [value]).map(normalizeText);
    const css = field.name ? `select[name="${field.name}"]` : `select[id="${field.id}"]`;
    const missing = await frame.evaluate(({ selector, wantedList }) => {
      const clean = (text) => String(text ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
      const select = document.querySelector(selector);
      if (!select) return wantedList;
      const found = new Set();
      for (const option of select.options) {
        option.selected = wantedList.includes(clean(option.text));
        if (option.selected) found.add(clean(option.text));
      }
      select.dispatchEvent(new Event('change', { bubbles: true }));
      try { window.jQuery?.(select).multiselect?.('refresh'); } catch { /* not a multiselect plugin */ }
      return wantedList.filter((text) => !found.has(text));
    }, { selector: css, wantedList: wanted });
    return missing.length ? `"${field.label}" has no ${missing.map((text) => `"${text}"`).join(', ')}` : true;
  }
  if (field.kind === 'select') {
    const option = pickOption({ options: field.options ?? [] }, String(value));
    if (!option) return `"${field.label}" has no "${value}" (choices: ${(field.options ?? []).map((choice) => choice.text).filter(Boolean).slice(0, 20).join(', ')})`;
    await chooseOption(page, frame, field, option);
    return true;
  }
  if (['checkboxes', 'radio', 'checkbox'].includes(field.kind)) {
    const selector = field.kind === 'radio' ? `input[type=radio][name="${field.name}"]` : `input[type=checkbox][name^="${field.name}"], input[type=checkbox][id^="${field.name}"]`;
    const wanted = field.kind === 'checkbox' ? null : new Set((Array.isArray(value) ? value : [value]).map(normalizeText));
    const missing = await frame.evaluate(({ selector: css, wantedList, single, on }) => {
      const clean = (text) => String(text ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
      const boxes = [...document.querySelectorAll(css)];
      if (single) {
        const box = boxes[0];
        if (!box) return ['the checkbox'];
        if (box.checked !== on) box.click();
        return [];
      }
      const found = new Set();
      for (const box of boxes) {
        const label = clean((box.id && document.querySelector(`label[for="${CSS.escape(box.id)}"]`)?.innerText) || box.closest('label')?.innerText || box.nextSibling?.textContent || box.value);
        const isWanted = wantedList.includes(label);
        if (isWanted) found.add(label);
        if (box.type === 'radio' ? isWanted && !box.checked : box.checked !== isWanted) box.click();
      }
      return wantedList.filter((label) => !found.has(label));
    }, { selector, wantedList: wanted ? [...wanted] : [], single: field.kind === 'checkbox', on: value === true || value === 'true' || value === 'Yes' });
    return missing.length ? `"${field.label}" has no ${missing.map((label) => `"${label}"`).join(', ')}` : true;
  }
  const locator = field.name ? frame.locator(`[name="${field.name}"]`) : frame.locator(`[id="${field.id}"]`);
  await locator.first().evaluate((el, next) => {
    el.removeAttribute('readonly');
    el.focus();
    el.value = next;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
  }, String(value));
  return true;
}

// Fills the extra fields an activity has values for, in as many rounds as it
// takes: a list choice can post back and bring the next field.
async function fillExtraFields(page, frame, values) {
  const filled = [];
  const problems = [];
  const pending = new Map(Object.entries(values));
  let current = frame;
  for (let round = 0; round < pending.size + 4 && pending.size; round += 1) {
    const fields = await readFormFields(current).catch(() => []);
    let changed = false;
    for (const [label, value] of [...pending]) {
      const field = fields.find((candidate) => normalizeText(candidate.label) === normalizeText(label));
      if (!field) continue;
      pending.delete(label);
      changed = true;
      const result = await setExtraField(page, current, field, value).catch((error) => String(error.message).split('\n')[0].slice(0, 160));
      if (result === true) filled.push(field.label);
      else problems.push(result);
      if (field.kind === 'select' || field.kind === 'radio') {
        current = (await settledFields(page, current)).frame ?? current;
        break;
      }
    }
    if (!changed) break;
  }
  for (const label of pending.keys()) problems.push(`no "${label}" field on OGD's form`);
  return { frame: current, filled, problems };
}
