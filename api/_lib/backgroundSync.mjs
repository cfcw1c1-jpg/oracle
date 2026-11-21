// Shared by the sync task and the chapters list. A background sync that has
// shown no progress for this long has died and may be started again. One
// already asked to stop gets less time: a stretch only lasts a few minutes.
export const STALLED_AFTER_MS = 7 * 60 * 1000;
export const STOPPING_STALLED_AFTER_MS = 3 * 60 * 1000;

export function isBackgroundStalled(row, now = Date.now()) {
  if (!row?.bg_state) return false;
  if (!row.progress_at) return true;
  const quiet = now - new Date(row.progress_at).getTime();
  return quiet > (row.bg_state === 'stopping' ? STOPPING_STALLED_AFTER_MS : STALLED_AFTER_MS);
}
