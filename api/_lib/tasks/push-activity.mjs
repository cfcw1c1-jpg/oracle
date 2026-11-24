import { authorize, HttpError, route } from '../access.mjs';
import { ACTIVITY_COLUMNS, toActivity } from '../activities.mjs';
import { progressWriter } from '../activityProgress.mjs';
import { createActivityPush } from '../ogdActivities.mjs';
import { recordingPathFor, runChapterLogin } from '../ogdRun.mjs';

// Creates an Oracle activity in OGD (Activities > New Activity) and saves the
// link OGD gives it.
export const POST = route(async (request) => {
  const body = await request.json().catch(() => null);
  if (!body) throw new HttpError(400, 'Invalid request.');

  const { db, userId, chapters } = await authorize(request, 'activities');
  const { data: row, error } = await db.from('activities').select(ACTIVITY_COLUMNS).eq('id', Number(body.activityId)).maybeSingle();
  if (error) throw error;
  if (!row) throw new HttpError(404, 'This activity no longer exists.');
  if (!chapters.some((chapter) => chapter.areaId === row.area_id)) throw new HttpError(403, 'You cannot manage this chapter.');
  if (row.source !== 'oracle') throw new HttpError(409, 'This activity came from OGD, so it is already there.');
  if (row.push_status === 'pushed') throw new HttpError(409, 'This activity is already in OGD.');
  if (!row.starts_at) throw new HttpError(400, 'Please set the start date first.');

  const { error: markError } = await db.from('activities').update({ push_status: 'pushing', push_failure_code: null, push_detail: null }).eq('id', row.id);
  if (markError) throw markError;
  const onProgress = progressWriter(db, row.id, 'activity');
  await onProgress({ stage: 'signing_in', label: 'Signing in to OGD', force: true });

  let run;
  try {
    run = await runChapterLogin({ db, areaId: row.area_id, userId, afterLogin: createActivityPush(row, { onProgress }), recordingPath: recordingPathFor(row.id, 'activity') });
  } catch (failure) {
    // A cooldown or setup problem: the activity goes back to not pushed.
    await db.from('activities').update({ push_status: null, ogd_progress: null }).eq('id', row.id);
    throw failure;
  }
  const result = run.afterLoginResult;
  const now = new Date().toISOString();
  const update = result
    ? {
      ogd_progress: null,
      push_status: 'pushed', push_failure_code: null, pushed_at: now, updated_at: now, ogd_url: result.ogdUrl,
      push_detail: `${result.isDirectLink ? 'Created in OGD.' : 'Created in OGD. OGD gives activities no address of their own, so the link opens the Activities page.'}${result.listed ? '' : ' It did not show in the Activities list right away.'} Filled: ${result.filled.join(', ')}.`.slice(0, 3000),
    }
    : { ogd_progress: null, push_status: 'failed', push_failure_code: run.failure_code, push_detail: run.status_detail, updated_at: now };

  let { data: saved, error: saveError } = await db.from('activities').update(result ? { ...update, ogd_key: result.ogdKey } : update).eq('id', row.id).select(ACTIVITY_COLUMNS).single();
  // The same OGD activity was already synced into Oracle: keep both rows.
  if (saveError?.code === '23505') ({ data: saved, error: saveError } = await db.from('activities').update(update).eq('id', row.id).select(ACTIVITY_COLUMNS).single());
  if (saveError) throw saveError;
  return { ok: Boolean(result), activity: toActivity(saved) };
});
