import { authorize, HttpError, route } from '../access.mjs';
import { ACTIVITY_COLUMNS, isInOgd, membersById, pendingForOgd, toActivity } from '../activities.mjs';
import { progressWriter } from '../activityProgress.mjs';
import { createAttendeePush } from '../ogdActivities.mjs';
import { runChapterLogin } from '../ogdRun.mjs';

// Adds an activity's Oracle attendees (added by hand or by the attendance
// link) to its attendees in OGD, then marks each one added or failed.
// The adding stops here so the results are saved inside the 300 second limit.
const WORK_BUDGET_MS = 235 * 1000;
const MAX_PER_RUN = 40;
const RUN_LOCK_MS = 6 * 60 * 1000;

export const POST = route(async (request) => {
  const startedAt = Date.now();
  const body = await request.json().catch(() => null);
  if (!body) throw new HttpError(400, 'Invalid request.');

  const { db, userId, chapters } = await authorize(request, 'activities');
  const { data: row, error } = await db.from('activities').select(ACTIVITY_COLUMNS).eq('id', Number(body.activityId)).maybeSingle();
  if (error) throw error;
  if (!row) throw new HttpError(404, 'This activity no longer exists.');
  if (!chapters.some((chapter) => chapter.areaId === row.area_id)) throw new HttpError(403, 'You cannot manage this chapter.');
  if (!isInOgd(row)) throw new HttpError(409, 'Push this activity to OGD first; its attendees go with it after.');

  // One run at a time per activity, so two clicks never add the same member twice.
  if (row.attendee_push_status === 'pushing' && Date.now() - new Date(row.updated_at).getTime() < RUN_LOCK_MS) {
    throw new HttpError(409, 'Attendees are already being added in OGD for this activity. Please wait for it to finish.');
  }
  const pending = pendingForOgd(row.attendees).slice(0, MAX_PER_RUN);
  if (!pending.length) return { ok: true, added: 0, activity: toActivity(row) };
  const byId = await membersById(db, pending.map((attendee) => attendee.memberId));
  const members = pending.map((attendee) => byId.get(attendee.memberId.toUpperCase()) ?? { MemberIDNo: attendee.memberId, Lastname: attendee.name.split(',')[0], Firstname: attendee.name.split(',')[1] ?? '' });

  const { error: markError } = await db.from('activities').update({ attendee_push_status: 'pushing', attendee_push_failure_code: null, attendee_push_detail: null, updated_at: new Date().toISOString() }).eq('id', row.id);
  if (markError) throw markError;
  const onProgress = progressWriter(db, row.id, 'attendees');
  await onProgress({ stage: 'signing_in', label: 'Signing in to OGD', done: 0, total: members.length, force: true });

  let run;
  try {
    run = await runChapterLogin({ db, areaId: row.area_id, userId, afterLogin: createAttendeePush(row, members, { deadline: startedAt + WORK_BUDGET_MS, onProgress }) });
  } catch (failure) {
    await db.from('activities').update({ attendee_push_status: null, ogd_progress: null }).eq('id', row.id);
    throw failure;
  }
  const result = run.afterLoginResult;
  const now = new Date().toISOString();

  // Attendees may have changed while OGD was open, so mark the latest list.
  const { data: latest, error: latestError } = await db.from('activities').select('attendees').eq('id', row.id).single();
  if (latestError) throw latestError;
  const added = new Set(result?.added ?? []);
  const already = new Set(result?.already ?? []);
  const skipped = new Set(result?.skipped ?? []);
  const failed = new Map((result?.failed ?? []).map((entry) => [entry.memberId, entry.reason]));
  const tried = new Set(members.map((member) => String(member.MemberIDNo).toUpperCase()));
  const attendees = (latest.attendees ?? []).map((attendee) => {
    const id = attendee.memberId?.toUpperCase();
    if (!id || attendee.source === 'ogd' || !tried.has(id)) return attendee;
    if (already.has(id)) return { ...attendee, ogd: 'added', ogdAt: now, ogdNote: 'Already in OGD; not added again.' };
    if (added.has(id)) return { ...attendee, ogd: 'added', ogdAt: now, ogdNote: null };
    if (skipped.has(id)) return { ...attendee, ogd: 'skipped', ogdAt: now, ogdNote: 'Not found in OGD; skipped.' };
    if (failed.get(id) === 'not reached') return attendee;
    return { ...attendee, ogd: 'failed', ogdNote: result ? failed.get(id) ?? null : run.failure_code };
  });
  const stillPending = pendingForOgd(attendees).filter((attendee) => attendee.ogd !== 'failed').length;
  let status = 'failed';
  if (result) status = result.failed.length || stillPending ? (added.size ? 'partial' : 'failed') : 'pushed';

  const { data: saved, error: saveError } = await db.from('activities').update({
    attendees,
    ogd_progress: null,
    attendee_push_status: status,
    attendee_push_failure_code: result ? (status === 'pushed' ? null : 'activity_attendees_unexpected') : run.failure_code,
    attendee_push_detail: (result ? result.detail : run.status_detail)?.slice(0, 3000) ?? null,
    attendees_pushed_at: added.size ? now : row.attendees_pushed_at,
    updated_at: now,
  }).eq('id', row.id).select(ACTIVITY_COLUMNS).single();
  if (saveError) throw saveError;
  return { ok: Boolean(result) && status === 'pushed', added: added.size, activity: toActivity(saved) };
});
