import { authorize, HttpError, route } from '../_lib/access.mjs';
import { runChapterLogin } from '../_lib/ogdRun.mjs';
import { createPastoralReportCheck, currentReportMonth } from '../_lib/pastoralReport.mjs';

// Checks one chapter per request. Each needs its own login and possibly an
// OTP, so the whole set would not fit inside a single function's time limit.
export const POST = route(async (request) => {
  const body = await request.json().catch(() => null);
  if (!body) throw new HttpError(400, 'Invalid request.');

  const { db, userId, chapters } = await authorize(request, 'reports');
  const areaId = Number(body.areaId);
  if (!chapters.some((chapter) => chapter.areaId === areaId)) throw new HttpError(403, 'You cannot manage this chapter.');

  const target = currentReportMonth();
  const run = await runChapterLogin({ db, areaId, userId, afterLogin: createPastoralReportCheck(target.label) });
  const report = run.afterLoginResult;

  const { error } = await db.from('ogd_monthly_reports').upsert(
    {
      area_id: areaId,
      report_month: target.reportMonth,
      status: report ? (report.generated ? 'generated' : 'not_generated') : 'failed',
      latest_month_year: report?.latestMonthYear ?? null,
      failure_code: report ? null : run.failure_code,
      status_detail: report ? null : run.status_detail,
      checked_at: new Date().toISOString(),
      checked_by: userId,
    },
    { onConflict: 'area_id,report_month' },
  );
  if (error) throw error;

  return { ok: true };
});
