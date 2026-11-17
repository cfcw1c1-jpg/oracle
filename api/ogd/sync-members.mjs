import { authorize, HttpError, route } from '../_lib/access.mjs';
import { createMemberListReader, planMemberSync } from '../_lib/ogdMembers.mjs';
import { runChapterLogin } from '../_lib/ogdRun.mjs';

// Paging stops by this point so the save and status update still fit inside
// the function's maxDuration (vercel.json), after the login and OTP wait.
const READ_BUDGET_MS = 230 * 1000;
const UPSERT_CHUNK = 100;

function describe({ saved, pagesRead, skipped, stopReason }) {
  const parts = [`Saved ${saved} member${saved === 1 ? '' : 's'} from ${pagesRead} page${pagesRead === 1 ? '' : 's'}.`];
  if (skipped.outside) parts.push(`${skipped.outside} outside this chapter were left alone.`);
  if (skipped.unknownStatus.length) parts.push(`Skipped members with an unrecognized status: ${skipped.unknownStatus.join(', ')}.`);
  if (skipped.missingId) parts.push(`${skipped.missingId} rows had no Member ID.`);
  if (stopReason) parts.push(`Not every page was read: ${stopReason}`);
  return parts.join(' ').slice(0, 500);
}

// Signs one chapter in to OGD and copies its Members Database list into the
// members table, keyed by Member ID. One chapter per request, like
// check-report, since each needs its own login and possibly an OTP.
export const POST = route(async (request) => {
  const startedAt = Date.now();
  const body = await request.json().catch(() => null);
  if (!body) throw new HttpError(400, 'Invalid request.');

  const { db, userId, chapters } = await authorize(request, body.scope);
  const areaId = Number(body.areaId);
  const chapter = chapters.find((item) => item.areaId === areaId);
  if (!chapter) throw new HttpError(403, 'You cannot manage this chapter.');

  const run = await runChapterLogin({ db, areaId, userId, afterLogin: createMemberListReader({ deadline: startedAt + READ_BUDGET_MS }) });
  const list = run.afterLoginResult;

  let record;
  if (!list) {
    record = { status: 'failed', members_saved: 0, pages_read: 0, failure_code: run.failure_code, status_detail: run.status_detail };
  } else {
    const { members, skipped } = planMemberSync(list, chapter.chapter);
    for (let index = 0; index < members.length; index += UPSERT_CHUNK) {
      const { error } = await db.from('members').upsert(members.slice(index, index + UPSERT_CHUNK), { onConflict: 'MemberIDNo' });
      if (error) throw error;
    }
    record = {
      status: list.complete ? 'synced' : 'partial',
      members_saved: members.length,
      pages_read: list.pagesRead,
      failure_code: null,
      status_detail: describe({ saved: members.length, pagesRead: list.pagesRead, skipped, stopReason: list.stopReason }),
    };
  }

  const { error } = await db
    .from('ogd_member_syncs')
    .upsert({ area_id: areaId, ...record, synced_at: new Date().toISOString(), synced_by: userId }, { onConflict: 'area_id' });
  if (error) throw error;

  return { status: record.status, membersSaved: record.members_saved, failureCode: record.failure_code, statusDetail: record.status_detail };
});
