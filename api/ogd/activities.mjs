import { authorize, fetchAllRows, HttpError, route } from '../_lib/access.mjs';
import {
  ACTIVITY_COLUMNS, attendeeKey, chapterMembers, memberName, membersById, parseRange, rangeBounds, toActivity,
} from '../_lib/activities.mjs';

const MAX_TEXT = 500;
const MAX_ATTENDEES = 2000;

function text(value, max = MAX_TEXT) {
  const cleaned = String(value ?? '').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

// The extra OGD fields chosen for an activity: { label: text } or, for a
// checkbox list, { label: [texts] }; checkboxes are true/false.
const MAX_OGD_FIELDS = 40;
function cleanOgdFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value).slice(0, MAX_OGD_FIELDS).flatMap(([label, entry]) => {
    const key = text(label, 80);
    if (!key) return [];
    if (typeof entry === 'boolean') return [[key, entry]];
    if (Array.isArray(entry)) {
      const list = entry.map((item) => text(item, 200)).filter(Boolean).slice(0, 100);
      return list.length ? [[key, list]] : [];
    }
    const cleaned = text(entry, 1000);
    return cleaned ? [[key, cleaned]] : [];
  });
  return Object.fromEntries(entries);
}

function isoOrNull(value, label) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, `Please enter a valid ${label}.`);
  return date.toISOString();
}

// The activities that start in a date range, for every chapter the caller can
// see, plus each chapter's OGD readiness and last sync.
export const GET = route(async (request) => {
  const params = new URL(request.url).searchParams;
  const range = parseRange(params.get('from'), params.get('to'));
  const { db, chapters } = await authorize(request, 'activities');
  const areaIds = chapters.map((chapter) => chapter.areaId);
  if (!areaIds.length) return { range, chapters: [], activities: [], types: [], form: null };
  const { startIso, endIso } = rangeBounds(range);

  const [connections, syncs, rows, typeRows, forms] = await Promise.all([
    fetchAllRows(() => db.from('ogd_chapter_connections').select('area_id, gmail_updated_at, ogd_updated_at').in('area_id', areaIds).order('area_id')),
    fetchAllRows(() => db.from('activity_syncs').select('*').in('area_id', areaIds).order('area_id')),
    fetchAllRows(() => db.from('activities').select(ACTIVITY_COLUMNS).in('area_id', areaIds).gte('starts_at', startIso).lte('starts_at', endIso).order('starts_at', { ascending: false }).order('id')),
    fetchAllRows(() => db.from('activities').select('activity_type').in('area_id', areaIds).not('activity_type', 'is', null).order('id')),
    fetchAllRows(() => db.from('ogd_activity_forms').select('*').in('area_id', areaIds).order('area_id')),
  ]);
  const formByArea = new Map(forms.map((row) => [row.area_id, row]));
  // The newest form read from any of the caller's chapters.
  const newestForm = forms.filter((row) => row.schema).sort((a, b) => String(b.captured_at).localeCompare(String(a.captured_at)))[0];
  const connectionByArea = new Map(connections.map((row) => [row.area_id, row]));
  const syncByArea = new Map(syncs.map((row) => [row.area_id, row]));

  return {
    range,
    types: [...new Set(typeRows.map((row) => row.activity_type))].sort(),
    chapters: chapters.map((chapter) => {
      const connection = connectionByArea.get(chapter.areaId);
      const sync = syncByArea.get(chapter.areaId);
      return {
        ...chapter,
        isReady: Boolean(connection?.gmail_updated_at && connection?.ogd_updated_at),
        formRead: formByArea.has(chapter.areaId) ? {
          status: formByArea.get(chapter.areaId).status, capturedAt: formByArea.get(chapter.areaId).captured_at, isPartial: formByArea.get(chapter.areaId).is_partial,
          failureCode: formByArea.get(chapter.areaId).failure_code, statusDetail: formByArea.get(chapter.areaId).status_detail,
        } : null,
        sync: sync ? {
          status: sync.status, from: sync.date_from, to: sync.date_to, found: sync.found, isPartial: sync.is_partial,
          failureCode: sync.failure_code, statusDetail: sync.status_detail, syncedAt: sync.synced_at,
        } : null,
      };
    }),
    activities: rows.map(toActivity),
    form: newestForm ? { areaId: newestForm.area_id, capturedAt: newestForm.captured_at, isPartial: newestForm.is_partial, ...newestForm.schema } : null,
  };
});

async function loadOwned(db, chapters, id) {
  const { data: row, error } = await db.from('activities').select(ACTIVITY_COLUMNS).eq('id', Number(id)).maybeSingle();
  if (error) throw error;
  if (!row) throw new HttpError(404, 'This activity no longer exists.');
  if (!chapters.some((chapter) => chapter.areaId === row.area_id)) throw new HttpError(403, 'You cannot manage this chapter.');
  return row;
}

// Members chosen in Oracle, as attendee entries.
async function resolveAttendees(db, memberIds, source) {
  if (memberIds.length > MAX_ATTENDEES) throw new HttpError(400, 'That is too many attendees for one activity.');
  const byId = await membersById(db, memberIds);
  const at = new Date().toISOString();
  return memberIds.map((id) => byId.get(String(id).trim().toUpperCase())).filter(Boolean).map((member) => ({
    memberId: member.MemberIDNo, name: memberName(member), area: member.AreaName ?? null, service: member.PastoralService ?? null, matched: true, source, at,
  }));
}

// action: 'save' (create or edit an Oracle activity), 'delete', 'attendees'
// (add or remove attendees on any activity), or 'members' (the chapter's
// members, for choosing attendees and the team leader).
export const POST = route(async (request) => {
  const body = await request.json().catch(() => null);
  if (!body) throw new HttpError(400, 'Invalid request.');
  const { db, userId, chapters } = await authorize(request, 'activities');

  if (body.action === 'members') {
    const chapter = chapters.find((entry) => entry.areaId === Number(body.areaId));
    if (!chapter) throw new HttpError(403, 'You cannot manage this chapter.');
    const members = await chapterMembers(db, chapter.chapter);
    return {
      members: members.filter((member) => !member.Status || member.Status === 'Active')
        .map((member) => ({ memberId: member.MemberIDNo, name: memberName(member), area: member.AreaName, service: member.PastoralService })),
    };
  }

  if (body.action === 'save') {
    const values = body.activity ?? {};
    const name = text(values.name, 200);
    if (!name) throw new HttpError(400, 'Please enter the activity name.');
    const startsAt = isoOrNull(values.startsAt, 'start date and time');
    if (!startsAt) throw new HttpError(400, 'Please enter the start date and time.');
    const endsAt = isoOrNull(values.endsAt, 'end date and time');
    if (endsAt && endsAt < startsAt) throw new HttpError(400, 'The end must be after the start.');
    const fields = {
      name, starts_at: startsAt, ends_at: endsAt,
      activity_type: text(values.activityType, 100), area_name: text(values.areaName, 100),
      team_leader: text(values.teamLeader, 200), team_leader_member_id: text(values.teamLeaderMemberId, 40),
      venue: text(values.venue, 300), description: text(values.description, 2000), updated_at: new Date().toISOString(),
    };
    const memberIds = Array.isArray(values.attendeeIds) ? values.attendeeIds.map(String) : null;
    fields.ogd_fields = cleanOgdFields(values.ogdFields);

    if (values.id) {
      const row = await loadOwned(db, chapters, values.id);
      if (row.source !== 'oracle' || row.push_status === 'pushed') throw new HttpError(409, 'This activity is already in OGD. Change it there, then sync.');
      const update = { ...fields };
      if (memberIds) {
        const chosen = await resolveAttendees(db, memberIds, 'oracle');
        const chosenKeys = new Set(chosen.map(attendeeKey));
        const kept = (row.attendees ?? []).filter((attendee) => attendee.source === 'link' && !chosenKeys.has(attendeeKey(attendee)));
        update.attendees = [...chosen, ...kept];
      }
      const { data, error } = await db.from('activities').update(update).eq('id', row.id).select(ACTIVITY_COLUMNS).single();
      if (error) throw error;
      return { activity: toActivity(data) };
    }

    const areaId = Number(values.areaId);
    if (!chapters.some((chapter) => chapter.areaId === areaId)) throw new HttpError(403, 'You cannot manage this chapter.');
    const attendees = memberIds ? await resolveAttendees(db, memberIds, 'oracle') : [];
    const { data, error } = await db.from('activities')
      .insert({ ...fields, area_id: areaId, source: 'oracle', attendees, created_by: userId })
      .select(ACTIVITY_COLUMNS).single();
    if (error) throw error;
    return { activity: toActivity(data) };
  }

  if (body.action === 'delete') {
    const row = await loadOwned(db, chapters, body.id);
    if (row.source !== 'oracle' || row.push_status === 'pushed') throw new HttpError(409, 'This activity is in OGD, so it can only be removed there.');
    const { error } = await db.from('activities').delete().eq('id', row.id);
    if (error) throw error;
    return { ok: true };
  }

  if (body.action === 'attendees') {
    const row = await loadOwned(db, chapters, body.id);
    const removeKeys = new Set((body.remove ?? []).map(String));
    let attendees = (row.attendees ?? []).filter((attendee) => !removeKeys.has(attendeeKey(attendee)));
    const added = await resolveAttendees(db, (body.add ?? []).map(String), 'oracle');
    const present = new Set(attendees.map(attendeeKey));
    attendees = [...attendees, ...added.filter((attendee) => !present.has(attendeeKey(attendee)))];
    const { data, error } = await db.from('activities').update({ attendees, updated_at: new Date().toISOString() }).eq('id', row.id).select(ACTIVITY_COLUMNS).single();
    if (error) throw error;
    return { activity: toActivity(data) };
  }

  throw new HttpError(400, 'Unknown action.');
});
