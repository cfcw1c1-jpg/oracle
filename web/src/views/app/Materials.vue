<script setup>
import { Archive, ChevronLeft, ChevronRight, CloudOff, Download, Eye, File, FileImage, FileSpreadsheet, FileText, Film, Folder, FolderOpen, FolderPlus, HardDriveDownload, Music, QrCode, Paperclip, Pencil, Plus, Presentation, Trash2, UploadCloud } from 'lucide-vue-next';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import AppModal from '@/components/AppModal.vue';
import ImageViewer from '@/components/ImageViewer.vue';
import MaterialShareModal from '@/components/MaterialShareModal.vue';
import LoadingBlock from '@/components/LoadingBlock.vue';
import SearchInput from '@/components/SearchInput.vue';
import { compressForUpload } from '@/lib/compress';
import { isNetworkError, readFileBlob, useOnline } from '@/lib/offline';
import { cacheFiles, cacheFolders, getCachedFiles, getCachedFolders, getSaved, removeFolderOffline, saveFolderOffline, savedRootFor } from '@/lib/offlineMaterials';
import { confirmAction, showAlert } from '@/lib/data';
import { supabase, supabaseAnonKey, supabaseUrl } from '@/lib/supabase';

const props = defineProps({ isAdmin: Boolean });

const BUCKET = 'materials';
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const KINDS = {
  pdf: { icon: FileText, label: 'PDF' }, slides: { icon: Presentation, label: 'Slides' }, doc: { icon: File, label: 'Document' },
  sheet: { icon: FileSpreadsheet, label: 'Spreadsheet' }, video: { icon: Film, label: 'Video' }, audio: { icon: Music, label: 'Audio' },
  image: { icon: FileImage, label: 'Image' }, archive: { icon: Archive, label: 'Archive' }, other: { icon: Paperclip, label: 'File' },
};

const folders = ref([]);
const isLoadingFolders = ref(true);
const folderSearch = ref('');
const selectedId = ref(null);
const files = ref([]);
const isLoadingFiles = ref(false);
const uploadProgress = ref(null);
const busyFileId = ref(null);
const folderForm = ref(null);
const isSavingFolder = ref(false);
const fileInput = ref(null);
// Folder or file being shared: { type, id, name }.
const shareTarget = ref(null);
// Folders whose subfolders are hidden in the tree.
const collapsed = ref(new Set());
const selectedFileIds = ref(new Set());
const isDeletingFiles = ref(false);
const isDragging = ref(false);
// True while files are dragged anywhere over the page (Admins only): every
// folder is then listed, open, as a place to drop them.
const isDraggingFiles = ref(false);
// Folder row in the tree a file is being dragged over.
const dropFolderId = ref(null);
// Files waiting to upload, one at a time: [{ file, folder }].
const uploadQueue = [];
// Shown in the files pane after an upload finishes.
const uploadNotice = ref(null);
let noticeTimer = null;

const selectedFolder = computed(() => folders.value.find((folder) => folder.id === selectedId.value) || null);

// Folders can sit inside other folders (parent_id). A folder whose parent is
// missing is shown at the top level so it never disappears.
const folderById = computed(() => new Map(folders.value.map((folder) => [folder.id, folder])));
const childrenOf = computed(() => {
  const map = new Map();
  for (const folder of folders.value) {
    const parent = folder.parent_id && folderById.value.has(folder.parent_id) ? folder.parent_id : null;
    map.set(parent, [...(map.get(parent) ?? []), folder]);
  }
  return map;
});
// Every folder in tree order with its depth: parents first, children under them.
const folderTree = computed(() => {
  const rows = [];
  const walk = (parentId, depth, seen) => {
    for (const folder of childrenOf.value.get(parentId) ?? []) {
      if (seen.has(folder.id)) continue;
      const hasChildren = Boolean(childrenOf.value.get(folder.id)?.length);
      rows.push({ folder, depth, hasChildren });
      if (isDraggingFiles.value || !collapsed.value.has(folder.id)) walk(folder.id, depth + 1, new Set([...seen, folder.id]));
    }
  };
  walk(null, 0, new Set());
  return rows;
});
// Every folder, collapsed or not, for the "Put inside" list.
const allFolderRows = computed(() => {
  const rows = [];
  const walk = (parentId, depth, seen) => {
    for (const folder of childrenOf.value.get(parentId) ?? []) {
      if (seen.has(folder.id)) continue;
      rows.push({ folder, depth });
      walk(folder.id, depth + 1, new Set([...seen, folder.id]));
    }
  };
  walk(null, 0, new Set());
  return rows;
});
function toggleFolder(folderId) {
  const next = new Set(collapsed.value);
  if (next.has(folderId)) next.delete(folderId);
  else next.add(folderId);
  collapsed.value = next;
}
function folderPath(folder) {
  const path = [];
  const seen = new Set();
  for (let current = folder; current && !seen.has(current.id); current = folderById.value.get(current.parent_id)) {
    seen.add(current.id);
    path.unshift(current);
  }
  return path;
}
// The folder and every folder inside it, at any depth.
function descendantIds(folderId) {
  const ids = [folderId];
  for (let index = 0; index < ids.length; index += 1) {
    for (const child of childrenOf.value.get(ids[index]) ?? []) if (!ids.includes(child.id)) ids.push(child.id);
  }
  return ids;
}
const visibleFolders = computed(() => {
  const query = folderSearch.value.trim().toLowerCase();
  if (!query || isDraggingFiles.value) return folderTree.value;
  // While searching, matches are listed flat with their full path.
  return folders.value
    .filter((folder) => folder.name.toLowerCase().includes(query) || (folder.description || '').toLowerCase().includes(query))
    .map((folder) => ({ folder, depth: 0, path: folderPath(folder).slice(0, -1).map((item) => item.name).join(' / ') }));
});
const subfolders = computed(() => (selectedFolder.value ? childrenOf.value.get(selectedFolder.value.id) ?? [] : []));
const breadcrumb = computed(() => (selectedFolder.value ? folderPath(selectedFolder.value).slice(0, -1) : []));
// Folders a folder may be put inside: any folder except itself and those inside it.
const parentOptions = computed(() => {
  const blocked = new Set(folderForm.value?.id ? descendantIds(folderForm.value.id) : []);
  return allFolderRows.value.filter(({ folder }) => !blocked.has(folder.id));
});

function newFolder(parentId = null) {
  folderForm.value = { name: '', description: '', parent_id: parentId };
}

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

function fileKind(file) {
  const mime = (file.mime_type || '').toLowerCase();
  const ext = (file.file_name || '').split('.').pop().toLowerCase();
  if (mime === 'application/pdf' || ext === 'pdf') return KINDS.pdf;
  if (mime.includes('presentation') || mime.includes('powerpoint') || ['ppt', 'pptx', 'key', 'odp'].includes(ext)) return KINDS.slides;
  if (mime.includes('spreadsheet') || mime.includes('excel') || ['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return KINDS.sheet;
  if (mime.includes('word') || mime.startsWith('text/') || ['doc', 'docx', 'txt', 'rtf', 'odt'].includes(ext)) return KINDS.doc;
  if (mime.startsWith('video/') || ['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv'].includes(ext)) return KINDS.video;
  if (mime.startsWith('audio/') || ['mp3', 'm4a', 'wav', 'aac', 'ogg', 'flac'].includes(ext)) return KINDS.audio;
  if (mime.startsWith('image/')) return KINDS.image;
  return mime.includes('zip') || ['zip', 'rar', '7z'].includes(ext) ? KINDS.archive : KINDS.other;
}

function fileMeta(file) {
  const date = file.created_at ? new Date(file.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  return [fileKind(file).label, date].filter(Boolean).join(' · ');
}

// Total size of the open folder's own files (not its subfolders).
const folderBytes = computed(() => files.value.reduce((sum, file) => sum + (file.size_bytes || 0), 0));

function storageSafeName(name) {
  return (name || 'file').normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-120);
}

// Files uploaded before R2 still sit in Supabase Storage until moved.
const supabaseFileCount = ref(0);
const moveState = ref(null);

async function countSupabaseFiles() {
  const { count, error } = await supabase.from('materials').select('id', { count: 'exact', head: true }).eq('storage_provider', 'supabase');
  if (!error) supabaseFileCount.value = count ?? 0;
}

async function moveAllToR2() {
  const total = supabaseFileCount.value;
  if (!total || moveState.value) return;
  if (!confirmAction('Move to Cloudflare R2', `Move ${total} file${total === 1 ? '' : 's'} from Supabase Storage to Cloudflare R2? They stay listed and keep working while they move.`)) return;
  moveState.value = { moved: 0, total };
  const failures = [];
  try {
    // Each call moves a few files; stop when none remain or a round moves nothing.
    for (;;) {
      const result = await materialsApi({ action: 'move-to-r2' });
      moveState.value = { moved: moveState.value.moved + result.moved.length, total };
      failures.push(...result.failed);
      supabaseFileCount.value = result.remaining;
      if (!result.remaining || !result.moved.length) break;
    }
  } catch (error) {
    failures.push(error.message);
  }
  const moved = moveState.value.moved;
  moveState.value = null;
  if (selectedId.value) loadFiles(selectedId.value);
  if (moved) showNotice(`Moved ${moved} file${moved === 1 ? '' : 's'} to Cloudflare R2.`);
  if (failures.length) showAlert('Some Files Were Not Moved', failures.join('\n'));
}

function pickFolderIfNone() {
  const stillExists = folders.value.some((folder) => folder.id === selectedId.value);
  if (!stillExists) selectedId.value = window.matchMedia('(min-width: 820px)').matches ? folders.value[0]?.id || null : null;
}

async function loadFolders() {
  try {
    const { data, error } = await supabase.from('material_folders').select('id, name, description, parent_id, created_at, materials ( count )').order('name', { ascending: true });
    if (error) throw error;
    folders.value = (data || []).map(({ materials, ...folder }) => ({ ...folder, fileCount: materials?.[0]?.count || 0 }));
    cacheFolders(folders.value).catch(() => null);
    if (props.isAdmin) countSupabaseFiles();
    pickFolderIfNone();
    syncSavedFolders();
  } catch (error) {
    if (!isNetworkError(error)) showAlert('Error Loading Folders', error.message);
    else {
      // Offline: the folder list from the last visit.
      folders.value = await getCachedFolders().catch(() => []);
      pickFolderIfNone();
    }
  } finally {
    isLoadingFolders.value = false;
  }
}

// ---------- Offline ----------
// Any viewer can save a folder (and the folders inside it) on this device to
// open without internet. Saved folders update themselves whenever the page
// loads online or the connection comes back. Changes (upload, delete, share)
// need internet.
const online = useOnline();
const canEdit = computed(() => props.isAdmin && online.value);
const saved = ref({});
const offlineSave = ref(null);
let syncing = false;
const localUrls = new Map();
const FILE_COLUMNS = 'id, folder_id, file_name, storage_path, storage_provider, mime_type, size_bytes, created_at';

const isFolderSaved = (folderId) => Boolean(savedRootFor(saved.value, folderId));
const savedRootId = computed(() => (selectedFolder.value ? savedRootFor(saved.value, selectedFolder.value.id) : null));
const savedRoot = computed(() => (savedRootId.value ? saved.value[savedRootId.value] : null));

// An object URL for a file saved on this device, or null.
async function localFileUrl(file) {
  if (localUrls.has(file.id)) return localUrls.get(file.id);
  const blob = await readFileBlob(file.id).catch(() => null);
  if (!blob) return null;
  const url = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: file.mime_type || '' }));
  localUrls.set(file.id, url);
  return url;
}

function formatSynced(iso) {
  return iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
}

async function saveOffline(folder, { quiet = false } = {}) {
  if (offlineSave.value) return;
  const folderIds = descendantIds(folder.id);
  offlineSave.value = { name: folder.name, done: 0, total: 0 };
  try {
    const { data, error } = await supabase.from('materials').select(FILE_COLUMNS).in('folder_id', folderIds);
    if (error) throw error;
    const result = await saveFolderOffline({
      rootId: folder.id,
      rootName: folder.name,
      folderIds,
      rows: data || [],
      getLink: (row) => signedLink(row, false),
      onProgress: (progress) => {
        offlineSave.value = { name: folder.name, ...progress };
      },
    });
    saved.value = result.saved;
    if (!quiet) {
      const count = (data || []).length;
      showNotice(`"${folder.name}" is saved on this device (${count} file${count === 1 ? '' : 's'}). It opens without internet.`);
    }
    if (result.failures.length && !quiet) showAlert('Some Files Were Not Saved', result.failures.join('\n'));
  } catch (error) {
    if (!quiet) showAlert('Could Not Save for Offline', error.message);
  } finally {
    offlineSave.value = null;
  }
}

async function removeOffline(rootId) {
  const name = saved.value[rootId]?.name || 'this folder';
  if (!confirmAction('Remove from Device', `Remove "${name}" from this device? It stays in Oracle; you just won't be able to open it offline.`)) return;
  saved.value = await removeFolderOffline(rootId);
  for (const url of localUrls.values()) URL.revokeObjectURL(url);
  localUrls.clear();
  if (selectedId.value) loadFiles(selectedId.value);
}

// Brings every saved folder up to date: new files downloaded, deleted ones
// removed, and folders deleted in Oracle dropped from the device.
async function syncSavedFolders() {
  if (syncing || !online.value) return;
  syncing = true;
  try {
    for (const rootId of Object.keys(saved.value)) {
      const folder = folderById.value.get(rootId);
      if (!folder) saved.value = await removeFolderOffline(rootId);
      else await saveOffline(folder, { quiet: true });
    }
  } finally {
    syncing = false;
  }
}

function onBackOnline() {
  loadFolders();
  if (selectedId.value) loadFiles(selectedId.value);
}

let loadToken = 0;
// ---------- Images ----------
// Images get a thumbnail in the list and open in a viewer on the page.
const thumbnails = ref({});
const viewer = ref(null);
const isImage = (file) => fileKind(file) === KINDS.image;

// A short-lived link to show or save a file.
async function signedLink(file, download) {
  if (file.storage_provider === 'r2') return (await materialsApi({ action: 'download-url', materialId: file.id, download })).url;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(file.storage_path, SIGNED_URL_TTL_SECONDS, download ? { download: file.file_name } : undefined);
  if (error) throw error;
  return data.signedUrl;
}

async function loadThumbnails(list, token) {
  const images = list.filter(isImage);
  thumbnails.value = {};
  // A few at a time, so a folder full of photos doesn't flood the server.
  for (let index = 0; index < images.length; index += 4) {
    const links = await Promise.all(images.slice(index, index + 4).map(async (file) => {
      const url = (await localFileUrl(file)) || (online.value ? await signedLink(file, false).catch(() => null) : null);
      return url ? [file.id, url] : null;
    }));
    if (token !== loadToken) return;
    thumbnails.value = { ...thumbnails.value, ...Object.fromEntries(links.filter(Boolean)) };
  }
}

// The open folder's images for the viewer; urls fill in as links arrive.
const viewerImages = computed(() => files.value.filter(isImage).map((file) => ({
  id: file.id,
  name: file.file_name,
  url: thumbnails.value[file.id] || null,
  meta: [formatBytes(file.size_bytes), fileMeta(file)].filter(Boolean).join(' · '),
})));

function viewImage(file) {
  const index = viewerImages.value.findIndex((image) => image.id === file.id);
  if (index !== -1) viewer.value = { index };
}

async function fetchViewerUrl(fileId) {
  const file = files.value.find((item) => item.id === fileId);
  if (!file || thumbnails.value[fileId]) return;
  try {
    const url = (await localFileUrl(file)) || (await signedLink(file, false));
    thumbnails.value = { ...thumbnails.value, [fileId]: url };
  } catch (error) {
    viewer.value = null;
    showAlert('Error Opening Image', error.message);
  }
}

function downloadFromViewer(image) {
  const file = files.value.find((item) => item.id === image?.id);
  if (file) openFile(file, true);
}

async function loadFiles(folderId) {
  const token = ++loadToken;
  files.value = [];
  if (!folderId) return;
  isLoadingFiles.value = true;
  try {
    const { data, error } = await supabase.from('materials').select(FILE_COLUMNS).eq('folder_id', folderId).order('created_at', { ascending: false });
    if (error) throw error;
    if (token === loadToken) {
      files.value = data || [];
      if (savedRootFor(saved.value, folderId)) cacheFiles(folderId, files.value).catch(() => null);
      loadThumbnails(files.value, token);
    }
  } catch (error) {
    if (!isNetworkError(error)) showAlert('Error Loading Files', error.message);
    else if (token === loadToken) {
      // Offline: the files saved on this device, if the folder was saved.
      const rows = await getCachedFiles(folderId).catch(() => null);
      files.value = (rows || []).slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      loadThumbnails(files.value, token);
    }
  } finally {
    if (token === loadToken) isLoadingFiles.value = false;
  }
}
watch(selectedId, (folderId) => {
  selectedFileIds.value = new Set();
  // Opening a folder (from a subfolder row or the path) shows it in the tree.
  const folder = folderById.value.get(folderId);
  if (folder) {
    const next = new Set(collapsed.value);
    for (const item of folderPath(folder).slice(0, -1)) next.delete(item.id);
    collapsed.value = next;
  }
  loadFiles(folderId);
});

const allFilesSelected = computed(() => files.value.length > 0 && files.value.every((file) => selectedFileIds.value.has(file.id)));
function toggleFile(fileId) {
  const next = new Set(selectedFileIds.value);
  if (next.has(fileId)) next.delete(fileId);
  else next.add(fileId);
  selectedFileIds.value = next;
}
function toggleAllFiles() {
  selectedFileIds.value = allFilesSelected.value ? new Set() : new Set(files.value.map((file) => file.id));
}

// ---------- Where files are stored ----------
// New uploads go to Cloudflare R2 through /api/materials (signed links, the
// bucket stays private). Files uploaded before that stay in Supabase Storage
// (storage_provider 'supabase'). If the R2 endpoint is not set up (local dev,
// missing variables), uploads fall back to Supabase Storage.
let r2Unavailable = false;

async function materialsApi(payload) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('Your session has ended. Sign in again, then retry.');
  const response = await fetch('/api/materials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) {
    const error = new Error(body?.error || 'The server could not complete this request.');
    error.status = response.status;
    error.unavailable = response.status === 404 || (response.status === 503 && body?.error === 'r2_not_configured');
    throw error;
  }
  return body;
}

// Removes stored files and their rows: R2 ones through the server, Supabase
// ones directly. rows: [{ id, storage_path, storage_provider }].
async function removeStoredFiles(rows) {
  const r2Rows = rows.filter((row) => row.storage_provider === 'r2');
  const supabaseRows = rows.filter((row) => row.storage_provider !== 'r2');
  if (r2Rows.length) await materialsApi({ action: 'delete', materialIds: r2Rows.map((row) => row.id) });
  if (supabaseRows.length) {
    const { error: removeError } = await supabase.storage.from(BUCKET).remove(supabaseRows.map((row) => row.storage_path));
    if (removeError) throw removeError;
    const { error } = await supabase.from('materials').delete().in('id', supabaseRows.map((row) => row.id));
    if (error) throw error;
  }
}

async function deleteSelectedFiles() {
  const chosen = files.value.filter((file) => selectedFileIds.value.has(file.id));
  if (!chosen.length) return;
  const label = chosen.length === 1 ? `"${chosen[0].file_name}"` : `these ${chosen.length} files`;
  if (!confirmAction('Delete Files', `Delete ${label}? This can't be undone.`)) return;
  isDeletingFiles.value = true;
  try {
    await removeStoredFiles(chosen);
    selectedFileIds.value = new Set();
    await loadFiles(selectedId.value);
    loadFolders();
  } catch (error) {
    showAlert('Error Deleting Files', error.message);
  } finally {
    isDeletingFiles.value = false;
  }
}

const draggingFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes('Files');

function onPaneDragOver(event) {
  if (!draggingFiles(event)) return;
  // Always taken, so a drop never makes the browser open the file instead.
  event.preventDefault();
  isDragging.value = true;
}

function onPaneDrop(event) {
  if (!draggingFiles(event)) return;
  event.preventDefault();
  isDragging.value = false;
  const dropped = [...(event.dataTransfer?.files ?? [])];
  if (!dropped.length) return;
  if (!online.value) showNotice('You are offline. Uploading needs internet.', 'danger');
  else if (!props.isAdmin) showNotice('Only Admins can upload files.', 'danger');
  else if (!selectedFolder.value) showNotice('Open a folder first, or drop the files on a folder in the list.', 'danger');
  else uploadFiles(dropped, selectedFolder.value);
}

function onFolderDragOver(event, folder) {
  if (!canEdit.value || !draggingFiles(event)) return;
  event.preventDefault();
  dropFolderId.value = folder.id;
}

function onFolderDrop(event, folder) {
  if (!canEdit.value || !draggingFiles(event)) return;
  event.preventDefault();
  dropFolderId.value = null;
  const dropped = [...(event.dataTransfer?.files ?? [])];
  if (dropped.length) uploadFiles(dropped, folder);
}

function showNotice(text, tone = 'success') {
  clearTimeout(noticeTimer);
  uploadNotice.value = { text, tone };
  noticeTimer = setTimeout(() => {
    uploadNotice.value = null;
  }, 8000);
}

async function saveFolder() {
  const name = folderForm.value.name.trim();
  const description = folderForm.value.description.trim() || null;
  const parent_id = folderForm.value.parent_id || null;
  if (!name) {
    showAlert('Folder Name Required', 'Give the folder a name before saving.');
    return;
  }
  isSavingFolder.value = true;
  try {
    if (folderForm.value.id) {
      const { error } = await supabase.from('material_folders').update({ name, description, parent_id, updated_at: new Date().toISOString() }).eq('id', folderForm.value.id);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from('material_folders').insert([{ name, description, parent_id }]).select('id').single();
      if (error) throw error;
      selectedId.value = data.id;
    }
    folderForm.value = null;
    await loadFolders();
  } catch (error) {
    showAlert('Error Saving Folder', error.message);
  } finally {
    isSavingFolder.value = false;
  }
}

async function deleteFolder(folder) {
  // Subfolders go with it (the database cascades), so their files are counted too.
  const ids = descendantIds(folder.id);
  const inside = ids.length - 1;
  const fileTotal = ids.reduce((sum, id) => sum + (folderById.value.get(id)?.fileCount || 0), 0);
  const what = inside ? `${inside} subfolder${inside === 1 ? '' : 's'} and all ${fileTotal} file(s) in them` : `all ${fileTotal} file(s) in it`;
  if (!confirmAction('Delete Folder', `Delete "${folder.name}" and ${what}? This can't be undone.`)) return;
  try {
    // Deleting the rows doesn't remove the stored files, so those go first.
    const { data, error: listError } = await supabase.from('materials').select('id, storage_path, storage_provider').in('folder_id', ids);
    if (listError) throw listError;
    if (data?.length) await removeStoredFiles(data);
    const { error } = await supabase.from('material_folders').delete().eq('id', folder.id);
    if (error) throw error;
    selectedId.value = folder.parent_id || null;
    await loadFolders();
  } catch (error) {
    showAlert('Error Deleting Folder', error.message);
  }
}

function uploadChosenFiles(event) {
  const chosen = [...event.target.files];
  event.target.value = '';
  uploadFiles(chosen, selectedFolder.value);
}

function storageErrorMessage(xhr) {
  try {
    const body = JSON.parse(xhr.responseText);
    return body.message || body.error || `Upload failed (${xhr.status}).`;
  } catch {
    return `Upload failed (${xhr.status}).`;
  }
}

// Sends a file with XMLHttpRequest so the progress bar can follow the bytes.
function sendWithProgress(method, url, headers, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(storageErrorMessage(xhr))));
    xhr.onerror = () => reject(new Error('The connection dropped while uploading. Check your internet and try again.'));
    xhr.send(file);
  });
}

// Uploads one file and saves its materials row. Tries R2 first; returns the
// provider used.
async function storeFile(folder, file, onProgress) {
  const contentType = file.type || 'application/octet-stream';
  if (!r2Unavailable) {
    let ticket = null;
    try {
      ticket = await materialsApi({ action: 'upload-url', folderId: folder.id, fileName: file.name, contentType, size: file.size });
    } catch (error) {
      if (!error.unavailable) throw error;
      r2Unavailable = true;
    }
    if (ticket) {
      await sendWithProgress('PUT', ticket.url, { 'Content-Type': contentType }, file, onProgress);
      const { error: insertError } = await supabase.from('materials').insert([{ folder_id: folder.id, file_name: file.name, storage_path: ticket.key, storage_provider: 'r2', mime_type: contentType, size_bytes: file.size }]);
      if (insertError) {
        await materialsApi({ action: 'discard', key: ticket.key }).catch(() => null);
        throw insertError;
      }
      return 'r2';
    }
  }
  const storagePath = `${folder.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${storageSafeName(file.name)}`;
  await uploadWithProgress(storagePath, file, contentType, onProgress);
  const { error: insertError } = await supabase.from('materials').insert([{ folder_id: folder.id, file_name: file.name, storage_path: storagePath, mime_type: contentType, size_bytes: file.size }]);
  if (insertError) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    throw insertError;
  }
  return 'supabase';
}

// Uploads straight to Supabase Storage (the fallback when R2 is not set up).
async function uploadWithProgress(storagePath, file, contentType, onProgress) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Your session has ended. Sign in again, then retry.');
  const objectPath = storagePath.split('/').map(encodeURIComponent).join('/');
  await sendWithProgress('POST', `${supabaseUrl}/storage/v1/object/${BUCKET}/${objectPath}`, {
    Authorization: `Bearer ${token}`,
    apikey: supabaseAnonKey,
    'Content-Type': contentType,
    'x-upsert': 'false',
    'cache-control': 'max-age=3600',
  }, file, onProgress);
}

// Adds files to the upload queue for a folder. Files added while another
// upload runs wait their turn instead of being dropped.
function uploadFiles(chosen, folder) {
  if (!chosen.length || !folder) return;
  for (const file of chosen) uploadQueue.push({ file, folder });
  if (uploadProgress.value) {
    uploadProgress.value = { ...uploadProgress.value, total: uploadProgress.value.total + chosen.length };
    return;
  }
  runUploadQueue();
}

async function runUploadQueue() {
  const failures = [];
  const doneFolders = new Map();
  let originalBytes = 0;
  let storedBytes = 0;
  let uploaded = 0;
  uploadProgress.value = { done: 0, total: uploadQueue.length, name: '', size: 0, folderName: '', stage: 'Compressing', percent: 0 };
  while (uploadQueue.length) {
    const { file: original, folder } = uploadQueue.shift();
    const step = (fields) => {
      uploadProgress.value = { ...uploadProgress.value, ...fields };
    };
    step({ name: original.name, size: original.size, folderName: folder.name, stage: 'Compressing', percent: 0 });
    try {
      // Images and Office files are shrunk first (see lib/compress.js).
      const file = await compressForUpload(original, 'material');
      step({ stage: 'Uploading', size: file.size });
      await storeFile(folder, file, (fraction) => step({ percent: Math.round(fraction * 100), stage: fraction >= 1 ? 'Saving' : 'Uploading' }));
      uploaded += 1;
      originalBytes += original.size;
      storedBytes += file.size;
      doneFolders.set(folder.id, folder.name);
      if (folder.id === selectedId.value) loadFiles(folder.id);
    } catch (error) {
      failures.push(`${original.name}: ${error.message}`);
    }
    step({ done: uploadProgress.value.done + 1 });
  }
  uploadProgress.value = null;
  loadFolders();

  if (uploaded) {
    const where = doneFolders.size === 1 ? ` to "${[...doneFolders.values()][0]}"` : '';
    const saved = originalBytes - storedBytes > 10240 ? `, compressed from ${formatBytes(originalBytes)} (saved ${formatBytes(originalBytes - storedBytes)})` : '';
    showNotice(`Uploaded ${uploaded} file${uploaded === 1 ? '' : 's'}${where}: ${formatBytes(storedBytes)}${saved}.`);
  }
  if (failures.length) showAlert(uploaded ? 'Some Files Failed to Upload' : 'Upload Failed', failures.join('\n'));
}

async function deleteFile(file) {
  if (!confirmAction('Delete File', `Delete "${file.file_name}"? This can't be undone.`)) return;
  busyFileId.value = file.id;
  try {
    await removeStoredFiles([file]);
    await loadFiles(file.folder_id);
    loadFolders();
  } catch (error) {
    showAlert('Error Deleting File', error.message);
  } finally {
    busyFileId.value = null;
  }
}

async function openFile(file, download) {
  if (!download && isImage(file)) {
    viewImage(file);
    return;
  }
  // A copy saved on this device opens straight away, with or without internet.
  const local = await localFileUrl(file);
  if (local) {
    if (download) {
      const link = document.createElement('a');
      link.href = local;
      link.download = file.file_name;
      link.click();
    } else {
      window.open(local, '_blank', 'noopener');
    }
    return;
  }
  if (!online.value) {
    showAlert('Not Saved on This Device', `"${file.file_name}" can't be opened offline. Save its folder for offline while you have internet.`);
    return;
  }
  busyFileId.value = file.id;
  // Opened before the await, or browsers treat it as an unprompted popup.
  const opened = window.open('', '_blank');
  try {
    const signedUrl = await signedLink(file, download);
    if (opened) {
      opened.opener = null;
      opened.location.href = signedUrl;
    }
  } catch (error) {
    opened?.close();
    showAlert('Error Opening File', error.message);
  } finally {
    busyFileId.value = null;
  }
}

// Watches drags over the whole window. dragenter/dragleave fire for every
// element crossed, so a counter tells when the drag really left the page.
let dragDepth = 0;
const hasFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes('Files');
function onWindowDragEnter(event) {
  if (!canEdit.value || !hasFiles(event)) return;
  dragDepth += 1;
  isDraggingFiles.value = true;
}
function onWindowDragLeave(event) {
  if (!isDraggingFiles.value) return;
  dragDepth = Math.max(0, dragDepth - 1);
  // No relatedTarget means the drag left the browser window; the tree opening
  // up mid-drag can also swallow a dragleave, so this is the surer signal.
  const outside = event.clientX <= 0 || event.clientY <= 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight;
  if (dragDepth === 0 || (!event.relatedTarget && outside)) endWindowDrag();
}
function onWindowDragOver(event) {
  // A drop that misses every folder must not make the browser open the file.
  if (props.isAdmin && hasFiles(event)) event.preventDefault();
}
function onWindowDrop(event) {
  if (props.isAdmin && hasFiles(event)) event.preventDefault();
  endWindowDrag();
}
function endWindowDrag() {
  dragDepth = 0;
  isDraggingFiles.value = false;
  isDragging.value = false;
  dropFolderId.value = null;
}

onMounted(async () => {
  saved.value = await getSaved().catch(() => ({}));
  loadFolders();
  window.addEventListener('online', onBackOnline);
  window.addEventListener('dragenter', onWindowDragEnter);
  window.addEventListener('dragleave', onWindowDragLeave);
  window.addEventListener('dragover', onWindowDragOver);
  window.addEventListener('drop', onWindowDrop);
  window.addEventListener('dragend', endWindowDrag);
});
onBeforeUnmount(() => {
  window.removeEventListener('dragenter', onWindowDragEnter);
  window.removeEventListener('dragleave', onWindowDragLeave);
  window.removeEventListener('dragover', onWindowDragOver);
  window.removeEventListener('drop', onWindowDrop);
  window.removeEventListener('dragend', endWindowDrag);
  window.removeEventListener('online', onBackOnline);
  for (const url of localUrls.values()) URL.revokeObjectURL(url);
  clearTimeout(noticeTimer);
});
</script>

<template>
  <div class="page">
    <div class="mat" :class="{ 'has-selection': selectedFolder, 'dragging-files': isDraggingFiles }">
      <section class="card pane-folders">
        <header class="card-head">
          <div>
            <h1 class="card-title">Materials</h1>
            <p class="card-sub">{{ folders.length }} folder{{ folders.length === 1 ? '' : 's' }}</p>
          </div>
          <button v-if="canEdit" class="btn btn-primary btn-sm" @click="newFolder()"><Plus :size="14" />New Folder</button>
        </header>
        <div v-if="!online" class="offline-banner" role="status"><CloudOff :size="15" />You're offline. Folders saved on this device still open.</div>
        <div v-if="offlineSave" class="move-banner" role="status">
          <span class="grow">Saving "{{ offlineSave.name }}" for offline… {{ offlineSave.total ? `${offlineSave.done} of ${offlineSave.total}` : '' }}</span>
          <span class="spinner sm" />
        </div>
        <div v-if="canEdit && (supabaseFileCount || moveState)" class="move-banner">
          <span class="grow">{{ moveState ? `Moving to Cloudflare R2… ${moveState.moved} of ${moveState.total}` : `${supabaseFileCount} file${supabaseFileCount === 1 ? '' : 's'} still in Supabase Storage` }}</span>
          <button v-if="!moveState" class="btn btn-sm" @click="moveAllToR2"><UploadCloud :size="14" />Move to Cloudflare R2</button>
          <span v-else class="spinner sm" />
        </div>
        <div v-if="isDraggingFiles" class="drag-banner"><UploadCloud :size="15" />Drop on any folder below to upload there</div>
        <div v-else class="folder-search"><SearchInput v-model="folderSearch" placeholder="Search folders" /></div>
        <LoadingBlock v-if="isLoadingFolders && !folders.length" />
        <p v-else-if="!visibleFolders.length" class="empty">{{ folders.length ? 'No folders match your search.' : isAdmin ? 'No folders yet. Create one to start uploading.' : 'No materials have been shared yet.' }}</p>
        <div
          v-for="{ folder, depth, path, hasChildren } in visibleFolders"
          :key="folder.id"
          class="folder tree-row"
          :class="{ on: folder.id === selectedId, 'drop-target': folder.id === dropFolderId }"
          @dragover="onFolderDragOver($event, folder)"
          @dragleave="dropFolderId === folder.id && (dropFolderId = null)"
          @drop="onFolderDrop($event, folder)"
          :style="{ paddingLeft: `${12 + depth * 18}px` }"
          role="button"
          tabindex="0"
          @click="selectedId = folder.id"
          @keydown.enter.prevent="selectedId = folder.id"
        >
          <button v-if="hasChildren" class="twisty" :aria-label="collapsed.has(folder.id) ? `Show folders inside ${folder.name}` : `Hide folders inside ${folder.name}`" :aria-expanded="!collapsed.has(folder.id)" @click.stop="toggleFolder(folder.id)">
            <ChevronRight :size="14" :class="{ open: !collapsed.has(folder.id) }" />
          </button>
          <span v-else class="twisty-space" />
          <span class="icon-chip"><component :is="folder.id === selectedId ? FolderOpen : Folder" :size="16" /></span>
          <span class="grow">
            <span v-if="path" class="muted small block clamp">{{ path }} /</span>
            <span class="strong block clamp">{{ folder.name }}</span>
            <span v-if="folder.description" class="muted small block two-line">{{ folder.description }}</span>
          </span>
          <button v-if="canEdit" class="row-add" :aria-label="`New folder inside ${folder.name}`" title="New subfolder" @click.stop="newFolder(folder.id)"><FolderPlus :size="14" /></button>
          <HardDriveDownload v-if="isFolderSaved(folder.id)" class="saved-mark" :size="13" aria-label="Saved on this device" />
          <span class="muted small">{{ folder.fileCount }}</span>
          <ChevronRight class="m-only muted" :size="16" />
        </div>
      </section>

      <section
        class="card pane-files"
        :class="{ dragging: isDragging }"
        @dragover="onPaneDragOver"
        @dragleave.self="isDragging = false"
        @drop="onPaneDrop"
      >
        <div v-if="isDragging" class="drop-hint">
          <UploadCloud :size="28" />
          <p v-if="!isAdmin">Only Admins can upload files.</p>
          <p v-else-if="selectedFolder">Drop to upload to "{{ selectedFolder.name }}"</p>
          <p v-else>Open a folder first, or drop on a folder in the list.</p>
        </div>
        <div v-if="uploadProgress" class="upload-panel" role="status" aria-live="polite">
          <div class="upload-line">
            <UploadCloud :size="16" />
            <span class="grow clamp"><strong>{{ uploadProgress.stage }}</strong> {{ uploadProgress.name }} <span class="muted">· {{ formatBytes(uploadProgress.size) }} · to "{{ uploadProgress.folderName }}"</span></span>
            <span class="muted small nowrap">{{ Math.min(uploadProgress.done + 1, uploadProgress.total) }} of {{ uploadProgress.total }}</span>
          </div>
          <div class="upload-bar"><span :class="{ busy: uploadProgress.stage !== 'Uploading' }" :style="{ width: `${uploadProgress.stage === 'Uploading' ? uploadProgress.percent : 100}%` }" /></div>
          <p v-if="uploadProgress.stage === 'Uploading'" class="muted small">{{ uploadProgress.percent }}% sent. Keep this page open until it finishes.</p>
        </div>
        <div v-if="uploadNotice" class="upload-notice" :class="uploadNotice.tone">
          <span class="grow">{{ uploadNotice.text }}</span>
          <button class="link-btn" @click="uploadNotice = null">Dismiss</button>
        </div>
        <div v-if="!selectedFolder" class="placeholder"><FolderOpen :size="30" /><p>Select a folder to see its files.</p></div>
        <template v-else>
          <header class="card-head">
            <button class="icon-btn m-only" aria-label="Back to folders" @click="selectedId = null"><ChevronLeft :size="20" /></button>
            <div class="grow head-text">
              <nav v-if="breadcrumb.length" class="crumbs small" aria-label="Folder path">
                <template v-for="item in breadcrumb" :key="item.id"><button class="link-btn" @click="selectedId = item.id">{{ item.name }}</button><span class="muted">/</span></template>
              </nav>
              <h2 class="card-title">{{ selectedFolder.name }}</h2>
              <p v-if="selectedFolder.description" class="card-sub">{{ selectedFolder.description }}</p>
              <p v-if="files.length" class="card-sub">{{ files.length }} file{{ files.length === 1 ? '' : 's' }} · {{ formatBytes(folderBytes) }}</p>
              <p v-if="savedRoot" class="saved-line small">
                <HardDriveDownload :size="13" />
                <span>Saved on this device<template v-if="savedRootId !== selectedFolder.id"> with "{{ savedRoot.name }}"</template> · updated {{ formatSynced(savedRoot.syncedAt) }}</span>
                <button v-if="savedRootId === selectedFolder.id" class="link-btn" @click="removeOffline(savedRootId)">Remove from device</button>
              </p>
            </div>
            <button v-if="!savedRoot" class="btn btn-sm" :disabled="!online || !!offlineSave" :title="online ? 'Keep this folder on this device to open without internet' : 'Needs internet'" @click="saveOffline(selectedFolder)"><HardDriveDownload :size="14" />Save Offline</button>
            <div v-if="canEdit" class="row row-wrap">
              <button class="link-btn" @click="folderForm = { id: selectedFolder.id, name: selectedFolder.name, description: selectedFolder.description || '', parent_id: selectedFolder.parent_id || null }"><Pencil :size="13" />Edit</button>
              <button class="link-btn danger" @click="deleteFolder(selectedFolder)"><Trash2 :size="13" />Delete</button>
              <button class="btn btn-sm" @click="shareTarget = { type: 'folder', id: selectedFolder.id, name: selectedFolder.name }"><QrCode :size="14" />Share</button>
              <button class="btn btn-sm" @click="newFolder(selectedFolder.id)"><FolderPlus :size="14" />New Subfolder</button>
              <input ref="fileInput" type="file" multiple hidden @change="uploadChosenFiles" />
              <button class="btn btn-primary btn-sm" @click="fileInput.click()"><UploadCloud :size="14" />Upload Files</button>
            </div>
          </header>
          <div v-for="child in subfolders" :key="child.id" class="folder" role="button" tabindex="0" @click="selectedId = child.id" @keydown.enter.prevent="selectedId = child.id">
            <span class="icon-chip"><Folder :size="16" /></span>
            <span class="grow">
              <span class="strong block clamp">{{ child.name }}</span>
              <span v-if="child.description" class="muted small block two-line">{{ child.description }}</span>
            </span>
            <span class="muted small">{{ child.fileCount }} file{{ child.fileCount === 1 ? '' : 's' }}</span>
            <button v-if="canEdit" class="link-btn danger" @click.stop="deleteFolder(child)"><Trash2 :size="13" />Delete</button>
            <ChevronRight class="muted" :size="16" />
          </div>
          <div v-if="canEdit && files.length" class="select-bar">
            <label class="check"><input type="checkbox" :checked="allFilesSelected" :indeterminate.prop="selectedFileIds.size > 0 && !allFilesSelected" @change="toggleAllFiles" />{{ selectedFileIds.size ? `${selectedFileIds.size} selected` : 'Select all files' }}</label>
            <template v-if="selectedFileIds.size">
              <button class="btn btn-sm danger-btn" :disabled="isDeletingFiles" @click="deleteSelectedFiles"><Trash2 :size="14" />{{ isDeletingFiles ? 'Deleting…' : `Delete ${selectedFileIds.size === 1 ? 'file' : `${selectedFileIds.size} files`}` }}</button>
              <button class="link-btn" @click="selectedFileIds = new Set()">Clear</button>
            </template>
          </div>
          <LoadingBlock v-if="isLoadingFiles && !files.length" />
          <p v-else-if="!online && !files.length && !savedRoot" class="empty">This folder isn't saved on this device. Use "Save Offline" next time you have internet to open it without a connection.</p>
          <p v-else-if="!files.length && !subfolders.length" class="empty">{{ isAdmin ? 'This folder is empty. Drag files here or use "Upload Files" to add PDFs, slides, documents, images, videos, or audio, or "New Subfolder" to add a folder inside it.' : 'This folder is empty.' }}</p>
          <div v-for="file in files" :key="file.id" class="file" :class="{ picked: selectedFileIds.has(file.id) }">
            <input v-if="canEdit" type="checkbox" class="file-check" :checked="selectedFileIds.has(file.id)" :aria-label="`Select ${file.file_name}`" @change="toggleFile(file.id)" />
            <button v-if="isImage(file)" class="thumb" :aria-label="`View ${file.file_name}`" @click="viewImage(file)">
              <img v-if="thumbnails[file.id]" :src="thumbnails[file.id]" alt="" loading="lazy" />
              <FileImage v-else :size="16" />
            </button>
            <span v-else class="icon-chip"><component :is="fileKind(file).icon" :size="16" /></span>
            <div class="grow">
              <p class="strong two-line">{{ file.file_name }}</p>
              <p class="muted small clamp">{{ fileMeta(file) }}<template v-if="canEdit && file.storage_provider !== 'r2'"> · in Supabase Storage</template></p>
            </div>
            <span v-if="file.size_bytes != null" class="size-chip" :title="`${file.size_bytes.toLocaleString()} bytes`">{{ formatBytes(file.size_bytes) }}</span>
            <span v-if="busyFileId === file.id" class="spinner sm" />
            <div v-else class="row file-actions">
              <button class="link-btn" @click="openFile(file, false)"><Eye :size="13" />Open</button>
              <button class="link-btn" @click="openFile(file, true)"><Download :size="13" />Download</button>
              <button v-if="canEdit" class="link-btn" @click="shareTarget = { type: 'file', id: file.id, name: file.file_name }"><QrCode :size="13" />Share</button>
              <button v-if="canEdit" class="link-btn danger" @click="deleteFile(file)"><Trash2 :size="13" />Delete</button>
            </div>
          </div>
        </template>
      </section>
    </div>

    <MaterialShareModal v-if="shareTarget" :target="shareTarget" @close="shareTarget = null" />

    <ImageViewer
      v-if="viewer && viewerImages.length"
      v-model:index="viewer.index"
      :images="viewerImages"
      @need-url="fetchViewerUrl"
      @download="downloadFromViewer"
      @close="viewer = null"
    />

    <AppModal v-if="folderForm" :title="folderForm.id ? 'Edit Folder' : folderForm.parent_id ? 'New Subfolder' : 'New Folder'" :locked="isSavingFolder" @close="folderForm = null">
      <div class="stack">
        <label class="field"><span class="field-label">Name</span><input v-model="folderForm.name" class="input" placeholder="e.g. CLP Talk 1 Materials" /></label>
        <label class="field"><span class="field-label">Put inside</span>
          <select v-model="folderForm.parent_id" class="select">
            <option :value="null">Top level (no parent folder)</option>
            <option v-for="{ folder, depth } in parentOptions" :key="folder.id" :value="folder.id">{{ '\u00a0\u00a0'.repeat(depth) }}{{ folder.name }}</option>
          </select>
        </label>
        <label class="field"><span class="field-label">Description</span><textarea v-model="folderForm.description" class="textarea" placeholder="What's in this folder and who it's for" /></label>
      </div>
      <template #footer>
        <button class="btn" :disabled="isSavingFolder" @click="folderForm = null">Cancel</button>
        <button class="btn btn-primary" :disabled="isSavingFolder" @click="saveFolder">{{ folderForm.id ? 'Save' : 'Create Folder' }}</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.mat { display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: 18px; align-items: start; }
.folder-search { padding: 0 20px 12px; }
.folder { width: 100%; display: flex; align-items: center; gap: 10px; padding: 10px 20px; border: 0; border-top: 1px solid var(--line); background: none; text-align: left; font-size: 13px; }
.folder:hover { background: var(--surface-hover); }
.folder.on { background: var(--accent-soft); }
.block { display: block; }
.two-line { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.file { display: flex; align-items: center; gap: 12px; padding: 12px 20px; border-top: 1px solid var(--line); font-size: 13px; flex-wrap: wrap; }
.file-actions { gap: 14px; }
.size-chip { flex: none; padding: 2px 8px; border-radius: 999px; background: var(--surface-hover); border: 1px solid var(--line); font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.placeholder { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 60px 20px; color: var(--muted); font-size: 13px; }
.head-text { min-width: 180px; }
.tree-row { gap: 8px; cursor: pointer; }
.twisty, .twisty-space { width: 22px; height: 22px; flex: none; }
.twisty { display: inline-flex; align-items: center; justify-content: center; border: 0; background: none; color: var(--muted); border-radius: 6px; padding: 0; cursor: pointer; }
.twisty:hover { background: var(--surface-hover); color: inherit; }
.twisty svg { transition: transform 0.15s ease; }
.twisty svg.open { transform: rotate(90deg); }
.row-add { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; flex: none; border: 0; border-radius: 6px; background: none; color: var(--muted); cursor: pointer; opacity: 0; transition: opacity 0.12s ease; }
.tree-row:hover .row-add, .tree-row:focus-within .row-add, .tree-row.on .row-add { opacity: 1; }
.row-add:hover { background: var(--surface); color: var(--accent, inherit); }
.folder[role='button'] { cursor: pointer; }
.pane-files { position: relative; }
.pane-files.dragging { outline: 2px dashed var(--accent, #4f46e5); outline-offset: -6px; }
.drop-hint { position: absolute; inset: 0; z-index: 2; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; background: color-mix(in srgb, var(--surface, #fff) 88%, transparent); border-radius: inherit; font-size: 14px; font-weight: 600; pointer-events: none; }
.upload-panel { display: grid; gap: 6px; padding: 12px 20px; border-bottom: 1px solid var(--line); background: var(--accent-soft); font-size: 13px; }
.upload-line { display: flex; align-items: center; gap: 8px; min-width: 0; }
.nowrap { white-space: nowrap; }
.upload-bar { height: 6px; border-radius: 999px; background: var(--line); overflow: hidden; }
.upload-bar span { display: block; height: 100%; border-radius: inherit; background: var(--accent, #4f46e5); transition: width 0.2s ease; }
.upload-bar span.busy { background: linear-gradient(90deg, var(--accent, #4f46e5) 0 30%, transparent 30% 100%); background-size: 200% 100%; animation: upload-busy 1.1s linear infinite; }
@keyframes upload-busy { from { background-position: 100% 0; } to { background-position: -100% 0; } }
.upload-notice { display: flex; align-items: center; gap: 12px; padding: 10px 20px; border-bottom: 1px solid var(--line); font-size: 13px; }
.upload-notice.success { background: color-mix(in srgb, #16a34a 12%, transparent); }
.upload-notice.danger { background: color-mix(in srgb, #dc2626 12%, transparent); }
.folder.drop-target { background: var(--accent-soft); outline: 2px dashed var(--accent, #4f46e5); outline-offset: -3px; }
@media (prefers-reduced-motion: reduce) { .upload-bar span.busy { animation: none; } }
.thumb { flex: none; width: 44px; height: 44px; padding: 0; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--surface-hover); display: inline-flex; align-items: center; justify-content: center; color: var(--muted); cursor: zoom-in; }
.thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.offline-banner { display: flex; align-items: center; gap: 8px; margin: 0 20px 12px; padding: 9px 12px; border-radius: var(--radius-md, 8px); background: color-mix(in srgb, #f59e0b 16%, transparent); font-size: 13px; font-weight: 600; }
.saved-mark { flex: none; color: var(--accent, #4f46e5); }
.saved-line { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 4px 0 0; color: var(--accent, #4f46e5); }
.saved-line span { color: var(--muted); }
.move-banner { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 0 20px 12px; padding: 9px 12px; border-radius: var(--radius-md, 8px); border: 1px solid var(--line); background: var(--surface-hover); font-size: 13px; }
.drag-banner { display: flex; align-items: center; gap: 8px; margin: 0 20px 12px; padding: 9px 12px; border-radius: var(--radius-md, 8px); border: 1px dashed var(--accent, #4f46e5); background: var(--accent-soft); font-size: 13px; font-weight: 600; }
.dragging-files .tree-row { outline: 1px dashed var(--line); outline-offset: -3px; }
.dragging-files .tree-row.drop-target { outline: 2px dashed var(--accent, #4f46e5); }
.select-bar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 10px 20px; border-top: 1px solid var(--line); font-size: 13px; background: var(--surface-hover); }
.check { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
.file.picked { background: var(--accent-soft); }
.file-check { flex: none; width: 16px; height: 16px; cursor: pointer; }
.danger-btn { color: var(--danger, #b91c1c); }
@media (hover: none) { .row-add { opacity: 1; } }
.crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-bottom: 2px; }
.m-only { display: none; }
@media (max-width: 819.98px) {
  .mat { grid-template-columns: minmax(0, 1fr); }
  .m-only { display: inline-flex; }
  .pane-files { display: none; }
  .has-selection .pane-folders { display: none; }
  .has-selection .pane-files { display: block; }
  /* While dragging files, the folder list shows even with a folder open. */
  .has-selection.dragging-files .pane-folders { display: block; }
}
</style>
