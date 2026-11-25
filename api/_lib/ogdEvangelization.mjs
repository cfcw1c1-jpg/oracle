import { normalizeText, ogdIdFromHref } from './ogdActivities.mjs';
import { AutomationFailure, submitAndSettle } from './ogdLogin.mjs';
import { pagerAction } from './ogdMembers.mjs';

// Reads OGD's Evangelization page: the CLP list (Venue, Area, Start Date, End
// Date, Program Type, Publish?, Target #) and, through each row's "Manage
// Details" link, the CLP's own page: its header (Date, Venue, Supervising Unit
// Head, Chapter Head, Cluster Head), Service Team, Statistics, Participants
// (with one attendance tick per session), Attendance (Sessions) and Graduates.
// Tables are found by their headings, not element ids. A step that does not
// match stops with a description of what was on the page.

export const CLP_FAILURES = {
  page: 'clp_page_unexpected',
};

const TABLE_WAIT_MS = 20000;
const OPEN_WAIT_MS = 15000;
const PAGE_CHANGE_WAIT_MS = 30000;
const NAVIGATION_TIMEOUT_MS = 30000;
const POLL_MS = 500;
const MAX_PAGES = 20;
const MAX_ROWS = 300;
const NOTES_LIMIT = 3000;
const MEMBER_ID = /[A-Z]{2}-\d{4}-\d+/i;

// "11/24/2026" -> "2026-11-24", or null.
export function mdyToDate(text) {
  const match = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(text ?? ''));
  if (!match) return null;
  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

// "Tuesday, November 24, 2026" -> "2026-11-24", or null.
export function longDateToDate(text) {
  const match = /([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})/.exec(String(text ?? ''));
  if (!match) return null;
  const month = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'].indexOf(match[1].toLowerCase());
  if (month === -1) return null;
  return `${match[3]}-${String(month + 1).padStart(2, '0')}-${match[2].padStart(2, '0')}`;
}

// A CLP's key: OGD's id from its Manage Details link, else its venue and start.
export function clpKey(clp) {
  const id = ogdIdFromHref(clp.detailsHref) ?? ogdIdFromHref(clp.venueHref);
  return id ? `id:${id}` : `${normalizeText(clp.venue)}|${clp.startDate ?? clp.start}`;
}

// ---------- The CLP list ----------

export function readClpList(frame) {
  return frame.evaluate(() => {
    const text = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    for (const table of document.querySelectorAll('table')) {
      const rows = [...table.rows];
      const headerIndex = rows.findIndex((row) => {
        const labels = [...row.cells].map(text);
        return labels.some((label) => /^venue$/i.test(label)) && labels.some((label) => /start/i.test(label)) && labels.some((label) => /program/i.test(label));
      });
      if (headerIndex === -1) continue;
      const headers = [...rows[headerIndex].cells].map(text);
      const column = (pattern) => headers.findIndex((header) => pattern.test(header));
      const columns = {
        venue: column(/^venue$/i), area: column(/^area$/i), start: column(/start/i), end: column(/end/i),
        program: column(/program/i), publish: column(/publish/i), target: column(/target/i),
      };
      document.querySelectorAll('[data-oracle-clp]').forEach((el) => el.removeAttribute('data-oracle-clp'));
      const records = [];
      for (const row of rows.slice(headerIndex + 1)) {
        if (row.cells.length !== headers.length || row.querySelector('table')) continue;
        const cells = [...row.cells].map(text);
        if (!cells[columns.venue]) continue;
        const index = records.length;
        const pick = (key) => (columns[key] === -1 ? '' : cells[columns[key]]);
        const venueLink = columns.venue === -1 ? null : row.cells[columns.venue].querySelector('a, [onclick]');
        const detailsLink = [...row.querySelectorAll('a, [onclick]')].find((el) => /manage\s*details/i.test(text(el)));
        if (detailsLink) detailsLink.setAttribute('data-oracle-clp', `${index}-details`);
        const publishCell = columns.publish === -1 ? null : row.cells[columns.publish];
        records.push({
          index, cells,
          venue: pick('venue'), area: pick('area'), start: pick('start'), end: pick('end'), program: pick('program'), target: pick('target'),
          // A tick picture (or any mark) in the Publish? column.
          isPublished: Boolean(publishCell && (publishCell.querySelector('img, svg, i, span[class]') || /\S/.test(text(publishCell)))),
          venueHref: venueLink?.getAttribute('href') || null,
          detailsHref: detailsLink?.getAttribute('href') || null,
          hasDetailsLink: Boolean(detailsLink),
        });
      }
      return { headers, records };
    }
    return null;
  });
}

async function findClpList(page, timeoutMs) {
  const end = Date.now() + timeoutMs;
  do {
    for (const frame of page.frames()) {
      const table = await readClpList(frame).catch(() => null);
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
      .filter((value) => value && value.length <= 40)).catch(() => []);
    found.forEach((value) => texts.add(value));
  }
  return [...texts].slice(0, 60).join(', ');
}

// Opens the Evangelization tab from OGD's signed-in page.
async function openEvangelization(page) {
  const menuText = /^\s*evangeli[sz]ation\s*$/i;
  for (const frame of page.frames()) {
    const menu = frame.locator('a').filter({ hasText: menuText }).or(frame.locator('[onclick]').filter({ hasText: menuText }));
    for (let index = 0; index < (await menu.count().catch(() => 0)); index += 1) {
      const element = menu.nth(index);
      if (!(await element.isVisible().catch(() => false))) continue;
      await submitAndSettle(page, () => element.click());
      const found = await findClpList(page, TABLE_WAIT_MS);
      if (found) return found;
    }
  }
  throw new AutomationFailure(CLP_FAILURES.page, `No Evangelization (CLP) list on ${new URL(page.url()).pathname} titled "${await page.title()}". Links seen: ${await visibleLinkTexts(page)}`);
}

const firstKey = (table) => table.records[0]?.cells.join('|') ?? '';

async function waitForNextPage(page, previousKey) {
  const end = Date.now() + PAGE_CHANGE_WAIT_MS;
  while (Date.now() < end) {
    await page.waitForTimeout(POLL_MS);
    const found = await findClpList(page, 0);
    if (found?.table.records.length && firstKey(found.table) !== previousKey) return found;
  }
  return null;
}

// Back on the list's page number after the list was lost: the Evangelization
// tab again, then "next" until that page.
async function reopenListAt(page, pageNumber) {
  let list = await openEvangelization(page);
  for (let current = 1; current < pageNumber; current += 1) {
    const key = firstKey(list.table);
    const { moved } = await pagerAction(list.frame, 'next').catch(() => ({ moved: false }));
    if (!moved) return null;
    list = await waitForNextPage(page, key);
    if (!list) return null;
  }
  return list;
}

// ---------- One CLP's page ----------

// Returns null unless the frame shows a CLP's page (a Service Team or
// Participants table).
export function readClpDetails(frame) {
  return frame.evaluate((memberIdSource) => {
    const memberIdPattern = new RegExp(memberIdSource, 'i');
    const text = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const stripNumber = (value) => value.replace(/^\d+\.\s*/, '').trim();
    const idIn = (cell) => {
      const link = cell?.querySelector('a, [onclick]');
      const source = `${link?.getAttribute('href') || ''} ${link?.getAttribute('onclick') || ''}`;
      return (source.match(memberIdPattern) ?? [])[0]?.toUpperCase() ?? null;
    };
    const tables = [...document.querySelectorAll('table')].filter((table) => !table.querySelector('table')).map((table) => {
      const rows = [...table.rows];
      const headers = rows.length ? [...rows[0].cells].map((cell) => text(cell).toUpperCase()) : [];
      return { table, rows, headers };
    });
    const has = (headers, pattern) => headers.some((header) => pattern.test(header));
    const find = (test) => tables.find(({ headers }) => test(headers));
    const body = (entry) => (entry ? entry.rows.slice(1).filter((row) => row.cells.length === entry.headers.length) : []);
    const column = (entry, pattern) => entry.headers.findIndex((header) => pattern.test(header));

    const service = find((headers) => has(headers, /^ROLE$/) && has(headers, /^NAME$/));
    const participants = find((headers) => has(headers, /^NAME$/) && has(headers, /^AGE$/));
    if (!service && !participants) return null;
    const sessions = find((headers) => has(headers, /^TALK$/) && has(headers, /SPEAKER/));
    const graduates = find((headers) => has(headers, /^ID\s*NO/) && has(headers, /^NAME$/));
    const stats = find((headers) => has(headers, /DEMOGRAPHIC|STATISTIC/));

    // Header lines: "Date: ...", "Venue: ...", "Chapter Head: ...", and the
    // "COMMUNITY | WEST 1C1" line with the program type and area.
    const header = {};
    let programType = null;
    let area = null;
    const lines = String(document.body?.innerText || '').split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
    for (const line of lines) {
      if (/^(service team|participants|attendance|graduates|statistics)\b/i.test(line)) break;
      const pair = /^([A-Za-z][A-Za-z .'/]{1,40}):\s*(.+)$/.exec(line);
      if (pair && !/^other clp/i.test(pair[1])) header[pair[1].trim()] = pair[2].trim();
      const program = /^([A-Z][A-Z ]{2,30})\s*\|\s*(.+)$/.exec(line);
      if (program && !programType) {
        programType = program[1].trim();
        area = program[2].replace(/other clp.*$/i, '').trim();
      }
    }

    const serviceTeam = service ? body(service).map((row) => {
      const cells = [...row.cells];
      const at = (pattern) => cells[column(service, pattern)];
      return { role: text(at(/^ROLE$/)), name: stripNumber(text(at(/^NAME$/))), gender: text(at(/GENDER/)), memberId: idIn(at(/^NAME$/)) };
    }).filter((entry) => entry.name) : [];

    let sessionColumns = [];
    const participantList = participants ? (() => {
      const genderIndex = column(participants, /GENDER/);
      const firstSession = Math.max(genderIndex, column(participants, /^AGE$/), column(participants, /NICKNAME/)) + 1;
      sessionColumns = participants.headers.slice(firstSession).map((header, index) => text(participants.rows[0].cells[firstSession + index]) || header);
      return body(participants).map((row) => {
        const cells = [...row.cells];
        const at = (pattern) => cells[column(participants, pattern)];
        const ticked = (cell) => Boolean(cell && (cell.querySelector('img, svg, i, span[class]') || /\S/.test(text(cell))));
        return {
          name: stripNumber(text(at(/^NAME$/))),
          nickname: text(at(/NICKNAME/)) || null,
          age: Number(text(at(/^AGE$/))) || null,
          gender: text(at(/GENDER/)) || null,
          memberId: idIn(at(/^NAME$/)),
          attendance: cells.slice(firstSession).map(ticked),
        };
      }).filter((entry) => entry.name);
    })() : [];

    const sessionList = sessions ? body(sessions).map((row) => {
      const cells = [...row.cells];
      const at = (pattern) => text(cells[column(sessions, pattern)]);
      return { date: at(/^DATE$/), talk: stripNumber(at(/^TALK$/)), speaker: at(/SPEAKER/), pax: Number((at(/PAX/).match(/\d+/) ?? [])[0] ?? NaN) || 0 };
    }).filter((entry) => entry.talk || entry.date) : [];

    const graduateList = graduates ? body(graduates).map((row) => {
      const cells = [...row.cells];
      const at = (pattern) => text(cells[column(graduates, pattern)]);
      return { memberId: at(/^ID\s*NO/) || null, name: stripNumber(at(/^NAME$/)), gender: at(/GENDER/) || null, householdHead: at(/H\s*HOLD|HOUSEHOLD/) || null };
    }).filter((entry) => entry.name) : [];

    const statistics = {};
    if (stats) stats.rows.slice(1).forEach((row) => {
      if (row.cells.length !== 2) return;
      const label = text(row.cells[0]);
      const value = Number(text(row.cells[1]));
      if (label) statistics[label] = Number.isNaN(value) ? text(row.cells[1]) : value;
    });

    return { programType, area, header, serviceTeam, participants: participantList, sessionColumns, sessions: sessionList, graduates: graduateList, statistics };
  }, MEMBER_ID.source);
}

function isRealHref(href) {
  return Boolean(href) && !/^(javascript:|#)/i.test(href);
}

// Opens a row's Manage Details and reads the CLP's page: in its own tab when
// the link is a real address, else by clicking it and coming back.
// Returns { details, url, lost }.
async function openDetails(page, list, row) {
  if (isRealHref(row.detailsHref)) {
    const tab = await page.context().newPage();
    try {
      await tab.goto(new URL(row.detailsHref, list.frame.url()).href, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT_MS });
      const end = Date.now() + OPEN_WAIT_MS;
      do {
        for (const frame of tab.frames()) {
          const details = await readClpDetails(frame).catch(() => null);
          if (details) return { details, url: tab.url(), lost: false };
        }
        await tab.waitForTimeout(POLL_MS);
      } while (Date.now() < end);
      return { details: null, url: tab.url(), lost: false };
    } finally {
      await tab.close().catch(() => null);
    }
  }

  const startUrl = page.url();
  let details = null;
  let url = null;
  await submitAndSettle(page, () => list.frame.locator(`[data-oracle-clp="${row.index}-details"]`).first().click({ timeout: 10000 }));
  const end = Date.now() + OPEN_WAIT_MS;
  while (!details && Date.now() < end) {
    for (const frame of page.frames()) {
      details = await readClpDetails(frame).catch(() => null);
      if (details) { url = frame.url(); break; }
    }
    if (!details) await page.waitForTimeout(POLL_MS);
  }
  if (page.url() !== startUrl || !(await findClpList(page, 0))) {
    await page.goBack({ waitUntil: 'load', timeout: NAVIGATION_TIMEOUT_MS }).catch(() => null);
  }
  const back = await findClpList(page, TABLE_WAIT_MS);
  const lost = !back || firstKey(back.table) !== firstKey(list.table);
  if (!lost) {
    list.frame = back.frame;
    list.table = back.table;
  }
  return { details, url, lost };
}

// ---------- Sync ----------

// Run on OGD's signed-in page. Reads every CLP on the Evangelization list
// with its page, until deadline. Never throws once the list is open, so what
// was read is kept.
export function createClpSync({ deadline }) {
  return async function syncClps(page) {
    let list = await openEvangelization(page);
    const clps = [];
    const notes = [];
    let isPartial = false;
    let pageNumber = 1;
    try {
      for (; pageNumber <= MAX_PAGES && clps.length < MAX_ROWS; pageNumber += 1) {
        for (const record of list.table.records) {
          const clp = {
            venue: record.venue, area: record.area, start: record.start, end: record.end,
            startDate: mdyToDate(record.start), endDate: mdyToDate(record.end),
            programType: record.program || null, isPublished: record.isPublished,
            targetPax: Number((record.target.match(/\d+/) ?? [])[0] ?? NaN),
            venueHref: isRealHref(record.venueHref) ? new URL(record.venueHref, list.frame.url()).href : null,
            detailsHref: isRealHref(record.detailsHref) ? new URL(record.detailsHref, list.frame.url()).href : null,
            details: null,
          };
          if (Number.isNaN(clp.targetPax)) clp.targetPax = null;
          clps.push(clp);
          if (Date.now() > deadline) { isPartial = true; continue; }
          if (!record.hasDetailsLink) { notes.push(`${record.venue} (${record.start}): no Manage Details link`); continue; }

          const row = list.table.records.find((candidate) => candidate.cells.join('|') === record.cells.join('|')) ?? record;
          const opened = await openDetails(page, list, row).catch((error) => ({ details: null, error, lost: true }));
          if (opened.details) {
            clp.details = opened.details;
            if (!clp.detailsHref && /[?&]\w+=/.test(opened.url ?? '')) clp.detailsHref = opened.url;
          } else {
            notes.push(`${record.venue} (${record.start}): details not found${opened.error ? ` (${String(opened.error.message).split('\n')[0].slice(0, 120)})` : ''}`);
          }
          if (opened.lost) {
            const back = await reopenListAt(page, pageNumber).catch(() => null);
            if (!back) throw new Error('the Evangelization list did not come back after opening a CLP');
            list = back;
          }
        }
        if (Date.now() > deadline) { isPartial = true; break; }
        const key = firstKey(list.table);
        const { moved } = await pagerAction(list.frame, 'next').catch(() => ({ moved: false }));
        if (!moved) break;
        const next = await waitForNextPage(page, key);
        if (!next) { notes.push(`page ${pageNumber + 1} did not load`); isPartial = true; break; }
        list = next;
      }
    } catch (error) {
      isPartial = true;
      notes.push(`Stopped early: ${String(error?.message ?? error).split('\n')[0].slice(0, 300)}`);
    }
    return { clps, isPartial, pagesRead: pageNumber, notes: notes.join('; ').slice(0, NOTES_LIMIT) };
  };
}
