import { kvGet, kvSet } from './offline';
import { enqueue, outbox } from './outbox';

// Member lists kept on the device for offline use, and member adds/edits made
// offline. Edits wait in the outbox (lib/outbox.js) and are checked for
// conflicts before they are saved (lib/offlineHandlers.js).

export const saveMembersOffline = (key, rows) => kvSet(`members:${key}`, rows).catch(() => null);
export const membersSavedOffline = async (key) => (await kvGet(`members:${key}`).catch(() => null)) || null;

// The list with this device's waiting adds and direct edits shown in it.
export function applyWaitingMemberChanges(list) {
  let rows = list;
  for (const item of outbox.items) {
    if (item.status === 'failed') continue;
    if (item.kind === 'member-update' && item.payload.mode === 'direct') {
      rows = rows.map((member) => (member.MemberIDNo === item.payload.memberId ? { ...member, ...item.payload.changes, waitingSync: true } : member));
    } else if (item.kind === 'member-insert' && !rows.some((member) => member.MemberIDNo === item.payload.memberId)) {
      rows = [...rows, { MemberIDNo: item.payload.memberId, ...item.payload.row, waitingSync: true }];
    }
  }
  return rows;
}

export function queueMemberUpdate({ memberId, name, changes, previous, mode }) {
  const count = Object.keys(changes).length;
  const what = mode === 'request' ? 'Change request' : 'Edit';
  return enqueue('member-update', `${what} for ${name || memberId}: ${count} field${count === 1 ? '' : 's'}`, { memberId, name, changes, previous, mode });
}

export function queueMemberInsert({ memberId, name, row }) {
  return enqueue('member-insert', `New member ${name || memberId}`, { memberId, name, row });
}
