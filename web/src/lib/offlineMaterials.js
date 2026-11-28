import { deleteFileBlob, hasFileBlob, keepStorage, kvGet, kvSet, readFileBlob, saveFileBlob } from './offline';

// Materials saved on this device for offline use. A saved folder covers the
// folders inside it too. Kept on the device:
//   materials:folders        the last folder list (to browse offline)
//   materials:files:<id>     each saved folder's file rows
//   materials:saved          { [rootFolderId]: { name, folderIds, fileIds, bytes, savedAt, syncedAt } }
//   materials:stored         ids of every file whose contents are saved
// File contents live in Cache Storage (lib/offline.js). Uploaded files never
// change (a new upload is a new file), so syncing only downloads files that
// are new and removes ones that were deleted.

const SAVED = 'materials:saved';
const FOLDERS = 'materials:folders';
const STORED = 'materials:stored';
const filesKey = (folderId) => `materials:files:${folderId}`;

export const getSaved = async () => (await kvGet(SAVED)) || {};
export const cacheFolders = (folders) => kvSet(FOLDERS, folders);
export const getCachedFolders = async () => (await kvGet(FOLDERS)) || [];
export const cacheFiles = (folderId, rows) => kvSet(filesKey(folderId), rows);
export const getCachedFiles = async (folderId) => (await kvGet(filesKey(folderId))) || null;
export const readSavedFile = (fileId) => readFileBlob(fileId);

// The saved root covering a folder, if any.
export function savedRootFor(saved, folderId) {
  return Object.entries(saved).find(([, entry]) => entry.folderIds.includes(folderId))?.[0] ?? null;
}

// Deletes saved contents no saved folder needs any more.
async function prune(saved) {
  const needed = new Set(Object.values(saved).flatMap((entry) => entry.fileIds));
  const stored = (await kvGet(STORED)) || [];
  const kept = [];
  for (const id of stored) {
    if (needed.has(id)) kept.push(id);
    else await deleteFileBlob(id).catch(() => null);
  }
  await kvSet(STORED, kept);
}

// Saves (or brings up to date) a folder and everything inside it.
//   folderIds  the folder and its subfolders
//   rows       every file row in those folders
//   getLink    (row) => signed URL to download it
//   onProgress ({ done, total, bytes })
export async function saveFolderOffline({ rootId, rootName, folderIds, rows, getLink, onProgress = () => {} }) {
  await keepStorage();
  const stored = new Set((await kvGet(STORED)) || []);
  const missing = [];
  for (const row of rows) {
    if (!stored.has(row.id) || !(await hasFileBlob(row.id))) missing.push(row);
  }
  let done = 0;
  const failures = [];
  onProgress({ done, total: missing.length });
  for (const row of missing) {
    try {
      const response = await fetch(await getLink(row));
      if (!response.ok) throw new Error(`download answered ${response.status}`);
      await saveFileBlob(row.id, await response.blob());
      stored.add(row.id);
      await kvSet(STORED, [...stored]);
    } catch (error) {
      failures.push(`${row.file_name}: ${error.message}`);
    }
    done += 1;
    onProgress({ done, total: missing.length });
  }

  for (const folderId of folderIds) await cacheFiles(folderId, rows.filter((row) => row.folder_id === folderId));
  const saved = await getSaved();
  const savedIds = rows.filter((row) => stored.has(row.id)).map((row) => row.id);
  saved[rootId] = {
    name: rootName,
    folderIds,
    fileIds: savedIds,
    bytes: rows.filter((row) => stored.has(row.id)).reduce((sum, row) => sum + (row.size_bytes || 0), 0),
    savedAt: saved[rootId]?.savedAt ?? new Date().toISOString(),
    syncedAt: new Date().toISOString(),
  };
  await kvSet(SAVED, saved);
  await prune(saved);
  return { downloaded: missing.length - failures.length, failures, saved };
}

export async function removeFolderOffline(rootId) {
  const saved = await getSaved();
  delete saved[rootId];
  await kvSet(SAVED, saved);
  await prune(saved);
  return saved;
}
