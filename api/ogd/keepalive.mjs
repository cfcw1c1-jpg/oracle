import { authorize, route } from '../_lib/access.mjs';
import { encryptSecret } from '../_lib/secrets.mjs';
import { isReuseOff, savedSession } from '../_lib/ogdRun.mjs';
import { touchSession } from '../_lib/ogdSession.mjs';

// Called every few minutes by the OGD status light while Oracle is open. For
// each of the caller's chapters with a saved OGD session, touches OGD so the
// session does not time out, and drops sessions OGD has already ended.
export const POST = route(async (request) => {
  const { db, chapters } = await authorize(request, 'accounts');
  const areaIds = chapters.map((chapter) => chapter.areaId);
  if (!areaIds.length) return { chapters: [] };

  const { data: rows, error } = await db
    .from('ogd_chapter_connections')
    .select('area_id, status, ogd_session_enc, ogd_session_saved_at, ogd_session_reuse_off_until')
    .in('area_id', areaIds)
    .not('ogd_session_enc', 'is', null);
  if (error) throw error;

  const now = Date.now();
  const results = await Promise.all(rows.map(async (row) => {
    // A running sign-in or sync is using the session and will save it itself.
    if (row.status === 'running' || isReuseOff(row, now)) return { areaId: row.area_id, alive: null };
    const state = savedSession(row, row.area_id, now);
    if (!state) return { areaId: row.area_id, alive: false };

    const touched = await touchSession(state);
    if (touched.alive === null) return { areaId: row.area_id, alive: null };
    const columns = touched.alive
      ? { ogd_session_enc: encryptSecret(JSON.stringify(touched.state), row.area_id, 'session'), ogd_session_saved_at: new Date().toISOString() }
      : { ogd_session_enc: null, ogd_session_saved_at: null };
    // Only if no run saved a newer session meanwhile.
    const { error: updateError } = await db
      .from('ogd_chapter_connections')
      .update(columns)
      .eq('area_id', row.area_id)
      .eq('ogd_session_saved_at', row.ogd_session_saved_at);
    if (updateError) console.error('[ogd] keep-alive save failed:', updateError.message);
    return { areaId: row.area_id, alive: touched.alive };
  }));

  return { chapters: results };
});
