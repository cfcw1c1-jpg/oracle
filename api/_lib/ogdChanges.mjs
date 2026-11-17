import { fetchAllRows } from './access.mjs';
import { sameValue } from './ogdMemberForm.mjs';

// Oracle -> OGD change queue (ogd_pending_changes). Rows are filled by a
// trigger on members; see scripts/sql/2026111705_ogd_pending_changes.sql.

export const OPEN_STATUSES = ['pending', 'failed'];
const IN_CHUNK = 200;

const inChapter = (areaName, chapterName) => Boolean(areaName) && areaName.toUpperCase().startsWith(chapterName.toUpperCase());

function chunk(items, size = IN_CHUNK) {
  const parts = [];
  for (let index = 0; index < items.length; index += size) parts.push(items.slice(index, index + size));
  return parts;
}

async function membersById(db, memberIds) {
  const byId = new Map();
  for (const ids of chunk([...new Set(memberIds)])) {
    const { data, error } = await db.from('members').select('MemberIDNo, Firstname, Lastname, AreaName').in('MemberIDNo', ids);
    if (error) throw error;
    for (const member of data) byId.set(member.MemberIDNo, member);
  }
  return byId;
}

// Open (pending or failed) changes for the given chapters, each labelled with
// its member and chapter. Members outside those chapters are left out.
export async function loadOpenChanges(db, chapters) {
  const rows = await fetchAllRows(() =>
    db
      .from('ogd_pending_changes')
      .select('id, member_id, field, old_value, new_value, status, detail, changed_by, changed_at, attempted_at')
      .in('status', OPEN_STATUSES)
      .order('changed_at', { ascending: false })
      .order('id'),
  );
  if (!rows.length) return [];

  const members = await membersById(db, rows.map((row) => row.member_id));
  const editorIds = [...new Set(rows.map((row) => row.changed_by).filter(Boolean))];
  const editors = new Map();
  if (editorIds.length) {
    const { data, error } = await db.from('profiles').select('id, full_name, email').in('id', editorIds);
    if (!error) for (const profile of data) editors.set(profile.id, profile.full_name || profile.email || null);
  }

  return rows.flatMap((row) => {
    const member = members.get(row.member_id);
    const chapter = chapters.find((item) => inChapter(member?.AreaName, item.chapter));
    if (!chapter) return [];
    return [
      {
        id: row.id,
        areaId: chapter.areaId,
        memberId: row.member_id,
        memberName: member ? [member.Lastname, member.Firstname].filter(Boolean).join(', ') : row.member_id,
        field: row.field,
        oldValue: row.old_value,
        newValue: row.new_value,
        status: row.status,
        detail: row.detail,
        changedBy: editors.get(row.changed_by) ?? null,
        changedAt: row.changed_at,
        attemptedAt: row.attempted_at,
      },
    ];
  });
}

// Before a sync writes what it read from OGD, drops the fields that still
// have an Oracle change waiting, so the sync never undoes it. When OGD
// already shows the waiting value (someone changed it there too), the change
// is marked pushed instead.
export async function keepPendingFields(db, members) {
  const ids = members.map((member) => member.MemberIDNo);
  const open = [];
  for (const part of chunk(ids)) {
    const { data, error } = await db.from('ogd_pending_changes').select('id, member_id, field, new_value').in('status', OPEN_STATUSES).in('member_id', part);
    if (error) {
      // Before the migration runs there is no queue to protect.
      if (error.code === 'PGRST205' || error.code === '42P01') return members;
      throw error;
    }
    open.push(...data);
  }
  if (!open.length) return members;

  const byMember = new Map();
  for (const change of open) byMember.set(change.member_id, [...(byMember.get(change.member_id) ?? []), change]);
  const confirmed = [];
  const result = members.map((member) => {
    const changes = byMember.get(member.MemberIDNo);
    if (!changes) return member;
    const kept = { ...member };
    for (const change of changes) {
      if (!(change.field in kept)) continue;
      if (sameValue(kept[change.field], change.new_value)) confirmed.push(change.id);
      delete kept[change.field];
    }
    return kept;
  });

  for (const part of chunk(confirmed)) {
    const now = new Date().toISOString();
    const { error } = await db.from('ogd_pending_changes').update({ status: 'pushed', detail: 'OGD already had this value.', pushed_at: now, attempted_at: now }).in('id', part);
    if (error) throw error;
  }
  return result;
}
