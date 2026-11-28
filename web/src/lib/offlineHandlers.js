import { updateActivityAttendees } from './ogdApi';
import { registerHandler } from './outbox';
import { supabase } from './supabase';

// How each kind of change saved offline is sent once back online.
//   attendance     { activityId, activityName, add: [memberIds], remove: [attendee keys], members: [...] }
//   member-update  { memberId, changes, previous, mode: 'direct' | 'request', name }
//   member-insert  { memberId, row, name }
// A member edit is held as a conflict, not applied, when someone else changed
// one of the same fields while this device was offline.

const normalize = (value) => (value === null || value === undefined ? '' : String(value).trim());
const same = (a, b) => normalize(a) === normalize(b);

registerHandler('attendance', async (item) => {
  const { activityId, add = [], remove = [] } = item.payload;
  await updateActivityAttendees(activityId, { add, remove });
});

registerHandler('member-update', async (item) => {
  const { memberId, changes, previous = {}, mode } = item.payload;
  if (mode === 'request') {
    // Not allowed to save directly: goes to an Admin/Moderator, as online.
    const { data } = await supabase.auth.getUser();
    const { error } = await supabase.from('member_change_requests').insert([{
      member_id: memberId, requested_by: data?.user?.id || null, requested_by_email: data?.user?.email || null, changes, previous_values: previous,
    }]);
    if (error) throw error;
    return;
  }
  const fields = Object.keys(changes);
  if (!item.force) {
    const { data: current, error } = await supabase.from('members').select(['MemberIDNo', ...fields].join(', ')).eq('MemberIDNo', memberId).maybeSingle();
    if (error) throw error;
    if (!current) return { failed: true, detail: 'This member was removed while you were offline.' };
    const clashing = fields.filter((field) => !same(current[field], previous[field]) && !same(current[field], changes[field]));
    if (clashing.length) {
      return {
        conflict: true,
        serverValues: Object.fromEntries(clashing.map((field) => [field, current[field] ?? null])),
        detail: `Someone else changed ${clashing.join(', ')} while you were offline.`,
      };
    }
  }
  const { error } = await supabase.from('members').update(changes).eq('MemberIDNo', memberId);
  if (error) throw error;
});

registerHandler('member-insert', async (item) => {
  const { memberId, row } = item.payload;
  const { data: existing, error: lookupError } = await supabase.from('members').select('MemberIDNo').eq('MemberIDNo', memberId).maybeSingle();
  if (lookupError) throw lookupError;
  if (existing && !item.force) {
    return { conflict: true, serverValues: null, detail: `A member with ID ${memberId} was added while you were offline. Keep mine updates that member with your details.` };
  }
  const { error } = existing
    ? await supabase.from('members').update(row).eq('MemberIDNo', memberId)
    : await supabase.from('members').insert([{ MemberIDNo: memberId, ...row }]);
  if (error) throw error;
});
