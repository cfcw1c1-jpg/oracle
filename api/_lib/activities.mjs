import { fetchAllRows, HttpError } from './access.mjs';
import { cleanDetails, normalizeText } from './ogdActivities.mjs';

// Shared by the Activities routes: date checks, members lookups, attendee
// matching and the shape the page receives.

export const ACTIVITY_COLUMNS = 'id, area_id, source, ogd_key, name, activity_type, area_name, starts_at, ends_at, team_leader, team_leader_member_id, venue, description, attendance_count, attendees, ogd_details, ogd_attendee_table, ogd_url, public_token, push_status, push_failure_code, push_detail, pushed_at, attendee_push_status, attendee_push_failure_code, attendee_push_detail, attendees_pushed_at, synced_at, created_at, updated_at';
const MEMBER_COLUMNS = 'MemberIDNo, Lastname, Firstname, AreaName, PastoralService, Status';
const MAX_RANGE_DAYS = 400;

export function parseDay(value, label) {
  const text = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(new Date(`${text}T00:00:00+08:00`).getTime())) {
    throw new HttpError(400, `Please choose a valid ${label} date.`);
  }
  return text;
}

export function parseRange(from, to) {
  const start = parseDay(from, 'start');
  const end = parseDay(to, 'end');
  const days = (new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000;
  if (days < 0) throw new HttpError(400, 'The start date must be on or before the end date.');
  if (days > MAX_RANGE_DAYS) throw new HttpError(400, 'Please choose a range of about a year or less.');
  return { from: start, to: end };
}

// Manila calendar days as an inclusive UTC range for queries.
export function rangeBounds({ from, to }) {
  return { startIso: new Date(`${from}T00:00:00+08:00`).toISOString(), endIso: new Date(`${to}T23:59:59.999+08:00`).toISOString() };
}

export function memberName(member) {
  return `${(member.Lastname || '').trim()}, ${(member.Firstname || '').trim()}`.replace(/^, |, $/g, '');
}

// Every member whose Area belongs to the chapter ("West 1C1", "West 1C1A", ...).
export async function chapterMembers(db, chapterName) {
  const pattern = `${String(chapterName).replace(/[%_\\]/g, (match) => `\\${match}`)}%`;
  return fetchAllRows(() => db.from('members').select(MEMBER_COLUMNS).ilike('AreaName', pattern).order('MemberIDNo'));
}

export async function membersById(db, ids) {
  const unique = [...new Set(ids.filter(Boolean).map((id) => String(id).trim().toUpperCase()))];
  const found = new Map();
  for (let index = 0; index < unique.length; index += 200) {
    const { data, error } = await db.from('members').select(MEMBER_COLUMNS).in('MemberIDNo', unique.slice(index, index + 200));
    if (error) throw error;
    data.forEach((member) => found.set(member.MemberIDNo.toUpperCase(), member));
  }
  return found;
}

// Name keys an OGD attendee might be listed under: "LAST, FIRST" and "FIRST LAST".
function nameKeys(member) {
  const last = normalizeText(member.Lastname);
  const first = normalizeText(member.Firstname);
  return [`${last} ${first}`, `${first} ${last}`];
}

// Links OGD attendees to Oracle members by Member ID, else by name within
// the chapter. Unmatched attendees are kept with what OGD showed.
export function matchAttendees(attendees, { byId, chapterList }) {
  const byName = new Map();
  for (const member of chapterList) for (const key of nameKeys(member)) if (!byName.has(key)) byName.set(key, member);
  return attendees.map((attendee) => {
    const member = (attendee.memberId && byId.get(attendee.memberId.toUpperCase())) || byName.get(normalizeText(attendee.name));
    if (!member) return { memberId: attendee.memberId ?? null, name: attendee.name, area: null, matched: false, source: attendee.source ?? 'ogd', cells: attendee.cells };
    return { memberId: member.MemberIDNo, name: memberName(member), area: member.AreaName ?? null, service: member.PastoralService ?? null, matched: true, source: attendee.source ?? 'ogd', cells: attendee.cells };
  });
}

export function attendeeKey(attendee) {
  return attendee.memberId ? `id:${attendee.memberId.toUpperCase()}` : `name:${normalizeText(attendee.name)}`;
}

// Keeps attendees added in Oracle (or by link) and replaces OGD's own list.
export function mergeAttendees(existing, fromOgd) {
  const kept = (existing ?? []).filter((attendee) => attendee.source !== 'ogd');
  const seen = new Set(fromOgd.map(attendeeKey));
  return [...fromOgd, ...kept.filter((attendee) => !seen.has(attendeeKey(attendee)))];
}

// The activity exists in OGD: read from it, or created there from Oracle.
export function isInOgd(row) {
  return row.source === 'ogd' || row.push_status === 'pushed';
}

// Attendees added in Oracle (by hand or by link) that OGD does not have yet.
// Anyone OGD already lists (by Member ID or by name) is never pending.
export function pendingForOgd(attendees) {
  const list = attendees ?? [];
  const inOgd = new Set(list.filter((attendee) => attendee.source === 'ogd')
    .flatMap((attendee) => [attendee.memberId ? `id:${attendee.memberId.toUpperCase()}` : null, `name:${normalizeText(attendee.name)}`]).filter(Boolean));
  return list.filter((attendee) => attendee.source !== 'ogd' && attendee.memberId && attendee.ogd !== 'added'
    && !inOgd.has(`id:${attendee.memberId.toUpperCase()}`) && !inOgd.has(`name:${normalizeText(attendee.name)}`));
}

export function toActivity(row) {
  return {
    id: row.id,
    areaId: row.area_id,
    source: row.source,
    name: row.name,
    activityType: row.activity_type,
    areaName: row.area_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    teamLeader: row.team_leader,
    teamLeaderMemberId: row.team_leader_member_id,
    venue: row.venue,
    description: row.description,
    attendanceCount: row.attendance_count,
    attendees: (() => {
      const pending = new Set(pendingForOgd(row.attendees));
      return (row.attendees ?? []).map((attendee) => ({ ...attendee, isPendingInOgd: pending.has(attendee) }));
    })(),
    details: cleanDetails(row.ogd_details),
    attendeeTable: row.ogd_attendee_table,
    ogdUrl: row.ogd_url,
    publicToken: row.public_token,
    pushStatus: row.push_status,
    pushFailureCode: row.push_failure_code,
    pushDetail: row.push_detail,
    pushedAt: row.pushed_at,
    isInOgd: isInOgd(row),
    attendeePushStatus: row.attendee_push_status,
    attendeePushFailureCode: row.attendee_push_failure_code,
    attendeePushDetail: row.attendee_push_detail,
    attendeesPushedAt: row.attendees_pushed_at,
    pendingInOgd: isInOgd(row) ? pendingForOgd(row.attendees).length : 0,
    syncedAt: row.synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
