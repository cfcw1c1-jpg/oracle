import { AutomationFailure, submitAndSettle } from './ogdLogin.mjs';

const TABLE_WAIT_MS = 20000;

// Reports are monthly in the Philippines, so "this month" follows Manila time
// rather than the server's UTC clock.
export function currentReportMonth(now = new Date()) {
  const [year, month] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit' })
    .format(now)
    .split('-');
  const monthName = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', month: 'long' }).format(now);
  return { label: `${monthName.toUpperCase()} ${year}`, reportMonth: `${year}-${month}-01` };
}

function normalizeMonthYear(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

// OGD lists the newest report first.
export function evaluateReports(monthYears, targetLabel) {
  const normalized = monthYears.map(normalizeMonthYear).filter(Boolean);
  return { generated: normalized.includes(targetLabel), latestMonthYear: normalized[0] ?? null };
}

// Returns the Month Year column's values, or null when no table has that
// heading. Only direct rows and cells are read so OGD's layout tables are
// not mistaken for the report list.
function readMonthYearColumn(page) {
  return page.evaluate(() => {
    const cellText = (cell) => (cell.textContent || '').trim().replace(/\s+/g, ' ').toUpperCase();
    for (const table of [...document.querySelectorAll('table')].reverse()) {
      const rows = [...table.rows];
      const headerIndex = rows.findIndex((row) => [...row.cells].some((cell) => cellText(cell) === 'MONTH YEAR'));
      if (headerIndex === -1) continue;
      const columnIndex = [...rows[headerIndex].cells].findIndex((cell) => cellText(cell) === 'MONTH YEAR');
      return rows.slice(headerIndex + 1).map((row) => row.cells[columnIndex]?.textContent ?? '');
    }
    return null;
  });
}

// Run on OGD's signed-in page: opens Pastoral Report and checks whether the
// target month has been generated.
export function createPastoralReportCheck(targetLabel) {
  return async function checkPastoralReport(page) {
    const link = page.locator('a', { hasText: /^\s*Pastoral Report\s*$/i }).first();
    if ((await link.count()) === 0) {
      throw new AutomationFailure('report_page_unexpected', `No Pastoral Report link on ${new URL(page.url()).pathname}.`);
    }
    await submitAndSettle(page, () => link.click());
    await page
      .waitForFunction(() => document.body.innerText.toUpperCase().includes('MONTH YEAR'), null, { timeout: TABLE_WAIT_MS })
      .catch(() => null);

    const monthYears = await readMonthYearColumn(page);
    if (monthYears === null) {
      throw new AutomationFailure('report_page_unexpected', `No Month Year column on ${new URL(page.url()).pathname} titled "${await page.title()}".`);
    }
    return evaluateReports(monthYears, targetLabel);
  };
}
