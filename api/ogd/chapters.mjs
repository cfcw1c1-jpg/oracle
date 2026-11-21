import { authorize, fetchAllRows, HttpError, route } from '../_lib/access.mjs';
import { isBackgroundStalled } from '../_lib/backgroundSync.mjs';

// A run this old has outlived the function that started it.
const STALE_RUN_MS = 5 * 60 * 1000;

// A background sync, flagged stalled once it has shown no progress for a while.
function backgroundOf(sync) {
  if (!sync.bg_state) return null;
  const stalled = isBackgroundStalled(sync);
  return { state: sync.bg_state, part: sync.bg_part, run: sync.bg_run, retries: sync.bg_retries, startedAt: sync.bg_started_at, stalled };
}

// Selects non-secret columns only: both tabs see the OGD username and the
// Gmail address, never a password.
export const GET = route(async (request) => {
  const scopeName = new URL(request.url).searchParams.get('scope');
  const { db, scope, chapters } = await authorize(request, scopeName);
  if (!scope.credential) throw new HttpError(400, 'Unknown scope.');

  const [rows, syncs] = await Promise.all([
    fetchAllRows(() =>
      db
        .from('ogd_chapter_connections')
        .select('area_id, gmail_address, gmail_updated_at, ogd_username, ogd_updated_at, status, failure_code, status_detail, last_attempt_at, last_success_at')
        .order('area_id'),
    ),
    // Until 2026111701_ogd_member_syncs.sql runs, every chapter reads as never synced.
    fetchAllRows(() => db.from('ogd_member_syncs').select('area_id, status, sync_part, members_saved, households_saved, formations_saved, hh_next_page, fm_next_page, failure_code, status_detail, synced_at, progress_part, progress_stage, progress_done, progress_total, progress_page, progress_at, bg_state, bg_part, bg_run, bg_retries, bg_started_at').order('area_id')).catch(
      (error) => {
        if (error?.code === 'PGRST205' || error?.code === '42P01') return [];
        throw error;
      },
    ),
  ]);
  const byArea = new Map(rows.map((row) => [row.area_id, row]));
  const syncByArea = new Map(syncs.map((row) => [row.area_id, row]));
  const isOgdScope = scope.credential === 'ogd';

  return {
    chapters: chapters.map((chapter) => {
      const row = byArea.get(chapter.areaId);
      const sync = syncByArea.get(chapter.areaId);
      const isStale = row?.status === 'running' && Date.now() - new Date(row.last_attempt_at).getTime() > STALE_RUN_MS;
      return {
        ...chapter,
        identifier: (isOgdScope ? row?.ogd_username : row?.gmail_address) ?? null,
        ogdUsername: row?.ogd_username ?? null,
        gmailAddress: row?.gmail_address ?? null,
        ownConfigured: Boolean(isOgdScope ? row?.ogd_updated_at : row?.gmail_updated_at),
        otherConfigured: Boolean(isOgdScope ? row?.gmail_updated_at : row?.ogd_updated_at),
        status: isStale ? 'failed' : (row?.status ?? 'idle'),
        failureCode: isStale ? 'run_interrupted' : (row?.failure_code ?? null),
        statusDetail: isStale ? null : (row?.status_detail ?? null),
        lastAttemptAt: row?.last_attempt_at ?? null,
        lastSuccessAt: row?.last_success_at ?? null,
        memberSync: sync
          ? { status: sync.status, part: sync.sync_part, infoNextPage: sync.hh_next_page ?? 1, formationsNextPage: sync.fm_next_page ?? 1, membersSaved: sync.members_saved, householdsSaved: sync.households_saved, formationsSaved: sync.formations_saved, failureCode: sync.failure_code, statusDetail: sync.status_detail, syncedAt: sync.synced_at,
              background: backgroundOf(sync),
            progress: sync.progress_stage ? { part: sync.progress_part, stage: sync.progress_stage, done: sync.progress_done, total: sync.progress_total, page: sync.progress_page, at: sync.progress_at } : null }
          : null,
      };
    }),
  };
});
