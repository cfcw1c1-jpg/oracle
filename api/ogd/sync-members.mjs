import { authorize, HttpError, route } from '../_lib/access.mjs';
import { createMemberListReader, planMemberSync } from '../_lib/ogdMembers.mjs';
import { runChapterLogin } from '../_lib/ogdRun.mjs';

// Reading stops by this point so the save and status update still fit inside
// the function's maxDuration (vercel.json), after the login and OTP wait.
const READ_BUDGET_MS = 230 * 1000;
const UPSERT_CHUNK = 100;
const PROGRESS_EVERY_MS = 3000;

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function describe({ saved, households, pagesRead, skipped, stopReason, more, nextPage }) {
  const parts = [`Saved ${plural(saved, 'member')} from ${plural(pagesRead, 'page')}, ${plural(households, 'household head')}.`];
  if (skipped.outside) parts.push(`${skipped.outside} outside this chapter were left alone.`);
  if (skipped.unknownStatus.length) parts.push(`Skipped members with an unrecognized status: ${skipped.unknownStatus.join(', ')}.`);
  if (skipped.missingId) parts.push(`${skipped.missingId} rows had no Member ID.`);
  if (more) parts.push(`Household heads continue from page ${nextPage}.`);
  else if (stopReason) parts.push(`Not every page was read: ${stopReason}`);
  return parts.join(' ').slice(0, 500);
}

// Upserts in groups by column set. A batch whose rows have different keys
// would fill the missing NameOfHouseholdHead with null and wipe it.
async function saveMembers(db, members) {
  const withHead = members.filter((member) => member.NameOfHouseholdHead);
  const withoutHead = members.filter((member) => !member.NameOfHouseholdHead);
  for (const group of [withHead, withoutHead]) {
    for (let index = 0; index < group.length; index += UPSERT_CHUNK) {
      const { error } = await db.from('members').upsert(group.slice(index, index + UPSERT_CHUNK), { onConflict: 'MemberIDNo' });
      if (error) throw error;
    }
  }
  return withHead.length;
}

// The bar's total is how many of the chapter's members Oracle already has;
// OGD's list doesn't say how many it holds until the last page.
async function estimateMemberCount(db, chapterName) {
  const pattern = `${chapterName.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  const { count, error } = await db.from('members').select('MemberIDNo', { count: 'exact', head: true }).ilike('AreaName', pattern);
  if (error) throw error;
  return count ?? 0;
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

// Signs one chapter in to OGD and copies its Members Database list into the
// members table, keyed by Member ID, plus each member's present household
// head from their Service tab. Household heads need a popup per member, so a
// chapter takes several runs: each run resumes at hh_next_page and answers
// more: true until the last page is done.
export const POST = route(async (request) => {
  const startedAt = Date.now();
  const body = await request.json().catch(() => null);
  if (!body) throw new HttpError(400, 'Invalid request.');

  const { db, userId, chapters } = await authorize(request, body.scope);
  const areaId = Number(body.areaId);
  const chapter = chapters.find((item) => item.areaId === areaId);
  if (!chapter) throw new HttpError(403, 'You cannot manage this chapter.');

  const { data: previous, error: previousError } = await db.from('ogd_member_syncs').select('status, hh_next_page').eq('area_id', areaId).maybeSingle();
  if (previousError) throw previousError;
  const householdStartPage = previous?.hh_next_page ?? 1;

  const total = await estimateMemberCount(db, chapter.chapter);
  const writeProgress = createProgressWriter(db, areaId, previous?.status);
  await writeProgress({ progress_stage: 'signing_in', progress_done: 0, progress_total: total, progress_page: null }, { force: true });

  const reader = createMemberListReader({
    deadline: startedAt + READ_BUDGET_MS,
    chapterName: chapter.chapter,
    householdStartPage,
    onProgress: ({ done, page }) => writeProgress({ progress_stage: 'reading', progress_done: done, progress_total: Math.max(total, done), progress_page: page }),
  });
  const run = await runChapterLogin({ db, areaId, userId, afterLogin: reader });
  const list = run.afterLoginResult;
  if (list) await writeProgress({ progress_stage: 'saving' }, { force: true });

  let record;
  let more = false;
  if (!list) {
    // Keeps hh_next_page so the next attempt still resumes where it was.
    record = { status: 'failed', members_saved: 0, households_saved: 0, pages_read: 0, failure_code: run.failure_code, status_detail: run.status_detail };
  } else {
    const { members, skipped } = planMemberSync(list, chapter.chapter);
    const households = await saveMembers(db, members);
    more = list.timedOut;
    const nextPage = list.complete ? 1 : (list.nextHouseholdPage ?? householdStartPage);
    record = {
      status: list.complete ? 'synced' : 'partial',
      members_saved: members.length,
      households_saved: households,
      pages_read: list.pagesRead,
      hh_next_page: nextPage,
      failure_code: null,
      status_detail: describe({ saved: members.length, households, pagesRead: list.pagesRead, skipped, stopReason: list.stopReason, more, nextPage }),
    };
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
    membersSaved: record.members_saved,
    householdsSaved: record.households_saved,
    nextPage: record.hh_next_page ?? householdStartPage,
    failureCode: record.failure_code,
    statusDetail: record.status_detail,
  };
});
