import { authorize, HttpError, route } from '../_lib/access.mjs';
import { loadOpenChanges } from '../_lib/ogdChanges.mjs';
import { pushMemberChanges } from '../_lib/ogdMemberForm.mjs';
import { createMemberListReader } from '../_lib/ogdMembers.mjs';
import { runChapterLogin } from '../_lib/ogdRun.mjs';

// Work stops by this point so saving the results still fits inside the
// function's maxDuration (vercel.json), after the login and OTP wait.
const WORK_BUDGET_MS = 230 * 1000;

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

// Signs one chapter in to OGD and writes its queued Oracle changes into each
// member's details there. Answers more: true when time ran out with changes
// left, and the OGD Accounts page calls again.
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

  const byMember = new Map();
  for (const change of open) byMember.set(change.memberId, [...(byMember.get(change.memberId) ?? []), { id: change.id, field: change.field, new_value: change.newValue }]);
  const outcomes = [];

  const reader = createMemberListReader({
    deadline: startedAt + WORK_BUDGET_MS,
    chapterName: chapter.chapter,
    shouldStop: () => byMember.size === 0,
    perMember: async (page, member) => {
      const changes = byMember.get(member.memberId);
      if (!changes) return undefined;
      byMember.delete(member.memberId);
      outcomes.push(...(await pushMemberChanges(page, member, changes)));
      return true;
    },
  });
  const run = await runChapterLogin({ db, areaId, userId, afterLogin: reader });
  const list = run.afterLoginResult;

  if (!list) {
    return { status: 'failed', more: false, pushed: 0, failed: 0, remaining: open.length, failureCode: run.failure_code, statusDetail: run.status_detail };
  }

  // Members the whole list was walked for without finding them.
  if (list.complete) {
    for (const changes of byMember.values()) {
      for (const change of changes) outcomes.push({ id: change.id, status: 'failed', detail: 'This member was not found in OGD\'s Members Database for this chapter.' });
    }
    byMember.clear();
  }

  const now = new Date().toISOString();
  for (const outcome of outcomes) {
    const { error } = await db
      .from('ogd_pending_changes')
      .update({ status: outcome.status, detail: outcome.detail, attempted_at: now, ...(outcome.status === 'pushed' ? { pushed_at: now } : {}) })
      .eq('id', outcome.id);
    if (error) throw error;
  }

  const pushed = outcomes.filter((outcome) => outcome.status === 'pushed').length;
  const failed = outcomes.length - pushed;
  const remaining = [...byMember.values()].reduce((total, changes) => total + changes.length, 0);
  const more = list.timedOut && remaining > 0;
  const parts = [`Pushed ${plural(pushed, 'change')} to OGD.`];
  if (failed) parts.push(`${plural(failed, 'change')} could not be pushed; see each one for why.`);
  if (more) parts.push(`${plural(remaining, 'change')} left; continuing.`);
  else if (!list.complete && list.stopReason) parts.push(`Stopped early: ${list.stopReason}`);

  return { status: failed ? 'partial' : 'pushed', more, pushed, failed, remaining, statusDetail: parts.join(' ') };
});
