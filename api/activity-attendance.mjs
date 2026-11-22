import { createAdminClient, HttpError, route } from './_lib/access.mjs';
import { attendeeKey, memberName } from './_lib/activities.mjs';
import { normalizeText } from './_lib/ogdActivities.mjs';

// The public attendance link (/activity-attendance?token=...). No sign-in: a
// member gives their Member ID and last name, which must match Oracle's
// members list, and is added to the activity's attendees. The token is a
// random UUID, so a link only reaches its own activity.

const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findActivity(db, token) {
  if (!TOKEN.test(String(token ?? ''))) throw new HttpError(404, 'This attendance link is not valid.');
  const { data, error } = await db.from('activities')
    .select('id, name, activity_type, area_name, starts_at, ends_at, venue, team_leader, attendees, areas ( name )')
    .eq('public_token', token).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'This attendance link is not valid.');
  return data;
}

function publicView(row) {
  return {
    name: row.name, activityType: row.activity_type, areaName: row.area_name, chapter: row.areas?.name ?? null,
    startsAt: row.starts_at, endsAt: row.ends_at, venue: row.venue, teamLeader: row.team_leader,
    attendeeCount: (row.attendees ?? []).length,
  };
}

export const GET = route(async (request) => {
  const db = createAdminClient();
  return { activity: publicView(await findActivity(db, new URL(request.url).searchParams.get('token'))) };
});

export const POST = route(async (request) => {
  const body = await request.json().catch(() => null);
  if (!body) throw new HttpError(400, 'Invalid request.');
  const db = createAdminClient();
  const row = await findActivity(db, body.token);

  const memberId = String(body.memberId ?? '').trim().toUpperCase();
  const lastName = normalizeText(body.lastName);
  if (!memberId || !lastName) throw new HttpError(400, 'Please enter your Member ID and last name.');
  const { data: member, error } = await db.from('members').select('MemberIDNo, Lastname, Firstname, AreaName, PastoralService').eq('MemberIDNo', memberId).maybeSingle();
  if (error) throw error;
  if (!member || normalizeText(member.Lastname) !== lastName) throw new HttpError(404, 'That Member ID and last name do not match our members list.');

  const attendee = {
    memberId: member.MemberIDNo, name: memberName(member), area: member.AreaName ?? null, service: member.PastoralService ?? null,
    matched: true, source: 'link', at: new Date().toISOString(),
  };
  const attendees = row.attendees ?? [];
  if (attendees.some((entry) => attendeeKey(entry) === attendeeKey(attendee))) {
    return { ok: true, alreadyRecorded: true, name: attendee.name, activity: publicView(row) };
  }
  const next = [...attendees, attendee];
  const { error: updateError } = await db.from('activities').update({ attendees: next, updated_at: attendee.at }).eq('id', row.id);
  if (updateError) throw updateError;
  return { ok: true, alreadyRecorded: false, name: attendee.name, activity: publicView({ ...row, attendees: next }) };
});
