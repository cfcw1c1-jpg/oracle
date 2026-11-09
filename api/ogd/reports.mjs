import { authorize, fetchAllRows, route } from '../_lib/access.mjs';
import { currentReportMonth } from '../_lib/pastoralReport.mjs';

export const GET = route(async (request) => {
  const { db, chapters } = await authorize(request, 'reports');
  const target = currentReportMonth();

  const [connections, reports] = await Promise.all([
    fetchAllRows(() => db.from('ogd_chapter_connections').select('area_id, gmail_updated_at, ogd_updated_at').order('area_id')),
    fetchAllRows(() =>
      db
        .from('ogd_monthly_reports')
        .select('area_id, status, latest_month_year, failure_code, status_detail, checked_at')
        .eq('report_month', target.reportMonth)
        .order('area_id'),
    ),
  ]);
  const connectionByArea = new Map(connections.map((row) => [row.area_id, row]));
  const reportByArea = new Map(reports.map((row) => [row.area_id, row]));

  return {
    month: target.label,
    chapters: chapters.map((chapter) => {
      const connection = connectionByArea.get(chapter.areaId);
      const report = reportByArea.get(chapter.areaId);
      return {
        ...chapter,
        isReady: Boolean(connection?.gmail_updated_at && connection?.ogd_updated_at),
        status: report?.status ?? null,
        latestMonthYear: report?.latest_month_year ?? null,
        failureCode: report?.failure_code ?? null,
        statusDetail: report?.status_detail ?? null,
        checkedAt: report?.checked_at ?? null,
      };
    }),
  };
});
