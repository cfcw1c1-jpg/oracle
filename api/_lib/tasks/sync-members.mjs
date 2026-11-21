import { TRAINING_COLUMNS } from '../../../web/src/lib/formation.js';
import { authorize, HttpError, route } from '../access.mjs';
import { countChapterMembers, keepPendingFields } from '../ogdChanges.mjs';
import { buildPfoRow, createMemberListReader, groupTrainingColumns, planMemberSync, readFormations, readHouseholdHead } from '../ogdMembers.mjs';
import { runChapterLogin } from '../ogdRun.mjs';

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

// Signs one chapter in to OGD and runs the next stretch of its sync. Each
// request answers more: true while there is work left, and the OGD Accounts
// page keeps calling until it is false.
export const POST = route(async (request) => {
  const startedAt = Date.now();
  const body = await request.json().catch(() => null);
  if (!body) throw new HttpError(400, 'Invalid request.');

  const { db, userId, chapters } = await authorize(request, body.scope);
  const areaId = Number(body.areaId);
  const chapter = chapters.find((item) => item.areaId === areaId);
  if (!chapter) throw new HttpError(403, 'You cannot manage this chapter.');

  const { data: previous, error: previousError } = await db
    .from('ogd_member_syncs')
    .select('status, sync_part, hh_next_page, fm_next_page')
    .eq('area_id', areaId)
    .maybeSingle();
  if (previousError) throw previousError;
  // Older app versions send no part and sync member info.
  const part = body.part === 'formations' ? 'formations' : 'info';
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
});
