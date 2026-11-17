import { AutomationFailure, submitAndSettle } from './ogdLogin.mjs';

// Reads OGD's Members Database list (members_list.aspx) and maps its rows onto
// the members table. Only the list columns are read; formation progress needs
// a dialog per talk and is far too slow for one function run.

// Resolved against the signed-in page, which is on cfcglobaldata.com.
const MEMBERS_PATH = '/members_list.aspx';
const TABLE_WAIT_MS = 20000;
const PAGE_CHANGE_WAIT_MS = 30000;
const POLL_MS = 500;
const MAX_PAGES = 200;

// members.Status only allows the app's own values (members_status_check).
// SiteStatus keeps OGD's value as shown.
export const STATUS_MAP = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  DECEASED: 'Deceased',
  'MOVED TO HOLD': 'Inactive',
  'MOVED TO OTHER COMMUNITY': 'Inactive',
};

const blank = (value) => {
  const text = String(value ?? '').trim();
  return text === '' ? null : text;
};

// Maps one list row to a members row. Returns { member } or { skip } with the
// reason, so a single odd row never sinks the whole sync.
export function toMemberRow(headers, cells) {
  const row = Object.fromEntries(headers.map((header, index) => [header, cells[index]]));
  const memberId = blank(row['Member ID #']);
  const fullName = blank(row['Member Name']);
  if (!memberId || !fullName) return { skip: 'missing_id' };

  const siteStatus = blank(row.Status)?.toUpperCase() ?? null;
  if (siteStatus && !STATUS_MAP[siteStatus]) return { skip: 'unknown_status', value: siteStatus };

  const comma = fullName.indexOf(',');
  const yearMatch = /^PM-(\d{4})-/.exec(memberId);
  return {
    member: {
      MemberIDNo: memberId,
      Lastname: comma === -1 ? fullName : fullName.slice(0, comma).trim(),
      Firstname: comma === -1 ? null : fullName.slice(comma + 1).trim() || null,
      AreaName: blank(row.Area),
      PastoralService: blank(row.Service),
      SpouseName: blank(row['Spouse Name']),
      Phone: blank(row.Phone),
      MobileNo: blank(row['Mobile #']),
      Email: blank(row.Email),
      SiteStatus: siteStatus,
      Status: siteStatus ? STATUS_MAP[siteStatus] : 'Active',
      YearRegistered: yearMatch ? Number(yearMatch[1]) : null,
    },
  };
}

// A chapter's sync only writes members whose OGD Area belongs to it. OGD names
// sub-units by suffix ("West 1C1A" under "West 1C1"), matching the Directory's
// prefix scoping.
// households maps Member ID to a household head; members without one leave
// NameOfHouseholdHead out, so a stored value is never blanked.
export function planMemberSync({ headers, records, households = new Map() }, chapterName) {
  const members = new Map();
  const skipped = { outside: 0, missingId: 0, unknownStatus: new Set() };
  for (const cells of records) {
    const result = toMemberRow(headers, cells);
    if (result.skip === 'missing_id') skipped.missingId += 1;
    else if (result.skip === 'unknown_status') skipped.unknownStatus.add(result.value);
    else if (!result.member.AreaName?.toUpperCase().startsWith(chapterName.toUpperCase())) skipped.outside += 1;
    else {
      const head = households.get(result.member.MemberIDNo);
      members.set(result.member.MemberIDNo, head ? { ...result.member, NameOfHouseholdHead: head } : result.member);
    }
  }
  return { members: [...members.values()], skipped: { ...skipped, unknownStatus: [...skipped.unknownStatus] } };
}

// Returns the list table's headers and rows, or null when no table in the frame
// has a "Member Name" heading. Nested layout rows are ignored.
function readMembersTable(frame) {
  return frame.evaluate(() => {
    const text = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    for (const table of document.querySelectorAll('table')) {
      const rows = [...table.rows];
      const headerIndex = rows.findIndex((row) => [...row.cells].some((cell) => /^member name$/i.test(text(cell))));
      if (headerIndex === -1) continue;
      const headers = [...rows[headerIndex].cells].map(text);
      const nameColumn = headers.findIndex((header) => /^member name$/i.test(header));
      // Tags each member row with its index in records so it can be clicked.
      document.querySelectorAll('[data-oracle-row]').forEach((el) => el.removeAttribute('data-oracle-row'));
      const records = [];
      for (const row of rows.slice(headerIndex + 1)) {
        if (row.cells.length !== headers.length || row.querySelector('table')) continue;
        const cells = [...row.cells].map(text);
        if (!cells[nameColumn]) continue;
        row.setAttribute('data-oracle-row', String(records.length));
        records.push(cells);
      }
      return { headers, nameColumn, records };
    }
    return null;
  });
}

async function findMembersTable(page, timeoutMs) {
  const end = Date.now() + timeoutMs;
  do {
    for (const frame of page.frames()) {
      const table = await readMembersTable(frame).catch(() => null);
      if (table) return { frame, table };
    }
    await page.waitForTimeout(POLL_MS);
  } while (Date.now() < end);
  return null;
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

// Opens Members Database from the signed-in page: menu link first, then the
// page's own URL, then its Search button for when OGD waits for one.
async function openMembersList(page) {
  // Links first: clicking a wider container such as the menu's <li> lands on
  // its centre and can miss the link inside it.
  const menuText = /^\s*members database\s*$/i;
  const menu = (frame) => frame.locator('a').filter({ hasText: menuText }).or(frame.locator('[onclick]').filter({ hasText: menuText }));
  if (await clickFirstVisible(page, menu)) {
    const found = await findMembersTable(page, TABLE_WAIT_MS);
    if (found) return found;
  }
  if (!/members_list\.aspx/i.test(page.url())) {
    await page.goto(new URL(MEMBERS_PATH, page.url()).href, { waitUntil: 'load', timeout: TABLE_WAIT_MS }).catch(() => null);
    const found = await findMembersTable(page, TABLE_WAIT_MS);
    if (found) return found;
  }
  const search = (frame) => frame.locator('input[type=submit], input[type=button], button').filter({ hasText: /^\s*search\s*$/i })
    .or(frame.locator('input[type=submit][value="Search" i], input[type=button][value="Search" i]'));
  if (await clickFirstVisible(page, search)) {
    const found = await findMembersTable(page, TABLE_WAIT_MS);
    if (found) return found;
  }
  throw new AutomationFailure('members_page_unexpected', `No Members Database list on ${new URL(page.url()).pathname} titled "${await page.title()}".`);
}

// Reads or moves an ASP.NET GridView pager inside the list's frame. 'read'
// returns the current page; 'next' posts back to the following page.
function pagerAction(frame, action) {
  return frame.evaluate((action) => {
    const text = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    const isPagerText = (value) => /^(\d+|\.\.\.|…|next|>|>>|»|last)$/i.test(value);
    let links = [...document.querySelectorAll('a')].filter(
      (a) => isPagerText(text(a)) && (/Page\$|__doPostBack|page=/i.test(a.getAttribute('href') || '') || /^\d+$/.test(text(a))),
    );
    const pagerLinks = links.filter((a) => /Page\$|page=/i.test(a.getAttribute('href') || ''));
    if (pagerLinks.length) links = pagerLinks;
    if (!links.length) return { current: 1, moved: false };

    let box = links[0].parentElement;
    while (box && !links.every((link) => box.contains(link))) box = box.parentElement;
    box = box || document.body;
    const currentEl = [...box.querySelectorAll('span, b, strong, td, font')].find(
      (el) => /^\d+$/.test(text(el)) && !el.closest('a') && !el.querySelector('a') && [...el.children].every((child) => !/\d/.test(text(child))),
    );
    const current = currentEl ? Number(text(currentEl)) : 1;
    if (action === 'read') return { current, moved: false };

    // A "..." before the current page leads back, so only links after it count.
    const want = current + 1;
    const isAfterCurrent = (a) => !currentEl || Boolean(currentEl.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING);
    const target = links.find((a) => text(a) === String(want)) || links.find((a) => /^(\.\.\.|…|next|>|»)$/i.test(text(a)) && isAfterCurrent(a));
    if (!target) return { current, moved: false };
    const postback = links.map((a) => (a.getAttribute('href') || '').match(/__doPostBack\('([^']+)','Page\$/)).find(Boolean);
    if (postback && typeof window.__doPostBack === 'function') {
      window.__doPostBack(postback[1], `Page$${want}`);
      return { current, moved: true };
    }
    target.click();
    return { current, moved: true };
  }, action);
}

const firstKey = (table) => table.records[0]?.join('|') ?? '';

async function waitForNextPage(page, previousKey) {
  const end = Date.now() + PAGE_CHANGE_WAIT_MS;
  while (Date.now() < end) {
    await page.waitForTimeout(POLL_MS);
    if (/app_error/i.test(page.url())) return { error: 'OGD showed its server error page.' };
    const found = await findMembersTable(page, 0);
    if (found?.table.records.length && firstKey(found.table) !== previousKey) return { found };
  }
  return { error: 'The next page did not load in time.' };
}

// ---------- Household head (member popup > Service tab) ----------

// "DE VERO, RONALDO" -> "RONALDO DE VERO", the order the members table
// already stores household heads in.
export function toHouseholdHeadName(siteName) {
  const name = String(siteName ?? '').trim().replace(/\s+/g, ' ');
  if (!name) return null;
  const comma = name.indexOf(',');
  if (comma === -1) return name;
  const last = name.slice(0, comma).trim();
  const first = name.slice(comma + 1).trim();
  return first ? `${first} ${last}` : last;
}

// The Pastoral Service Record row whose TO is "PRESENT" gives the current
// household head. Returns undefined when there is no such row.
export function presentHouseholdHead(rows) {
  const present = rows.find((row) => /^present$/i.test(String(row.to ?? '').trim()));
  return present ? toHouseholdHeadName(present.hhHead) : undefined;
}

const MODAL_CONTAINERS = '#simplemodal-container, .simplemodal-container, .simplemodal-wrap, .ui-dialog, .modal.show, [role=dialog]';
const MODAL_CLOSE = '.simplemodal-close, .modalCloseImg, a.modalClose, #simplemodal-container a.close, .ui-dialog-titlebar-close';
const MODAL_WAIT_MS = 15000;
const CLICK_TIMEOUT_MS = 10000;
const MAX_CONSECUTIVE_FAILURES = 4;

// Reads the Pastoral Service Record table: the one whose header row has both
// TO and HH HEAD (Service Roles has TO but no HH HEAD). Also reports whether
// the frame shows the expected Member ID, so a stale popup is never read.
function readServiceRecord(frame, memberId) {
  return frame.evaluate((memberId) => {
    const text = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().toUpperCase();
    for (const table of document.querySelectorAll('table')) {
      const rows = [...table.rows];
      const headerIndex = rows.findIndex((row) => {
        const labels = [...row.cells].map(text);
        return labels.includes('TO') && labels.includes('HH HEAD');
      });
      if (headerIndex === -1) continue;
      const labels = [...rows[headerIndex].cells].map(text);
      const toColumn = labels.indexOf('TO');
      const headColumn = labels.indexOf('HH HEAD');
      return {
        showsMember: (document.body.innerText || '').includes(memberId),
        rows: rows.slice(headerIndex + 1).filter((row) => !row.querySelector('table')).map((row) => ({
          to: (row.cells[toColumn]?.innerText || '').trim(),
          hhHead: (row.cells[headColumn]?.innerText || '').trim(),
        })),
      };
    }
    return null;
  }, memberId);
}

// Finds a visible element with exactly this text inside the member popup:
// first in frames the popup added, then inside a popup container. Links are
// tried before wider elements so the click lands on the link itself.
async function findInPopup(page, framesBefore, label) {
  const pattern = new RegExp(`^\\s*${label}\\s*$`, 'i');
  const kinds = ['a', 'li', 'span', 'td', 'div', 'button'];
  const end = Date.now() + MODAL_WAIT_MS;
  do {
    const newFrames = page.frames().filter((frame) => !framesBefore.has(frame));
    const scopes = [...newFrames.map((frame) => frame.locator('body')), ...page.frames().map((frame) => frame.locator(MODAL_CONTAINERS))];
    for (const scope of scopes) {
      for (const kind of kinds) {
        const locator = scope.locator(kind).filter({ hasText: pattern });
        for (let index = 0; index < (await locator.count().catch(() => 0)); index += 1) {
          const element = locator.nth(index);
          if (await element.isVisible().catch(() => false)) return element;
        }
      }
    }
    await page.waitForTimeout(POLL_MS);
  } while (Date.now() < end);
  return null;
}

async function waitForServiceRecord(page, memberId) {
  const end = Date.now() + MODAL_WAIT_MS;
  do {
    for (const frame of page.frames()) {
      const record = await readServiceRecord(frame, memberId).catch(() => null);
      if (record?.showsMember) return record;
    }
    await page.waitForTimeout(POLL_MS);
  } while (Date.now() < end);
  return null;
}

async function popupIsOpen(page, memberId) {
  for (const frame of page.frames()) {
    if ((await readServiceRecord(frame, memberId).catch(() => null))?.showsMember) return true;
    if (await frame.locator(MODAL_CONTAINERS).first().isVisible().catch(() => false)) return true;
  }
  return false;
}

async function closePopup(page, memberId) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let clicked = false;
    for (const frame of page.frames()) {
      const close = frame.locator(MODAL_CLOSE).first();
      if (await close.isVisible().catch(() => false)) {
        await close.click({ force: true, timeout: CLICK_TIMEOUT_MS }).catch(() => null);
        clicked = true;
        break;
      }
    }
    if (!clicked) await page.keyboard.press('Escape').catch(() => null);
    await page.waitForTimeout(POLL_MS);
    if (!(await popupIsOpen(page, memberId))) return;
  }
}

// Opens one member's popup from the list, switches to its Service tab and
// returns the present household head (undefined when the record has none).
async function readHouseholdHead(page, listFrame, rowIndex, nameColumn, memberId) {
  const framesBefore = new Set(page.frames());
  const cell = listFrame.locator(`tr[data-oracle-row="${rowIndex}"] > td`).nth(nameColumn);
  const link = cell.locator('a, [onclick]').first();
  try {
    await ((await link.count()) ? link : cell).click({ timeout: CLICK_TIMEOUT_MS });
    const tab = await findInPopup(page, framesBefore, 'service');
    if (!tab) throw new Error('The member popup has no Service tab.');
    await tab.click({ timeout: CLICK_TIMEOUT_MS });
    const record = await waitForServiceRecord(page, memberId);
    if (!record) throw new Error('The Service tab showed no Pastoral Service Record for this member.');
    return presentHouseholdHead(record.rows);
  } finally {
    await closePopup(page, memberId);
  }
}

// Run on OGD's signed-in page. Reads every page of the members list and, from
// householdStartPage on, opens each of the chapter's members for their
// household head. At the deadline it stops and reports nextHouseholdPage so
// the next run carries on from there. Stopping early still returns what was
// read, with complete: false and the reason.
//
// onProgress({ done, page }) reports the chapter's members covered so far in
// this pass: all of them on pages before householdStartPage (finished by an
// earlier run) plus each one opened since.
export function createMemberListReader({ deadline, chapterName, householdStartPage = 1, onProgress = async () => {} }) {
  const inChapter = (headers, cells) => {
    const area = cells[headers.indexOf('Area')] ?? '';
    return area.toUpperCase().startsWith(chapterName.toUpperCase());
  };

  return async function readMemberList(page) {
    let found = await openMembersList(page);
    const headers = found.table.headers;
    if (!headers.includes('Member ID #')) {
      throw new AutomationFailure('members_page_unexpected', `The members list has no "Member ID #" column (columns: ${headers.join(', ')}).`);
    }
    const idColumn = headers.indexOf('Member ID #');

    const records = [];
    const households = new Map();
    let pagesRead = 0;
    let stopReason = null;
    let timedOut = false;
    let nextHouseholdPage = null;
    let failures = 0;
    let lastError = null;
    let done = 0;
    const report = (pageNumber) => onProgress({ done, page: pageNumber }).catch(() => null);

    pages: while (pagesRead < MAX_PAGES) {
      const pageNumber = (await pagerAction(found.frame, 'read').catch(() => null))?.current ?? pagesRead + 1;
      records.push(...found.table.records);
      pagesRead += 1;

      if (pageNumber < householdStartPage) {
        done += found.table.records.filter((cells) => inChapter(headers, cells)).length;
        await report(pageNumber);
      } else {
        for (const [rowIndex, cells] of found.table.records.entries()) {
          if (!inChapter(headers, cells)) continue;
          if (Date.now() > deadline) {
            timedOut = true;
            nextHouseholdPage = pageNumber;
            break pages;
          }
          const memberId = cells[idColumn].trim();
          try {
            const head = await readHouseholdHead(page, found.frame, rowIndex, found.table.nameColumn, memberId);
            if (head) households.set(memberId, head);
            failures = 0;
          } catch (error) {
            failures += 1;
            lastError = error.message.split('\n')[0];
            if (failures >= MAX_CONSECUTIVE_FAILURES) {
              stopReason = `Could not read household heads: ${lastError}`;
              nextHouseholdPage = pageNumber;
              break pages;
            }
          }
          done += 1;
          await report(pageNumber);
          // Re-tag the rows in case the popup re-rendered the list.
          found = (await findMembersTable(page, 0)) ?? found;
        }
      }

      if (Date.now() > deadline) {
        timedOut = true;
        nextHouseholdPage = pageNumber + 1;
        break;
      }
      const previousKey = firstKey(found.table);
      const { moved } = await pagerAction(found.frame, 'next').catch(() => ({ moved: false }));
      if (!moved) break;
      const next = await waitForNextPage(page, previousKey);
      if (next.error) {
        stopReason = next.error;
        nextHouseholdPage = pageNumber + 1;
        break;
      }
      found = next.found;
    }

    if (timedOut) stopReason = 'Stopped to stay within the time limit.';
    return { headers, records, households, pagesRead, complete: !stopReason, timedOut, stopReason, nextHouseholdPage, lastHouseholdError: lastError };
  };
}
