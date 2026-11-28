import { reactive } from 'vue';
import { isNetworkError, isOnline, kvDelete, kvGet, kvKeys, kvSet } from './offline';

// Changes made without internet wait here, on the device, and are sent in
// order when the connection comes back. Each item:
//   { id, kind, label, payload, createdAt, status, detail, serverValues, force }
//   status  'pending'   waiting to be sent
//           'conflict'  someone changed the same thing meanwhile; needs a choice
//           'failed'    the server refused it (detail says why)
// Each kind has a handler (registerHandler) that sends one item and returns
// { conflict: true, serverValues, detail } when it must not be applied as is.
// Pages listen for the "oracle-outbox-synced" window event ({ kinds, items })
// to reload.

const KEY = 'outbox';
const handlers = new Map();
const RETRY_EVERY_MS = 60 * 1000;

export const outbox = reactive({ items: [], syncing: false, loaded: false, lastSyncedAt: null });

async function persist() {
  await kvSet(KEY, outbox.items);
}

async function load() {
  if (outbox.loaded) return;
  outbox.items = (await kvGet(KEY).catch(() => null)) || [];
  outbox.loaded = true;
}

export function registerHandler(kind, handler) {
  handlers.set(kind, handler);
}

export async function enqueue(kind, label, payload) {
  await load();
  const item = { id: crypto.randomUUID(), kind, label, payload, createdAt: new Date().toISOString(), status: 'pending', detail: null };
  outbox.items = [...outbox.items, item];
  await persist();
  return item;
}

export const pendingOf = (kind) => outbox.items.filter((item) => item.kind === kind && item.status !== 'failed');

export async function discard(id) {
  outbox.items = outbox.items.filter((item) => item.id !== id);
  await persist();
}

// Sends a conflicting item anyway (keeps this device's version), or retries a failed one.
export async function retry(id, { force = false } = {}) {
  outbox.items = outbox.items.map((item) => (item.id === id ? { ...item, status: 'pending', detail: null, force: force || item.force } : item));
  await persist();
  return flush();
}

// Sends every pending item in order. Stops at the first connection problem
// and tries again when the device is back online.
export async function flush() {
  await load();
  if (outbox.syncing || !isOnline() || !outbox.items.some((item) => item.status === 'pending')) return;
  outbox.syncing = true;
  const synced = [];
  try {
    for (const item of [...outbox.items]) {
      if (item.status !== 'pending') continue;
      const handler = handlers.get(item.kind);
      if (!handler) continue;
      let result;
      try {
        result = await handler(item);
      } catch (error) {
        // No connection, or the sign-in needs refreshing: try again later.
        if (isNetworkError(error) || error?.status === 401 || /jwt|sign in again/i.test(String(error?.message))) break;
        result = { failed: true, detail: error.message };
      }
      if (result?.conflict) {
        outbox.items = outbox.items.map((entry) => (entry.id === item.id ? { ...entry, status: 'conflict', detail: result.detail, serverValues: result.serverValues } : entry));
      } else if (result?.failed) {
        outbox.items = outbox.items.map((entry) => (entry.id === item.id ? { ...entry, status: 'failed', detail: result.detail } : entry));
      } else {
        outbox.items = outbox.items.filter((entry) => entry.id !== item.id);
        synced.push({ kind: item.kind, payload: item.payload });
      }
      await persist();
    }
  } finally {
    outbox.syncing = false;
    outbox.lastSyncedAt = new Date().toISOString();
  }
  if (synced.length) window.dispatchEvent(new CustomEvent('oracle-outbox-synced', { detail: { kinds: [...new Set(synced.map((entry) => entry.kind))], items: synced } }));
}

let started = false;
let timer = null;
// Starts sending in the background: now, whenever the connection returns,
// and every minute while something waits.
export async function startOutbox() {
  await load();
  if (started) return;
  started = true;
  window.addEventListener('online', () => flush());
  timer = setInterval(() => {
    if (outbox.items.some((item) => item.status === 'pending')) flush();
  }, RETRY_EVERY_MS);
  flush();
}

// Removes this person's data saved for offline use (member lists, activities,
// waiting changes) from the device, e.g. when they sign out.
export async function clearPersonalData() {
  const keys = (await kvKeys().catch(() => [])) || [];
  await Promise.all(keys.filter((key) => /^(members:|activities:|outbox$)/.test(String(key))).map((key) => kvDelete(key).catch(() => null)));
  outbox.items = [];
}

export function stopOutbox() {
  clearInterval(timer);
  started = false;
}
