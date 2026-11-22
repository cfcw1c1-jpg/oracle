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
      if (!label || label.length > 60) continue;
      let value = '';
      if (el.tagName === 'SELECT') value = clean(el.options[el.selectedIndex]?.text);
      else if (el.type === 'checkbox' || el.type === 'radio') { if (!el.checked) continue; value = 'Yes'; }
      else value = clean(el.value);
      if (value) fields[label] = fields[label] ? `${fields[label]} ${value}` : value;
    }
    for (const row of document.querySelectorAll('tr')) {
      if (row.querySelector('table, input, select, textarea') || row.cells.length !== 2) continue;
      const label = clean(row.cells[0].innerText).replace(/[:*]+$/, '').trim();
      const value = clean(row.cells[1].innerText);
      if (label && value && label.length <= 60 && !fields[label]) fields[label] = value;
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
      if (!best || score > best.score) best = { headers, records, score };
    }
    if (!best) return null;
    return { headers: best.headers, records: best.records };
  });
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
            const opened = await openAndRead(page, list, row, 'attendance', readAttendeeTable).catch((error) => ({ result: null, error }));
            if (opened.result) activity.attendeeTable = opened.result;
            else notes.push(`${record.name}: attendees not found${opened.error ? ` (${String(opened.error.message).split('\n')[0].slice(0, 120)})` : ''}`);
            if (opened.lost) throw new Error('the Activities list did not come back after opening an attendance list');
          }
          if (row.hasNameLink && Date.now() < deadline) {
            const freshRow = list.table.records.find((candidate) => candidate.cells.join('|') === record.cells.join('|')) ?? row;
            const opened = await openAndRead(page, list, freshRow, 'name', async (frame) => {
              const details = await readDetailFields(frame, record.name);
              if (!details) return null;
              const attendees = activity.attendeeTable ? null : await readAttendeeTable(frame).catch(() => null);
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
  return frame.evaluate(() => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const isShown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const labelOf = (el) => {
      if (el.id) {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (label) return clean(label.innerText);
      }
      const wrapping = el.closest('label');
      if (wrapping) return clean(wrapping.innerText);
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
    const controls = [...document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image]):not([type=checkbox]):not([type=radio]), select, textarea')]
      .filter(isShown)
      .map((el, index) => {
        el.setAttribute('data-oracle-field', String(index));
        return {
          index, tag: el.tagName.toLowerCase(), type: (el.getAttribute('type') || '').toLowerCase(), id: el.id, name: el.name,
          label: labelOf(el).replace(/[:*]+$/, '').trim(), readOnly: el.readOnly, value: el.value,
          hint: clean(`${el.name} ${el.id} ${el.getAttribute('placeholder') || ''}`),
          options: el.tagName === 'SELECT' ? [...el.options].map((option) => ({ value: option.value, text: clean(option.text) })) : [],
        };
      });
    const buttons = [...document.querySelectorAll('input[type=submit], input[type=button], button, a.btn, a[id*="btn" i]')]
      .filter(isShown).map((el, index) => {
        el.setAttribute('data-oracle-button', String(index));
        return { index, text: clean(el.value || el.innerText || el.textContent) };
      }).filter((button) => button.text);
    return { path: location.pathname, controls, buttons, text: clean(document.body?.innerText).slice(0, 1500) };
  });
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
export function createActivityPush(activity) {
  return async function pushActivity(page) {
    await openActivities(page);
    const context = page.context();
    const opened = [];
    const onPage = (newPage) => opened.push(newPage);
    context.on('page', onPage);
    try {
      const newButton = (frame) => frame.locator('input[type=submit], input[type=button], button, a').filter({ hasText: /^\s*new activity\s*$/i })
        .or(frame.locator('input[type=submit][value="New Activity" i], input[type=button][value="New Activity" i]'));
      if (!(await clickFirstVisible(page, newButton))) {
        throw new AutomationFailure(ACTIVITY_FAILURES.form, `No New Activity button on the Activities page. Buttons seen: ${await visibleLinkTexts(page)}`);
      }
      const { page: formPage, frame } = await waitForNewActivityForm(page, opened);
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
          else { await setControl(formPage, frame, typeControl, option.value); filled.push(typeControl.label); form = await snapshotForm(frame); }
        }
      }

      const areaControl = findControl(form, /^area|area\s*name/i, { tag: 'select' });
      if (areaControl && activity.area_name) {
        const option = pickOption(areaControl, activity.area_name);
        if (option) { await setControl(formPage, frame, areaControl, option.value); filled.push(areaControl.label); form = await snapshotForm(frame); }
        else problems.push(`Area has no "${activity.area_name}" (choices: ${areaControl.options.map((choice) => choice.text).filter(Boolean).slice(0, 30).join(', ')})`);
      }

      if (!(await fillWhen(formPage, frame, form, /start|date\s*from|^from|^date$/i, activity.starts_at, filled))) problems.push('no Start Date box');
      if (activity.ends_at && !(await fillWhen(formPage, frame, form, /end|date\s*to|^to$/i, activity.ends_at, filled))) problems.push('no End Date box');

      const optional = [
        [/team\s*leader|leader/i, activity.team_leader],
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
const ADD_BUTTON = /^\s*(add|add attendees?|add members?|add participants?|add to (list|attendance)|include|tag|enroll)\s*$/i;
const SEARCH_BUTTON = /^\s*(search|find|go|look\s*up|search member)\s*$/i;
const SAVE_BUTTON = /^\s*(save|update|submit|save attendance|save attendees|save changes|done|ok|confirm)\s*$/i;
const OPEN_ADD_BUTTON = /add\s*(attendees?|members?|participants?|attendance)|encode|tag\s*attendees?|^\s*add\s*$/i;
const ATTENDEE_STEP_WAIT_MS = 1500;

// The text keys a member's row may show: the Member ID, "LAST FIRST" or "FIRST LAST".
export function attendeeTargets(members) {
  return members.map((member) => {
    const last = normalizeText(member.Lastname ?? member.last);
    const first = normalizeText(member.Firstname ?? member.first);
    return { memberId: String(member.MemberIDNo ?? member.memberId ?? '').toUpperCase(), keys: [`${last} ${first}`, `${first} ${last}`].filter((key) => key.trim().includes(' ')) };
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
    if (!(await readAttendeeTable(frame).catch(() => null)) || await readActivitiesTable(frame).catch(() => null)) continue;
    for (let pageNumber = 2; pageNumber <= MAX_ATTENDEE_PAGES; pageNumber += 1) {
      const before = JSON.stringify((await readAttendeeTable(frame).catch(() => null))?.records ?? []);
      const { moved } = await pagerAction(frame, 'next').catch(() => ({ moved: false }));
      if (!moved) break;
      let changed = false;
      for (let wait = 0; wait < 20 && !changed; wait += 1) {
        await page.waitForTimeout(POLL_MS);
        changed = JSON.stringify((await readAttendeeTable(frame).catch(() => null))?.records ?? []) !== before;
      }
      if (!changed) break;
      const states = await scanFrame(frame, targets).catch(() => null);
      states?.forEach((state, index) => {
        if (STATE_RANK[state] === 4 && STATE_RANK[best[index].state] < 4) best[index] = { state, frame: null };
      });
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

// A member search box in any frame: a text box labelled for members, IDs or names.
async function findSearchBox(page) {
  for (const frame of page.frames()) {
    const form = await snapshotForm(frame).catch(() => null);
    if (!form) continue;
    const boxes = form.controls.filter((control) => control.tag === 'input' && ['', 'text', 'search'].includes(control.type) && !control.readOnly
      && SEARCH_BOX.test(`${control.label} ${control.hint}`) && !NOT_SEARCH_BOX.test(control.label || ''));
    const box = boxes.find((control) => /member|id/i.test(`${control.label} ${control.hint}`)) ?? boxes[0];
    if (box) return { frame, locator: frame.locator(`[data-oracle-field="${box.index}"]`) };
  }
  return null;
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
  const { frame, locator } = search;
  await locator.click({ timeout: 5000 }).catch(() => null);
  await locator.fill('').catch(() => null);
  await locator.pressSequentially(target.memberId, { delay: 25 }).catch(() => locator.fill(target.memberId));
  await page.waitForTimeout(ATTENDEE_STEP_WAIT_MS);
  const suggestion = frame.locator('.ui-autocomplete li, .ui-menu-item, [role=option], .autocomplete-suggestion, .tt-suggestion, .select2-results li')
    .filter({ hasText: new RegExp(target.memberId.replace(/[-]/g, '.?'), 'i') }).first();
  if (await suggestion.isVisible().catch(() => false)) {
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
  if (found.state === 'checkable' || found.state === 'addable') {
    const pick = found.frame.locator('[data-oracle-pick="0"]').first();
    if (found.state === 'checkable') await pick.check({ timeout: 5000, force: true }).catch(() => null);
    else await clickAndSettle(page, pick);
    const confirm = await visibleButton(page, ADD_BUTTON, found.frame) ?? await visibleButton(page, SAVE_BUTTON, found.frame);
    if (confirm) await clickAndSettle(page, confirm);
  }
}

// Does the adding on an opened activity or attendance page.
async function addOnPage(page, targets, deadline) {
  const actions = [];
  // Members already on OGD's attendee list (any page of it) are left alone.
  const already = new Set((await scanAllPages(page, targets))
    .map((entry, index) => (STATE_RANK[entry.state] === 4 ? index : -1)).filter((index) => index !== -1));
  if (already.size) actions.push(`${already.size} already in OGD, not added again`);
  if (already.size === targets.length) return { states: targets.map(() => ({ state: 'listed' })), actions, already };
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

  // The rest through a member search box, opening the Add form first if needed.
  const missing = targets.map((_, index) => index).filter((index) => states[index].state === 'missing');
  if (missing.length && Date.now() < deadline) {
    let search = await findSearchBox(page);
    if (!search) {
      const opener = await visibleButton(page, OPEN_ADD_BUTTON);
      if (opener) {
        await clickAndSettle(page, opener);
        actions.push('opened the add form');
        search = await findSearchBox(page);
      }
    }
    if (!search) return { states: await refresh(), actions, already, problem: `No way to add attendees found. ${await describeAttendeePage(page)}` };
    for (const index of missing) {
      if (Date.now() > deadline) break;
      // Check again just before adding: an earlier add may have brought them in.
      const [now] = await scanPage(page, [targets[index]]);
      if (STATE_RANK[now.state] === 4) continue;
      await addBySearch(page, search, targets[index]);
      search = await findSearchBox(page) ?? search;
    }
    actions.push(`searched ${missing.length}`);
    const save = await visibleButton(page, SAVE_BUTTON);
    if (save) { await clickAndSettle(page, save); actions.push('saved'); }
    states = await refresh();
  }
  return { states, actions, already };
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
export function createAttendeePush(activity, members, { deadline }) {
  const targets = attendeeTargets(members);
  return async function pushAttendees(page) {
    const workDeadline = deadline - 45 * 1000;
    const result = await onActivityPage(page, activity, workDeadline, (shown) => addOnPage(shown, targets, workDeadline));
    // Read the attendee list fresh, so only what OGD saved counts.
    let finalStates = result.states.map((entry) => entry.state);
    let checked = false;
    if (Date.now() < deadline) {
      const fresh = await onActivityPage(page, activity, deadline, (shown) => scanAllPages(shown, targets)).catch(() => null);
      if (fresh) { finalStates = fresh.map((entry) => entry.state); checked = true; }
    }
    const added = [];
    const failed = [];
    const alreadyIds = [...result.already].map((index) => targets[index].memberId);
    targets.forEach((target, index) => {
      if (result.already.has(index)) added.push(target.memberId);
      else if (finalStates[index] === 'listed' || finalStates[index] === 'checked') added.push(target.memberId);
      else failed.push({ memberId: target.memberId, reason: Date.now() > deadline && finalStates[index] === 'missing' ? 'not reached' : `not in OGD's list (${finalStates[index]})` });
    });
    const detail = [
      `In OGD: ${added.length} of ${targets.length}${alreadyIds.length ? ` (${alreadyIds.length} already there, not added again)` : ''}${checked ? ', checked against OGD\'s attendee list' : ' (could not reopen the activity to check)'}.`,
      result.actions.length ? `Steps: ${result.actions.join(', ')}.` : '',
      result.problem ?? '',
    ].filter(Boolean).join(' ').slice(0, DETAIL_LIMIT);
    if (!added.length && result.problem) throw new AutomationFailure(ACTIVITY_FAILURES.attendees, result.problem);
    return { added, already: alreadyIds, failed, detail };
  };
}
