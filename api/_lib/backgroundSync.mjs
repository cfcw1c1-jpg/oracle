// Shared by the sync task and the chapters list. A background sync that has
// shown no progress for this long has died and may be started again.
export const STALLED_AFTER_MS = 7 * 60 * 1000;
