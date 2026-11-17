import { authorize, HttpError, route } from '../access.mjs';
import { countChapterMembers, createPushProgress, loadOpenChanges } from '../ogdChanges.mjs';
import { pushMemberChanges } from '../ogdMemberForm.mjs';
import { TRAINING_COLUMNS } from '../../../web/src/lib/formation.js';
import { createMemberListReader, findMembersTable, groupTrainingColumns, pushFormationChanges } from '../ogdMembers.mjs';
import { runChapterLogin } from '../ogdRun.mjs';

// Work stops by this point so saving the results still fits inside the
// function's maxDuration (vercel.json), after the login and OTP wait.
const WORK_BUDGET_MS = 230 * 1000;

const COLUMNS_BY_CODE = groupTrainingColumns(TRAINING_COLUMNS.map((column) => column.id));
// Training columns are "CODE_N-Title"; member detail fields never look like that.
const isFormationField = (field) => /^.+?_\d+-/.test(field);

// After a save the members list can re-render, so the member's row is found
// again before the next popup is opened.
async function refindMember(page, member) {
  const found = await findMembersTable(page, 0).catch(() => null);
  if (!found) return member;
  const idColumn = found.table.headers.indexOf('Member ID #');
  const rowIndex = found.table.records.findIndex((cells) => (cells[idColumn] ?? '').trim() === member.memberId);
  return rowIndex === -1 ? member : { ...member, listFrame: found.frame, rowIndex, nameColumn: found.table.nameColumn };
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

// Signs one chapter in to OGD and writes its queued Oracle changes into each
// member's details there. Answers more: true when time ran out with changes
// left, with nextPage for the OGD Accounts page to send back as fromPage, so
// the next run pages past what this one already walked without stopping.
// While it works it writes its progress to ogd_push_progress.
export const POST = route(async (request) => {
  const startedAt = Date.now();
  const body = await request.json().catch(() => null);
  if (!body) throw new HttpError(400, 'Invalid request.');

  const { db, userId, chapters } = await authorize(request, body.scope);
  const areaId = Number(body.areaId);
  const chapter = chapters.find((item) => item.areaId === areaId);
  if (!chapter) throw new HttpError(403, 'You cannot manage this chapter.');

  const open = await loadOpenChanges(db, [chapter]);
  if (!open.length) return { status: 'idle', more: false, pushed: 0, failed: 0, remaining: 0, statusDetail: 'Nothing is waiting to be pushed.' };

  // Pages before fromPage were walked by earlier runs of this push.
  const fromPage = Number(body.fromPage);
  const startPage = Number.isInteger(fromPage) && fromPage > 1 ? fromPage : 1;

  const byMember = new Map();
  for (const change of open) byMember.set(change.memberId, [...(byMember.get(change.memberId) ?? []), { id: change.id, field: change.field, new_value: change.newValue }]);
  const outcomes = [];
  const membersTotal = byMember.size;
  let membersDone = 0;
  const listTotal = await countChapterMembers(db, chapter.chapter).catch(() => 0);
  const progress = createPushProgress(db, areaId);
  await progress.write({ stage: 'signing_in', members_total: membersTotal, members_done: 0, list_total: listTotal, list_done: 0, page: null }, { force: true });

  const reader = createMemberListReader({
    deadline: startedAt + WORK_BUDGET_MS,
    chapterName: chapter.chapter,
    startPage,
    shouldStop: () => byMember.size === 0,
    onProgress: ({ done, page, skipping }) => progress.write({ stage: skipping ? 'skipping' : 'pushing', members_done: membersDone, list_total: Math.max(listTotal, done), list_done: done, page }),
    perMember: async (page, member) => {
      const changes = byMember.get(member.memberId);
      if (!changes) return undefined;
      byMember.delete(member.memberId);
      const detailChanges = changes.filter((change) => !isFormationField(change.field));
      const formationChanges = changes.filter((change) => isFormationField(change.field));
      let current = member;
      if (detailChanges.length) {
        outcomes.push(...(await pushMemberChanges(page, current, detailChanges)));
        if (formationChanges.length) current = await refindMember(page, current);
      }
      if (formationChanges.length) outcomes.push(...(await pushFormationChanges(page, current, formationChanges, COLUMNS_BY_CODE)));
      membersDone += 1;
      await progress.write({ stage: 'pushing', members_done: membersDone }, { force: true });
      return true;
    },
  });
  let run;
  try {
    run = await runChapterLogin({ db, areaId, userId, afterLogin: reader });
  } catch (error) {
    await progress.clear();
    throw error;
  }
  const list = run.afterLoginResult;

  if (!list) {
    await progress.clear();
    return { status: 'failed', more: false, pushed: 0, failed: 0, remaining: open.length, failureCode: run.failure_code, statusDetail: run.status_detail };
  }

  // Members the whole list was walked for without finding them.
  if (list.complete) {
    for (const changes of byMember.values()) {
      for (const change of changes) outcomes.push({ id: change.id, status: 'failed', detail: 'This member was not found in OGD\'s Members Database for this chapter.' });
    }
    byMember.clear();
  }

  await progress.write({ stage: 'saving', members_done: membersDone }, { force: true });
  const now = new Date().toISOString();
  for (const outcome of outcomes) {
    const { error } = await db
      .from('ogd_pending_changes')
      .update({ status: outcome.status, detail: outcome.detail, attempted_at: now, ...(outcome.status === 'pushed' ? { pushed_at: now } : {}) })
      .eq('id', outcome.id);
    if (error) {
      await progress.clear();
      throw error;
    }
  }
  await progress.clear();

  const pushed = outcomes.filter((outcome) => outcome.status === 'pushed').length;
  const failed = outcomes.length - pushed;
  const remaining = [...byMember.values()].reduce((total, changes) => total + changes.length, 0);
  const more = list.timedOut && remaining > 0;
  const parts = [`Pushed ${plural(pushed, 'change')} to OGD.`];
  if (failed) parts.push(`${plural(failed, 'change')} could not be pushed; see each one for why.`);
  if (more) parts.push(`${plural(remaining, 'change')} left; continuing.`);
  else if (!list.complete && list.stopReason) parts.push(`Stopped early: ${list.stopReason}`);

  return { status: failed ? 'partial' : 'pushed', more, nextPage: more ? list.nextPage : null, pushed, failed, remaining, statusDetail: parts.join(' ') };
});
