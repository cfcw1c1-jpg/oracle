import { authorize, HttpError, route } from '../access.mjs';
import { clpKey, createClpSync, longDateToDate } from '../ogdEvangelization.mjs';
import { runChapterLogin } from '../ogdRun.mjs';

// Reading stops at this point so the results are saved inside the function's
// 300 second limit; the sign-in itself can take a minute.
const READ_BUDGET_MS = 225 * 1000;

const COLUMNS = 'id, ogd_key, start_date';

// Reads one chapter's CLPs from OGD's Evangelization page, with each CLP's
// service team, participants, sessions and graduates, and saves them as CLP
// Maintenance batches. A batch made in Oracle for the same chapter and start
// date is linked to its OGD CLP instead of getting a second row, so it keeps
// its registration link and enrolled members.
export const POST = route(async (request) => {
  const startedAt = Date.now();
  const body = await request.json().catch(() => null);
  if (!body) throw new HttpError(400, 'Invalid request.');

  const { db, userId, chapters } = await authorize(request, 'clp');

  // { action: 'status' }: the caller's chapters, whether each has its OGD
  // logins saved, and each one's last CLP sync. Opens no browser.
  if (body.action === 'status') {
    const areaIds = chapters.map((entry) => entry.areaId);
    if (!areaIds.length) return { chapters: [] };
    const [connections, syncs] = await Promise.all([
      db.from('ogd_chapter_connections').select('area_id, gmail_updated_at, ogd_updated_at').in('area_id', areaIds),
      db.from('clp_syncs').select('area_id, status, found, is_partial, failure_code, status_detail, synced_at').in('area_id', areaIds),
    ]);
    if (connections.error) throw connections.error;
    if (syncs.error) throw syncs.error;
    const connectionByArea = new Map(connections.data.map((row) => [row.area_id, row]));
    const syncByArea = new Map(syncs.data.map((row) => [row.area_id, row]));
    return {
      chapters: chapters.map((entry) => {
        const connection = connectionByArea.get(entry.areaId);
        const sync = syncByArea.get(entry.areaId);
        return {
          areaId: entry.areaId,
          chapter: entry.chapter,
          isReady: Boolean(connection?.gmail_updated_at && connection?.ogd_updated_at),
          sync: sync ? { status: sync.status, found: sync.found, isPartial: sync.is_partial, failureCode: sync.failure_code, statusDetail: sync.status_detail, syncedAt: sync.synced_at } : null,
        };
      }),
    };
  }

  const areaId = Number(body.areaId);
  const chapter = chapters.find((entry) => entry.areaId === areaId);
  if (!chapter) throw new HttpError(403, 'You cannot manage this chapter.');

  const run = await runChapterLogin({ db, areaId, userId, afterLogin: createClpSync({ deadline: startedAt + READ_BUDGET_MS }) });
  const result = run.afterLoginResult;
  const syncedAt = new Date().toISOString();

  if (!result) {
    const { error } = await db.from('clp_syncs').upsert({
      area_id: areaId, status: 'failed', found: 0, is_partial: false,
      failure_code: run.failure_code, status_detail: run.status_detail, synced_at: syncedAt, synced_by: userId,
    }, { onConflict: 'area_id' });
    if (error) throw error;
    return { ok: false, failureCode: run.failure_code, statusDetail: run.status_detail };
  }

  const { data: saved, error: savedError } = await db.from('clp_trainings').select(COLUMNS).eq('area_id', areaId);
  if (savedError) throw savedError;
  const byKey = new Map(saved.filter((row) => row.ogd_key).map((row) => [row.ogd_key, row]));
  const unlinkedByStart = new Map();
  saved.filter((row) => !row.ogd_key).forEach((row) => {
    if (!unlinkedByStart.has(row.start_date)) unlinkedByStart.set(row.start_date, row);
  });

  const seen = new Set();
  let created = 0;
  let updated = 0;
  for (const clp of result.clps) {
    const details = clp.details;
    const startDate = clp.startDate ?? longDateToDate(details?.header?.Date);
    if (!startDate) continue;
    const key = clpKey({ ...clp, startDate });
    if (seen.has(key)) continue;
    seen.add(key);

    const values = {
      area_id: areaId,
      ogd_key: key,
      start_date: startDate,
      end_date: clp.endDate ?? startDate,
      // The CLP's own page has the whole venue; the list cuts it short.
      venue: details?.header?.Venue || clp.venue.replace(/\.{3}$|…$/, '').trim() || 'No venue',
      program_type: clp.programType ?? details?.programType ?? null,
      is_published: clp.isPublished,
      target_pax: clp.targetPax,
      ogd_area_name: clp.area || details?.area || null,
      ogd_url: clp.detailsHref,
      synced_at: syncedAt,
    };
    const people = details ? {
      header: details.header,
      service_team: details.serviceTeam,
      participants: details.participants,
      session_columns: details.sessionColumns,
      sessions: details.sessions,
      graduates: details.graduates,
      statistics: details.statistics,
      synced_at: syncedAt,
    } : null;

    const existing = byKey.get(key) ?? unlinkedByStart.get(startDate);
    let trainingId;
    if (existing) {
      if (!existing.ogd_key) unlinkedByStart.delete(startDate);
      const { error } = await db.from('clp_trainings').update(values).eq('id', existing.id);
      if (error) throw error;
      trainingId = existing.id;
      updated += 1;
    } else {
      const { data, error } = await db.from('clp_trainings').insert({ ...values, source: 'ogd' }).select('id').single();
      if (error) throw error;
      trainingId = data.id;
      created += 1;
    }
    // A CLP whose page was not read this run keeps the people read before.
    if (people) {
      const { error } = await db.from('clp_ogd_details').upsert({ clp_training_id: trainingId, ...people }, { onConflict: 'clp_training_id' });
      if (error) throw error;
    }
  }

  const withDetails = result.clps.filter((clp) => clp.details).length;
  const detail = [
    `Read ${seen.size} CLP${seen.size === 1 ? '' : 's'} from ${result.pagesRead} list page${result.pagesRead === 1 ? '' : 's'} (${created} new, ${updated} updated); details for ${withDetails}.`,
    result.isPartial ? 'Not everything fit in one run: sync again to read the rest.' : '',
    result.notes,
  ].filter(Boolean).join(' ');
  const { error } = await db.from('clp_syncs').upsert({
    area_id: areaId, status: 'synced', found: seen.size, is_partial: result.isPartial,
    failure_code: null, status_detail: detail.slice(0, 3000), synced_at: syncedAt, synced_by: userId,
  }, { onConflict: 'area_id' });
  if (error) throw error;

  return { ok: true, found: seen.size, created, updated, isPartial: result.isPartial };
});
