import { authorize, HttpError, route } from '../access.mjs';
import { chapterMembers, matchAttendees, membersById, mergeAttendees, parseRange } from '../activities.mjs';
import { activityKey, createActivitiesSync, normalizeText, toAttendees } from '../ogdActivities.mjs';
import { runChapterLogin } from '../ogdRun.mjs';

// Reading stops at this point so the results are saved inside the function's
// 300 second limit; the sign-in itself can take a minute.
const READ_BUDGET_MS = 225 * 1000;

// Reads one chapter's OGD activities for a date range, with each activity's
// details and attendees, and saves them.
export const POST = route(async (request) => {
  const startedAt = Date.now();
  const body = await request.json().catch(() => null);
  if (!body) throw new HttpError(400, 'Invalid request.');

  const { db, userId, chapters } = await authorize(request, 'activities');
  const areaId = Number(body.areaId);
  const chapter = chapters.find((entry) => entry.areaId === areaId);
  if (!chapter) throw new HttpError(403, 'You cannot manage this chapter.');
  const range = parseRange(body.from, body.to);

  const run = await runChapterLogin({ db, areaId, userId, afterLogin: createActivitiesSync({ ...range, deadline: startedAt + READ_BUDGET_MS }) });
  const result = run.afterLoginResult;
  const syncedAt = new Date().toISOString();

  if (!result) {
    const { error } = await db.from('activity_syncs').upsert({
      area_id: areaId, date_from: range.from, date_to: range.to, status: 'failed', found: 0, is_partial: false,
      failure_code: run.failure_code, status_detail: run.status_detail, synced_at: syncedAt, synced_by: userId,
    }, { onConflict: 'area_id' });
    if (error) throw error;
    return { ok: false, failureCode: run.failure_code, statusDetail: run.status_detail };
  }

  const fromOgd = result.activities.map((activity) => ({ ...activity, key: activityKey({ name: activity.name, start: activity.start, startsAt: activity.startsAt, nameHref: activity.nameHref, attendanceHref: activity.attendanceHref }) }));

  // An activity is saved under OGD's id when its link has one, else under its
  // name and start. Match a saved row either way, so the same activity never
  // gets a second row when one sync sees its id and another does not.
  const sameActivity = (name, startsAt) => `${normalizeText(name)}|${startsAt ? new Date(startsAt).toISOString() : ''}`;
  const starts = [...new Set(fromOgd.map((activity) => activity.startsAt).filter(Boolean))];
  const savedBySame = new Map();
  for (let index = 0; index < starts.length; index += 200) {
    const { data, error } = await db.from('activities').select('id, ogd_key, name, starts_at').eq('area_id', areaId).not('ogd_key', 'is', null).in('starts_at', starts.slice(index, index + 200));
    if (error) throw error;
    data.forEach((row) => savedBySame.set(sameActivity(row.name, row.starts_at), row));
  }
  for (const activity of fromOgd) {
    const saved = savedBySame.get(sameActivity(activity.name, activity.startsAt));
    if (!saved || saved.ogd_key === activity.key) continue;
    if (activity.key.startsWith('id:') && !saved.ogd_key.startsWith('id:')) {
      // The saved row now gets OGD's id.
      const { error } = await db.from('activities').update({ ogd_key: activity.key }).eq('id', saved.id);
      if (error && error.code !== '23505') throw error;
      if (!error) saved.ogd_key = activity.key;
    } else if (!activity.key.startsWith('id:')) {
      // This sync saw no id: keep the row's id. Two different OGD ids stay two activities.
      activity.key = saved.ogd_key;
    }
  }
  const keys = [...new Set(fromOgd.map((activity) => activity.key))];
  const existing = new Map();
  for (let index = 0; index < keys.length; index += 200) {
    const { data, error } = await db.from('activities').select('ogd_key, source, attendees, ogd_details, ogd_attendee_table, ogd_url, description')
      .eq('area_id', areaId).in('ogd_key', keys.slice(index, index + 200));
    if (error) throw error;
    data.forEach((row) => existing.set(row.ogd_key, row));
  }

  const parsed = fromOgd.map((activity) => (activity.attendeeTable ? toAttendees(activity.attendeeTable) : null));
  const [byId, chapterList] = await Promise.all([
    membersById(db, parsed.flat().filter(Boolean).map((attendee) => attendee.memberId)),
    chapterMembers(db, chapter.chapter),
  ]);

  const seenKeys = new Set();
  const rows = [];
  fromOgd.forEach((activity, index) => {
    if (seenKeys.has(activity.key)) return;
    seenKeys.add(activity.key);
    const before = existing.get(activity.key);
    const attendees = parsed[index] ? mergeAttendees(before?.attendees, matchAttendees(parsed[index], { byId, chapterList })) : (before?.attendees ?? []);
    rows.push({
      area_id: areaId,
      source: before?.source ?? 'ogd',
      ogd_key: activity.key,
      name: activity.name,
      activity_type: activity.type || null,
      area_name: activity.area || null,
      starts_at: activity.startsAt,
      ends_at: activity.endsAt,
      team_leader: activity.leader || null,
      venue: activity.venue || null,
      description: before?.description ?? activity.details?.Description ?? activity.details?.Remarks ?? null,
      attendance_count: activity.attendanceCount ?? (parsed[index] ? parsed[index].length : null),
      attendees,
      ogd_details: activity.details ?? before?.ogd_details ?? {},
      ogd_attendee_table: activity.attendeeTable ?? before?.ogd_attendee_table ?? null,
      ogd_url: activity.nameHref ?? activity.attendanceHref ?? before?.ogd_url ?? null,
      synced_at: syncedAt,
      updated_at: syncedAt,
    });
  });

  for (let index = 0; index < rows.length; index += 100) {
    const { error } = await db.from('activities').upsert(rows.slice(index, index + 100), { onConflict: 'area_id,ogd_key' });
    if (error) throw error;
  }

  const withAttendees = fromOgd.filter((activity) => activity.attendeeTable).length;
  const detail = [
    `Read ${rows.length} activit${rows.length === 1 ? 'y' : 'ies'} from ${result.pagesRead} list page${result.pagesRead === 1 ? '' : 's'}; attendees for ${withAttendees}.`,
    result.isPartial ? 'Not everything fit in one run: sync again, or choose a shorter range, to read the rest.' : '',
    result.notes,
  ].filter(Boolean).join(' ');
  const { error } = await db.from('activity_syncs').upsert({
    area_id: areaId, date_from: range.from, date_to: range.to, status: 'synced', found: rows.length, is_partial: result.isPartial,
    failure_code: null, status_detail: detail.slice(0, 3000), synced_at: syncedAt, synced_by: userId,
  }, { onConflict: 'area_id' });
  if (error) throw error;

  return { ok: true, found: rows.length, isPartial: result.isPartial };
});
