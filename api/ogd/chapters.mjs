import { authorize, fetchAllRows, HttpError, route } from '../_lib/access.mjs';

// A run this old has outlived the function that started it.
const STALE_RUN_MS = 5 * 60 * 1000;

// Selects non-secret columns only. Each page sees its own identifier and just
// a yes/no for the other side's credential.
export const GET = route(async (request) => {
  const scopeName = new URL(request.url).searchParams.get('scope');
  const { db, scope, chapters } = await authorize(request, scopeName);
  if (!scope.credential) throw new HttpError(400, 'Unknown scope.');

  const rows = await fetchAllRows(() =>
    db
      .from('ogd_chapter_connections')
      .select('area_id, gmail_address, gmail_updated_at, ogd_username, ogd_updated_at, status, failure_code, status_detail, last_attempt_at, last_success_at')
      .order('area_id'),
  );
  const byArea = new Map(rows.map((row) => [row.area_id, row]));
  const isOgdScope = scope.credential === 'ogd';

  return {
    chapters: chapters.map((chapter) => {
      const row = byArea.get(chapter.areaId);
      const isStale = row?.status === 'running' && Date.now() - new Date(row.last_attempt_at).getTime() > STALE_RUN_MS;
      return {
        ...chapter,
        identifier: (isOgdScope ? row?.ogd_username : row?.gmail_address) ?? null,
        ownConfigured: Boolean(isOgdScope ? row?.ogd_updated_at : row?.gmail_updated_at),
        otherConfigured: Boolean(isOgdScope ? row?.gmail_updated_at : row?.ogd_updated_at),
        status: isStale ? 'failed' : (row?.status ?? 'idle'),
        failureCode: isStale ? 'run_interrupted' : (row?.failure_code ?? null),
        statusDetail: isStale ? null : (row?.status_detail ?? null),
        lastAttemptAt: row?.last_attempt_at ?? null,
        lastSuccessAt: row?.last_success_at ?? null,
      };
    }),
  };
});
