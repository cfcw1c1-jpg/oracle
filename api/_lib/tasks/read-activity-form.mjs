import { authorize, HttpError, route } from '../access.mjs';
import { createActivityFormReader } from '../ogdActivities.mjs';
import { runChapterLogin } from '../ogdRun.mjs';

// Reads OGD's New Activity form for one chapter (every field, and the extra
// fields each Type option brings) and saves it. Nothing is saved in OGD.
const READ_BUDGET_MS = 225 * 1000;

export const POST = route(async (request) => {
  const startedAt = Date.now();
  const body = await request.json().catch(() => null);
  if (!body) throw new HttpError(400, 'Invalid request.');

  const { db, userId, chapters } = await authorize(request, 'activities');
  const areaId = Number(body.areaId);
  if (!chapters.some((chapter) => chapter.areaId === areaId)) throw new HttpError(403, 'You cannot manage this chapter.');

  const { error: markError } = await db.from('ogd_activity_forms').upsert({ area_id: areaId, status: 'reading', failure_code: null, status_detail: null }, { onConflict: 'area_id', ignoreDuplicates: false });
  if (markError) throw markError;

  let run;
  try {
    run = await runChapterLogin({ db, areaId, userId, afterLogin: createActivityFormReader({ deadline: startedAt + READ_BUDGET_MS }) });
  } catch (failure) {
    await db.from('ogd_activity_forms').update({ status: 'failed', failure_code: 'automation_error', status_detail: String(failure?.message ?? failure).slice(0, 3000) }).eq('area_id', areaId);
    throw failure;
  }
  const schema = run.afterLoginResult;
  const now = new Date().toISOString();
  const update = schema
    ? {
      status: 'read', schema, is_partial: schema.isPartial, failure_code: null, captured_at: now, captured_by: userId,
      status_detail: [
        `Read ${schema.fields.length} fields; ${Object.keys(schema.dependents).length} choice${Object.keys(schema.dependents).length === 1 ? '' : 's'} bring extra fields.`,
        schema.isPartial ? 'Not every choice fit in one run: read it again for the rest.' : '',
        schema.notes,
      ].filter(Boolean).join(' ').slice(0, 3000),
    }
    : { status: 'failed', failure_code: run.failure_code, status_detail: run.status_detail };
  const { error } = await db.from('ogd_activity_forms').update(update).eq('area_id', areaId);
  if (error) throw error;
  return { ok: Boolean(schema) };
});
