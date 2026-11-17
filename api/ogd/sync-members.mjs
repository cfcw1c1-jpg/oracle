import { authorize, HttpError, route } from '../_lib/access.mjs';
import { createMemberListReader, planMemberSync } from '../_lib/ogdMembers.mjs';
import { runChapterLogin } from '../_lib/ogdRun.mjs';

// Reading stops by this point so the save and status update still fit inside
// the function's maxDuration (vercel.json), after the login and OTP wait.
const READ_BUDGET_MS = 230 * 1000;
const UPSERT_CHUNK = 100;

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

  const { data: previous, error: previousError } = await db.from('ogd_member_syncs').select('hh_next_page').eq('area_id', areaId).maybeSingle();
  if (previousError) throw previousError;
  const householdStartPage = previous?.hh_next_page ?? 1;

  const reader = createMemberListReader({ deadline: startedAt + READ_BUDGET_MS, chapterName: chapter.chapter, householdStartPage });
  const run = await runChapterLogin({ db, areaId, userId, afterLogin: reader });
  const list = run.afterLoginResult;

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
    .upsert({ area_id: areaId, ...record, synced_at: new Date().toISOString(), synced_by: userId }, { onConflict: 'area_id' });
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
