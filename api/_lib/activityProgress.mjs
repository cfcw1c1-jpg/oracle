// Writes a push's progress to activities.ogd_progress while it runs:
// { kind, stage, label, done, total, startedAt, updatedAt }. Writes are
// spaced out (a forced one always goes) and never fail the push.
const MIN_GAP_MS = 1200;

export function progressWriter(db, activityId, kind) {
  const startedAt = new Date().toISOString();
  let lastAt = 0;
  const report = async ({ force = false, ...progress }) => {
    const now = Date.now();
    if (!force && now - lastAt < MIN_GAP_MS) return;
    lastAt = now;
    const value = { kind, startedAt, updatedAt: new Date(now).toISOString(), done: null, total: null, ...progress };
    try {
      await db.from('activities').update({ ogd_progress: value }).eq('id', activityId);
    } catch {
      // Progress is only shown on screen.
    }
  };
  return report;
}

// The progress worth showing: only while it is fresh (a run lasts under 300s).
const STALE_MS = 6 * 60 * 1000;
export function liveProgress(row) {
  const progress = row.ogd_progress;
  if (!progress?.updatedAt || Date.now() - new Date(progress.updatedAt).getTime() > STALE_MS) return null;
  if (progress.kind === 'attendees' && row.attendee_push_status !== 'pushing') return null;
  if (progress.kind === 'activity' && row.push_status !== 'pushing') return null;
  return progress;
}
