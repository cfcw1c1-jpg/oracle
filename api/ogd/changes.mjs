import { authorize, HttpError, route } from '../_lib/access.mjs';
import { loadOpenChanges } from '../_lib/ogdChanges.mjs';

// Lists the Oracle member changes waiting for OGD in the caller's chapters,
// and lets the caller drop them before a push:
//   discard  removes the change from the queue; Oracle keeps the new value
//   revert   puts the old value back in Oracle and removes the change

const REVERTIBLE = new Set(['Lastname', 'Firstname', 'Gender', 'Status', 'SpouseName', 'Phone', 'MobileNo', 'Email', 'PastoralService', 'AreaName', 'NameOfHouseholdHead', 'YearRegistered']);

function missingTable(error) {
  return error?.code === 'PGRST205' || error?.code === '42P01';
}

export const GET = route(async (request) => {
  const scopeName = new URL(request.url).searchParams.get('scope');
  const { db, chapters } = await authorize(request, scopeName);
  try {
    return { changes: await loadOpenChanges(db, chapters) };
  } catch (error) {
    if (missingTable(error)) return { changes: [] };
    throw error;
  }
});

export const POST = route(async (request) => {
  const body = await request.json().catch(() => null);
  if (!body) throw new HttpError(400, 'Invalid request.');
  const { db, chapters } = await authorize(request, body.scope);

  const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isInteger) : [];
  if (!ids.length || ids.length > 500) throw new HttpError(400, 'Choose the changes to update.');
  if (body.action !== 'discard' && body.action !== 'revert') throw new HttpError(400, 'Unknown action.');

  // Only changes in the caller's own chapters, and only open ones.
  const allowed = (await loadOpenChanges(db, chapters)).filter((change) => ids.includes(change.id));
  if (allowed.length !== new Set(ids).size) throw new HttpError(403, 'Some of these changes are not in your chapters or were already pushed.');

  if (body.action === 'revert') {
    // The service role's own writes are not queued again by the trigger.
    for (const change of allowed) {
      if (!REVERTIBLE.has(change.field)) throw new HttpError(400, 'This change cannot be reverted.');
      const value = change.field === 'YearRegistered' ? (change.oldValue == null ? null : Number(change.oldValue)) : change.oldValue;
      const { error } = await db.from('members').update({ [change.field]: value }).eq('MemberIDNo', change.memberId);
      if (error) throw error;
    }
  }

  const { error } = await db.from('ogd_pending_changes').delete().in('id', allowed.map((change) => change.id));
  if (error) throw error;
  return { updated: allowed.length };
});
