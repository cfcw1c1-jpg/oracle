import { onBeforeUnmount, onMounted, ref } from 'vue';

// Device storage for working offline:
//   IndexedDB "oracle-offline" / store "kv"  small records (lists, queues)
//   Cache Storage "oracle-files"             file contents saved for offline
// Nothing here talks to the network.

const DB_NAME = 'oracle-offline';
const STORE = 'kv';
const FILE_CACHE = 'oracle-files';
let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

async function run(mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = action(transaction.objectStore(STORE));
    transaction.oncomplete = () => resolve(request?.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export const kvGet = (key) => run('readonly', (store) => store.get(key));
export const kvSet = (key, value) => run('readwrite', (store) => store.put(JSON.parse(JSON.stringify(value)), key));
export const kvDelete = (key) => run('readwrite', (store) => store.delete(key));
export const kvKeys = () => run('readonly', (store) => store.getAllKeys());

// ---------- Saved file contents ----------
const fileKey = (id) => `/__offline/files/${encodeURIComponent(id)}`;

export async function saveFileBlob(id, blob) {
  const cache = await caches.open(FILE_CACHE);
  await cache.put(fileKey(id), new Response(blob, { headers: { 'Content-Type': blob.type || 'application/octet-stream', 'Content-Length': String(blob.size) } }));
}

export async function readFileBlob(id) {
  const cache = await caches.open(FILE_CACHE);
  const hit = await cache.match(fileKey(id));
  return hit ? hit.blob() : null;
}

export async function hasFileBlob(id) {
  const cache = await caches.open(FILE_CACHE);
  return Boolean(await cache.match(fileKey(id)));
}

export async function deleteFileBlob(id) {
  const cache = await caches.open(FILE_CACHE);
  await cache.delete(fileKey(id));
}

// Asks the browser not to clear saved files when the device runs low on space.
export async function keepStorage() {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export async function storageEstimate() {
  try {
    const { usage = 0, quota = 0 } = (await navigator.storage?.estimate?.()) ?? {};
    return { usage, quota };
  } catch {
    return { usage: 0, quota: 0 };
  }
}

// ---------- Connection ----------
export const isOnline = () => navigator.onLine !== false;

// A network failure (no signal), as opposed to the server answering an error.
export function isNetworkError(error) {
  if (!isOnline()) return true;
  const text = String(error?.message || error || '');
  return /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(text);
}

// Reactive online state for a component.
export function useOnline() {
  const online = ref(isOnline());
  const update = () => {
    online.value = isOnline();
  };
  onMounted(() => {
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
  });
  onBeforeUnmount(() => {
    window.removeEventListener('online', update);
    window.removeEventListener('offline', update);
  });
  return online;
}
