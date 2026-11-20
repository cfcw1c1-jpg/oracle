import { authorize, HttpError, route } from '../access.mjs';
import { CELEBRANT_KINDS, createCelebrantsReport } from '../celebrantsReport.mjs';
import { runChapterLogin } from '../ogdRun.mjs';

// Generates one chapter's Birthday and Wedding Anniversary celebrants for the
// chosen month in a single OGD sign-in, and saves both lists.
export const POST = route(async (request) => {
  const body = await request.json().catch(() => null);
  if (!body) throw new HttpError(400, 'Invalid request.');

  const { db, userId, chapters } = await authorize(request, 'celebrants');
  const areaId = Number(body.areaId);
  if (!chapters.some((chapter) => chapter.areaId === areaId)) throw new HttpError(403, 'You cannot manage this chapter.');
  const month = Number(body.month);
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new HttpError(400, 'Please choose a month.');

  const kinds = Object.keys(CELEBRANT_KINDS);
  const run = await runChapterLogin({ db, areaId, userId, afterLogin: createCelebrantsReport(month, kinds) });
  const results = run.afterLoginResult;
  const generatedAt = new Date().toISOString();

  const rows = kinds.map((kind) => {
    const result = results?.[kind];
    const base = { area_id: areaId, celebration_month: month, kind, generated_at: generatedAt, generated_by: userId };
    if (result?.ok) return { ...base, status: 'generated', headers: result.headers, records: result.records, failure_code: null, status_detail: null };
    return {
      ...base,
      status: 'failed',
      failure_code: result ? result.failureCode : run.failure_code,
      status_detail: result ? result.statusDetail : run.status_detail,
    };
  });

  // Saved one at a time so a failed row, which leaves out headers and
  // records, keeps the list from the last successful run.
  for (const row of rows) {
    const { error } = await db.from('ogd_celebrant_reports').upsert(row, { onConflict: 'area_id,celebration_month,kind' });
    if (error) throw error;
  }

  return { ok: true };
});
