import { authorize, fetchAllRows, HttpError, route } from '../_lib/access.mjs';

// The saved celebrant lists for one month, for every chapter the caller can see.
export const GET = route(async (request) => {
  const month = Number(new URL(request.url).searchParams.get('month'));
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new HttpError(400, 'Please choose a month.');
  const { db, chapters } = await authorize(request, 'celebrants');

  const [connections, reports] = await Promise.all([
    fetchAllRows(() => db.from('ogd_chapter_connections').select('area_id, gmail_updated_at, ogd_updated_at').order('area_id')),
    fetchAllRows(() =>
      db
        .from('ogd_celebrant_reports')
        .select('area_id, kind, status, headers, records, failure_code, status_detail, generated_at')
        .eq('celebration_month', month)
        .order('area_id'),
    ),
  ]);
  const connectionByArea = new Map(connections.map((row) => [row.area_id, row]));
  const reportsByArea = new Map();
  for (const row of reports) {
    reportsByArea.set(row.area_id, { ...reportsByArea.get(row.area_id), [row.kind]: row });
  }

  const toReport = (row) => (row
    ? { status: row.status, headers: row.headers, records: row.records, failureCode: row.failure_code, statusDetail: row.status_detail, generatedAt: row.generated_at }
    : null);

  return {
    month,
    chapters: chapters.map((chapter) => {
      const connection = connectionByArea.get(chapter.areaId);
      const saved = reportsByArea.get(chapter.areaId) ?? {};
      return {
        ...chapter,
        isReady: Boolean(connection?.gmail_updated_at && connection?.ogd_updated_at),
        birthday: toReport(saved.birthday),
        anniversary: toReport(saved.anniversary),
      };
    }),
  };
});
