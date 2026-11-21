import { TRAINING_COLUMNS } from '../../../web/src/lib/formation.js';
import { waitUntil } from '@vercel/functions';
import { authorize, createAdminClient, HttpError, route } from '../access.mjs';
import { countChapterMembers, keepPendingFields } from '../ogdChanges.mjs';
import { buildPfoRow, createMemberListReader, groupTrainingColumns, planMemberSync, readFormations, readHouseholdHead } from '../ogdMembers.mjs';
import { STALLED_AFTER_MS } from '../backgroundSync.mjs';
import { runChapterLogin } from '../ogdRun.mjs';
import { signToken, verifyToken } from '../secrets.mjs';

// Reading stops by this point so the save and status update still fit inside
// the function's maxDuration (vercel.json), after the login and OTP wait.
const READ_BUDGET_MS = 230 * 1000;
const UPSERT_CHUNK = 100;
const PROGRESS_EVERY_MS = 3000;
const COLUMNS_BY_CODE = groupTrainingColumns(TRAINING_COLUMNS.map((column) => column.id));

// A chapter has two syncs, each started on its own from the OGD Accounts page
// and each running over as many runs as it needs:
//   info        Members Database list plus each member's present household
//               head (Service tab); resumes at hh_next_page
//   formations  each member's formation talks (Formation tab) into
//               pfo_members; resumes at fm_next_page
// One finishing does not start the other. sync_part records which ran last.
const PARTS = { info: { label: 'Members' }, formations: { label: 'Formations' } };

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function describe({ part, saved, households, formations, pagesRead, skipped, issues, stopReason, more, nextPage }) {
  const parts = [`${PARTS[part].label} sync:`];
  if (part === 'info') parts.push(`saved ${plural(saved, 'member')} from ${plural(pagesRead, 'page')}, ${plural(households, 'household head')}.`);
  else parts.push(`saved formations for ${plural(formations, 'member')} from ${plural(pagesRead, 'page')}.`);
  if (skipped.outside) parts.push(`${skipped.outside} outside this chapter were left alone.`);
  if (skipped.unknownStatus.length) parts.push(`Skipped members with an unrecognized status: ${skipped.unknownStatus.join(', ')}.`);
  if (skipped.missingId) parts.push(`${skipped.missingId} rows had no Member ID.`);
  if (issues.length) parts.push(`Left unchanged: ${issues.slice(0, 3).join('; ')}${issues.length > 3 ? `; and ${issues.length - 3} more` : ''}.`);
  if (more) parts.push(`Continues from page ${nextPage}.`);
  else if (stopReason) parts.push(`Not every page was read: ${stopReason}`);
  return parts.join(' ').slice(0, 1000);
}

// Upserts in groups of rows that share the same columns. A batch whose rows
// have different keys would fill the missing ones with null and wipe them.
async function upsertGrouped(db, table, rows) {
  const groups = new Map();
  for (const row of rows) {
    const signature = Object.keys(row).sort().join('\u0000');
    groups.set(signature, [...(groups.get(signature) ?? []), row]);
  }
  for (const group of groups.values()) {
    for (let index = 0; index < group.length; index += UPSERT_CHUNK) {
      const { error } = await db.from(table).upsert(group.slice(index, index + UPSERT_CHUNK), { onConflict: 'MemberIDNo' });
      if (error) throw error;
    }
  }
}

// Writes the running sync's progress for the OGD Accounts page to poll. The
// row's last result stays as it is until the run finishes.
function createProgressWriter(db, areaId, previousStatus) {
  let lastWrite = 0;
  return async (fields, { force = false } = {}) => {
    if (!force && Date.now() - lastWrite < PROGRESS_EVERY_MS) return;
    lastWrite = Date.now();
    const { error } = await db
      .from('ogd_member_syncs')
      .upsert({ area_id: areaId, status: previousStatus ?? 'partial', ...fields, progress_at: new Date().toISOString() }, { onConflict: 'area_id' });
    if (error) console.error('[ogd] progress write failed:', error.message);
  };
}

// Signs one chapter in to OGD and runs the next stretch of one sync. Resolves
// to { status, more, ... }; more is true while there is work left.
async function syncStretch({ db, areaId, chapter, userId, part, startedAt }) {
  const { data: previous, error: previousError } = await db
    .from('ogd_member_syncs')
    .select('status, sync_part, hh_next_page, fm_next_page')
    .eq('area_id', areaId)
    .maybeSingle();
  if (previousError) throw previousError;
  const startPage = (part === 'info' ? previous?.hh_next_page : previous?.fm_next_page) ?? 1;

  const total = await countChapterMembers(db, chapter.chapter);
  const writeProgress = createProgressWriter(db, areaId, previous?.status);
  await writeProgress({ progress_part: part, progress_stage: 'signing_in', progress_done: 0, progress_total: total, progress_page: null }, { force: true });

  const reader = createMemberListReader({
    deadline: startedAt + READ_BUDGET_MS,
    chapterName: chapter.chapter,
    startPage,
    perMember: part === 'info' ? readHouseholdHead : readFormations,
    onProgress: ({ done, page, skipping }) => writeProgress({ progress_stage: skipping ? 'skipping' : 'reading', progress_done: done, progress_total: Math.max(total, done), progress_page: page }),
  });
  const run = await runChapterLogin({ db, areaId, userId, afterLogin: reader });
  const list = run.afterLoginResult;
  if (list) await writeProgress({ progress_stage: 'saving' }, { force: true });

  let record;
  let more = false;
  if (!list) {
    // Keeps the part and its page so the next attempt resumes where it was.
    record = { status: 'failed', sync_part: part, failure_code: run.failure_code, status_detail: run.status_detail };
  } else {
    const nextPage = list.complete ? 1 : (list.nextPage ?? startPage);
    more = list.timedOut;
    const shared = { pages_read: list.pagesRead, failure_code: null };

    if (part === 'info') {
      const { members, skipped } = planMemberSync({ ...list, households: list.results }, chapter.chapter);
      // Fields with an Oracle change still waiting for OGD keep Oracle's value.
      await upsertGrouped(db, 'members', await keepPendingFields(db, members));
      const households = members.filter((member) => member.NameOfHouseholdHead).length;
      record = {
        ...shared,
        status: list.complete ? 'synced' : 'partial',
        sync_part: 'info',
        hh_next_page: nextPage,
        members_saved: members.length,
        households_saved: households,
        status_detail: describe({ part, saved: members.length, households, pagesRead: list.pagesRead, skipped, issues: [], stopReason: list.stopReason, more, nextPage }),
      };
    } else {
      // The list is read again on the way, so member info is refreshed too.
      const { members, skipped } = planMemberSync(list, chapter.chapter);
      await upsertGrouped(db, 'members', await keepPendingFields(db, members));
      const issues = [];
      const pfoRows = members
        .filter((member) => list.results.has(member.MemberIDNo))
        .map((member) => {
          const { formations, issues: readIssues } = list.results.get(member.MemberIDNo);
          const built = buildPfoRow(member.MemberIDNo, formations, COLUMNS_BY_CODE);
          issues.push(...[...readIssues, ...built.issues].map((issue) => `${member.MemberIDNo} ${issue}`));
          return built.row;
        });
      // Talks still waiting to be pushed keep Oracle's tick.
      await upsertGrouped(db, 'pfo_members', await keepPendingFields(db, pfoRows));
      record = {
        ...shared,
        status: list.complete ? 'synced' : 'partial',
        sync_part: 'formations',
        fm_next_page: nextPage,
        formations_saved: pfoRows.length,
        status_detail: describe({ part, formations: pfoRows.length, pagesRead: list.pagesRead, skipped, issues, stopReason: list.stopReason, more, nextPage }),
      };
    }
  }

  const { error } = await db
    .from('ogd_member_syncs')
    .upsert(
      { area_id: areaId, ...record, progress_stage: null, progress_at: new Date().toISOString(), synced_at: new Date().toISOString(), synced_by: userId },
      { onConflict: 'area_id' },
    );
  if (error) throw error;

  return {
    status: record.status,
    more,
    part,
    nextPage: (part === 'info' ? record.hh_next_page : record.fm_next_page) ?? startPage,
    failureCode: record.failure_code,
    statusDetail: record.status_detail,
  };
}

// ---------- Background runs ----------
// Sync Members and Sync Formations run on the server: the request that starts
// one answers at once and keeps working (waitUntil), and each stretch starts
// the next with a signed request to this same endpoint until the sync is
// done, fails for good, or is stopped. The page only reads the progress.

// Failures worth another go, a few times in a row, after OGD's login spacing.
const RETRYABLE_FAILURES = new Set(['unexpected_page', 'automation_error', 'members_page_unexpected', 'otp_not_found', 'cooldown']);
const MAX_RETRIES = 3;
const RETRY_SPACING_MS = 65 * 1000;
const MAX_RUNS = 80;
const TOKEN_TTL_MS = 10 * 60 * 1000;
const CHAIN_ATTEMPTS = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Production calls go to the production domain, which deployment protection
// does not cover; elsewhere the address the request came in on is used.
function selfUrl(request) {
  const host = process.env.VERCEL_ENV === 'production' && process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return new URL('/api/ogd/browser?task=sync-members', host ? `https://${host}` : request.url).href;
}

async function readBackground(db, areaId) {
  const { data, error } = await db
    .from('ogd_member_syncs')
    .select('bg_state, bg_part, bg_run, bg_retries, progress_at')
    .eq('area_id', areaId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function updateBackground(db, areaId, columns) {
  const { error } = await db.from('ogd_member_syncs').update(columns).eq('area_id', areaId);
  if (error) console.error('[ogd] background state write failed:', error.message);
}

async function finishBackground(db, areaId, note) {
  const columns = { bg_state: null, progress_stage: null, progress_at: new Date().toISOString() };
  if (note) {
    const { data } = await db.from('ogd_member_syncs').select('status_detail').eq('area_id', areaId).maybeSingle();
    columns.status_detail = `${data?.status_detail ? `${data.status_detail} ` : ''}${note}`.slice(0, 1000);
  }
  await updateBackground(db, areaId, columns);
}

// Starts the next stretch. Only the hand-off is awaited: the next run
// answers 202 straight away and does its work in its own function.
async function startNextRun(url, payload) {
  const token = signToken(payload, TOKEN_TTL_MS);
  for (let attempt = 1; attempt <= CHAIN_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ internal: token }),
        signal: AbortSignal.timeout(20000),
      });
      if (response.status === 202) return true;
      console.error('[ogd] next background run answered', response.status);
    } catch (error) {
      console.error('[ogd] could not start the next background run:', error?.message);
    }
    await sleep(2000 * attempt);
  }
  return false;
}

// One stretch of a background sync, then the decision about the next one.
async function runBackgroundStretch({ db, areaId, chapter, userId, part, run, retries, url }) {
  const startedAt = Date.now();
  let outcome;
  try {
    outcome = await syncStretch({ db, areaId, chapter, userId, part, startedAt });
  } catch (error) {
    const isCooldown = error instanceof HttpError && error.status === 429;
    if (!isCooldown) console.error('[ogd] background stretch failed:', error?.message);
    outcome = { status: 'failed', more: false, failureCode: isCooldown ? 'cooldown' : 'automation_error' };
  }

  const background = await readBackground(db, areaId).catch(() => null);
  if (background?.bg_state !== 'running' || background.bg_part !== part) {
    await finishBackground(db, areaId, background?.bg_state === 'stopping' ? 'Stopped.' : null);
    return;
  }

  let nextRetries = 0;
  if (!outcome.more) {
    const canRetry = outcome.status === 'failed' && RETRYABLE_FAILURES.has(outcome.failureCode) && retries < MAX_RETRIES;
    if (!canRetry) {
      await finishBackground(db, areaId, outcome.status === 'failed' && retries >= MAX_RETRIES ? `Gave up after ${MAX_RETRIES} retries.` : null);
      return;
    }
    nextRetries = retries + 1;
    // Keeps logins a minute apart, counted from when this stretch started.
    await updateBackground(db, areaId, { bg_retries: nextRetries, progress_part: part, progress_stage: 'retry_wait', progress_at: new Date().toISOString() });
    const wait = startedAt + RETRY_SPACING_MS - Date.now();
    if (wait > 0) await sleep(wait);
  }
  if (run >= MAX_RUNS) {
    await finishBackground(db, areaId, `Stopped after ${MAX_RUNS} runs; start it again to continue.`);
    return;
  }

  await updateBackground(db, areaId, { bg_run: run + 1, bg_retries: nextRetries, progress_part: part, progress_stage: 'queued', progress_at: new Date().toISOString() });
  const started = await startNextRun(url, { areaId, part, userId, run: run + 1, retries: nextRetries });
  if (!started) await finishBackground(db, areaId, 'Could not continue in the background; start it again to resume.');
}

async function chapterFor(db, areaId) {
  const { data, error } = await db.from('areas').select('id, name, type').eq('id', areaId).maybeSingle();
  if (error) throw error;
  if (!data || data.type !== 'Chapter') throw new HttpError(404, 'Unknown chapter.');
  return { areaId: data.id, chapter: data.name };
}

function inBackground(promise) {
  const kept = promise.catch((error) => console.error('[ogd] background run crashed:', error?.message));
  // Outside Vercel (local development) the promise simply runs on.
  waitUntil(kept);
}

// A stretch started by the previous one. Answers 202 at once.
async function continueInBackground(request, body) {
  const payload = verifyToken(body.internal);
  if (!payload) return Response.json({ error: 'Invalid request.' }, { status: 403 });
  const db = createAdminClient();
  const background = await readBackground(db, payload.areaId);
  if (background?.bg_state !== 'running' || background.bg_part !== payload.part || background.bg_run !== payload.run) {
    if (background?.bg_state === 'stopping') await finishBackground(db, payload.areaId, 'Stopped.');
    return Response.json({ skipped: true }, { status: 202 });
  }
  const chapter = await chapterFor(db, payload.areaId);
  inBackground(runBackgroundStretch({ db, areaId: payload.areaId, chapter: chapter.chapter, userId: payload.userId, part: payload.part, run: payload.run, retries: payload.retries, url: selfUrl(request) }));
  return Response.json({ started: true }, { status: 202 });
}

const handleUserRequest = route(async (request, body) => {
  const { db, userId, chapters } = await authorize(request, body.scope);
  const areaId = Number(body.areaId);
  const chapter = chapters.find((item) => item.areaId === areaId);
  if (!chapter) throw new HttpError(403, 'You cannot manage this chapter.');

  const background = await readBackground(db, areaId);
  const isStalled = !background?.progress_at || Date.now() - new Date(background.progress_at).getTime() > STALLED_AFTER_MS;
  const isRunning = Boolean(background?.bg_state) && !isStalled;

  if (body.action === 'stop') {
    if (isRunning) await updateBackground(db, areaId, { bg_state: 'stopping' });
    else if (background?.bg_state) await finishBackground(db, areaId, 'Stopped.');
    return { ok: true };
  }

  if (isRunning) throw new HttpError(409, 'A sync is already running for this chapter.');
  // Older app versions send no part and sync member info.
  const part = body.part === 'formations' ? 'formations' : 'info';
  const now = new Date().toISOString();
  const columns = {
    bg_state: 'running', bg_part: part, bg_started_by: userId, bg_started_at: now,
    bg_run: 1, bg_retries: 0, progress_part: part, progress_stage: 'queued', progress_done: 0, progress_page: null, progress_at: now,
  };
  // An upsert would need status even for an existing row (Postgres checks
  // NOT NULL before it sees the conflict), so the two cases are separate.
  const { error } = background
    ? await db.from('ogd_member_syncs').update(columns).eq('area_id', areaId)
    : await db.from('ogd_member_syncs').insert({ area_id: areaId, status: 'partial', ...columns });
  if (error) throw error;

  inBackground(runBackgroundStretch({ db, areaId, chapter: chapter.chapter, userId, part, run: 1, retries: 0, url: selfUrl(request) }));
  return { started: true, part };
});

export async function POST(request) {
  const body = await request.json().catch(() => null);
  if (!body) return Response.json({ error: 'Invalid request.' }, { status: 400 });
  if (body.internal) {
    try {
      return await continueInBackground(request, body);
    } catch (error) {
      console.error('[ogd] background hand-off failed:', error?.message);
      return Response.json({ error: 'Something went wrong on the server.' }, { status: 500 });
    }
  }
  return handleUserRequest(request, body);
}
