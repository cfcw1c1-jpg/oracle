<script setup>
import { Archive, ChevronLeft, ChevronRight, Download, Eye, File, FileImage, FileSpreadsheet, FileText, Film, Folder, FolderOpen, FolderPlus, Music, Paperclip, Pencil, Plus, Presentation, Trash2, UploadCloud } from 'lucide-vue-next';
import { computed, onMounted, ref, watch } from 'vue';
import AppModal from '@/components/AppModal.vue';
import LoadingBlock from '@/components/LoadingBlock.vue';
import SearchInput from '@/components/SearchInput.vue';
import { compressForUpload } from '@/lib/compress';
import { confirmAction, showAlert } from '@/lib/data';
import { supabase } from '@/lib/supabase';

defineProps({ isAdmin: Boolean });

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
// Folders whose subfolders are hidden in the tree.
const collapsed = ref(new Set());
const selectedFileIds = ref(new Set());
const isDeletingFiles = ref(false);
const isDragging = ref(false);

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
      if (!collapsed.value.has(folder.id)) walk(folder.id, depth + 1, new Set([...seen, folder.id]));
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
  if (!query) return folderTree.value;
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

async function loadFolders() {
  try {
    const { data, error } = await supabase.from('material_folders').select('id, name, description, parent_id, created_at, materials ( count )').order('name', { ascending: true });
    if (error) throw error;
    folders.value = (data || []).map((folder) => ({ ...folder, fileCount: folder.materials?.[0]?.count || 0 }));
    const stillExists = folders.value.some((folder) => folder.id === selectedId.value);
    if (!stillExists) selectedId.value = window.matchMedia('(min-width: 820px)').matches ? folders.value[0]?.id || null : null;
  } catch (error) {
    showAlert('Error Loading Folders', error.message);
  } finally {
    isLoadingFolders.value = false;
  }
}

let loadToken = 0;
async function loadFiles(folderId) {
  const token = ++loadToken;
  files.value = [];
  if (!folderId) return;
  isLoadingFiles.value = true;
  try {
    const { data, error } = await supabase.from('materials').select('id, folder_id, file_name, storage_path, mime_type, size_bytes, created_at').eq('folder_id', folderId).order('created_at', { ascending: false });
    if (error) throw error;
    if (token === loadToken) files.value = data || [];
  } catch (error) {
    showAlert('Error Loading Files', error.message);
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

async function deleteSelectedFiles() {
  const chosen = files.value.filter((file) => selectedFileIds.value.has(file.id));
  if (!chosen.length) return;
  const label = chosen.length === 1 ? `"${chosen[0].file_name}"` : `these ${chosen.length} files`;
  if (!confirmAction('Delete Files', `Delete ${label}? This can't be undone.`)) return;
  isDeletingFiles.value = true;
  try {
    const { error: removeError } = await supabase.storage.from(BUCKET).remove(chosen.map((file) => file.storage_path));
    if (removeError) throw removeError;
    const { error } = await supabase.from('materials').delete().in('id', chosen.map((file) => file.id));
    if (error) throw error;
    selectedFileIds.value = new Set();
    await loadFiles(selectedId.value);
    loadFolders();
  } catch (error) {
    showAlert('Error Deleting Files', error.message);
  } finally {
    isDeletingFiles.value = false;
  }
}

function onDrop(event) {
  isDragging.value = false;
  const dropped = [...(event.dataTransfer?.files ?? [])];
  if (dropped.length) uploadFiles(dropped);
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
    const { data, error: listError } = await supabase.from('materials').select('storage_path').in('folder_id', ids);
    if (listError) throw listError;
    const paths = (data || []).map((row) => row.storage_path);
    if (paths.length) {
      const { error } = await supabase.storage.from(BUCKET).remove(paths);
      if (error) throw error;
    }
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
  uploadFiles(chosen);
}

async function uploadFiles(chosen) {
  const folder = selectedFolder.value;
  if (!chosen.length || !folder || uploadProgress.value) return;

  const failures = [];
  let originalBytes = 0;
  let storedBytes = 0;
  uploadProgress.value = { done: 0, total: chosen.length, stage: 'Compressing' };
  for (const [index, original] of chosen.entries()) {
    // Images and Office files are shrunk first (see lib/compress.js).
    uploadProgress.value = { ...uploadProgress.value, stage: 'Compressing' };
    const file = await compressForUpload(original, 'material');
    uploadProgress.value = { ...uploadProgress.value, stage: 'Uploading' };
    const storagePath = `${folder.id}/${Date.now()}-${index}-${storageSafeName(file.name)}`;
    const contentType = file.type || 'application/octet-stream';
    try {
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, file, { contentType, upsert: false });
      if (uploadError) throw uploadError;
      const { error: insertError } = await supabase.from('materials').insert([{ folder_id: folder.id, file_name: file.name, storage_path: storagePath, mime_type: contentType, size_bytes: file.size }]);
      if (insertError) {
        await supabase.storage.from(BUCKET).remove([storagePath]);
        throw insertError;
      }
      originalBytes += original.size;
      storedBytes += file.size;
    } catch (error) {
      failures.push(`${original.name}: ${error.message}`);
    }
    uploadProgress.value = { ...uploadProgress.value, done: index + 1 };
  }
  uploadProgress.value = null;
  if (failures.length) showAlert('Some Files Failed to Upload', failures.join('\n'));
  else if (originalBytes - storedBytes > 10240) {
    showAlert('Files Uploaded', `Compressed from ${formatBytes(originalBytes)} to ${formatBytes(storedBytes)} (saved ${formatBytes(originalBytes - storedBytes)}).`);
  }
  loadFiles(folder.id);
  loadFolders();
}

async function deleteFile(file) {
  if (!confirmAction('Delete File', `Delete "${file.file_name}"? This can't be undone.`)) return;
  busyFileId.value = file.id;
  try {
    const { error: removeError } = await supabase.storage.from(BUCKET).remove([file.storage_path]);
    if (removeError) throw removeError;
    const { error } = await supabase.from('materials').delete().eq('id', file.id);
    if (error) throw error;
    await loadFiles(file.folder_id);
    loadFolders();
  } catch (error) {
    showAlert('Error Deleting File', error.message);
  } finally {
    busyFileId.value = null;
  }
}

async function openFile(file, download) {
  busyFileId.value = file.id;
  // Opened before the await, or browsers treat it as an unprompted popup.
  const opened = window.open('', '_blank');
  try {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(file.storage_path, SIGNED_URL_TTL_SECONDS, download ? { download: file.file_name } : undefined);
    if (error) throw error;
    if (opened) {
      opened.opener = null;
      opened.location.href = data.signedUrl;
    }
  } catch (error) {
    opened?.close();
    showAlert('Error Opening File', error.message);
  } finally {
    busyFileId.value = null;
  }
}

onMounted(loadFolders);
</script>

<template>
  <div class="page">
    <div class="mat" :class="{ 'has-selection': selectedFolder }">
      <section class="card pane-folders">
        <header class="card-head">
          <div>
            <h1 class="card-title">Materials</h1>
            <p class="card-sub">{{ folders.length }} folder{{ folders.length === 1 ? '' : 's' }}</p>
          </div>
          <button v-if="isAdmin" class="btn btn-primary btn-sm" @click="newFolder()"><Plus :size="14" />New Folder</button>
        </header>
        <div class="folder-search"><SearchInput v-model="folderSearch" placeholder="Search folders" /></div>
        <LoadingBlock v-if="isLoadingFolders && !folders.length" />
        <p v-else-if="!visibleFolders.length" class="empty">{{ folders.length ? 'No folders match your search.' : isAdmin ? 'No folders yet. Create one to start uploading.' : 'No materials have been shared yet.' }}</p>
        <div
          v-for="{ folder, depth, path, hasChildren } in visibleFolders"
          :key="folder.id"
          class="folder tree-row"
          :class="{ on: folder.id === selectedId }"
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
          <button v-if="isAdmin" class="row-add" :aria-label="`New folder inside ${folder.name}`" title="New subfolder" @click.stop="newFolder(folder.id)"><FolderPlus :size="14" /></button>
          <span class="muted small">{{ folder.fileCount }}</span>
          <ChevronRight class="m-only muted" :size="16" />
        </div>
      </section>

      <section
        class="card pane-files"
        :class="{ dragging: isDragging }"
        @dragover.prevent="isDragging = isAdmin && !!selectedFolder"
        @dragleave.self="isDragging = false"
        @drop.prevent="isAdmin && selectedFolder ? onDrop($event) : (isDragging = false)"
      >
        <div v-if="isDragging" class="drop-hint"><UploadCloud :size="28" /><p>Drop files to upload them to "{{ selectedFolder?.name }}"</p></div>
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
            </div>
            <div v-if="isAdmin" class="row row-wrap">
              <button class="link-btn" @click="folderForm = { id: selectedFolder.id, name: selectedFolder.name, description: selectedFolder.description || '', parent_id: selectedFolder.parent_id || null }"><Pencil :size="13" />Edit</button>
              <button class="link-btn danger" @click="deleteFolder(selectedFolder)"><Trash2 :size="13" />Delete</button>
              <button class="btn btn-sm" @click="newFolder(selectedFolder.id)"><FolderPlus :size="14" />New Subfolder</button>
              <input ref="fileInput" type="file" multiple hidden @change="uploadChosenFiles" />
              <button class="btn btn-primary btn-sm" :disabled="!!uploadProgress" @click="fileInput.click()"><UploadCloud :size="14" />{{ uploadProgress ? `${uploadProgress.stage} ${Math.min(uploadProgress.done + 1, uploadProgress.total)}/${uploadProgress.total}` : 'Upload Files' }}</button>
            </div>
          </header>
          <div v-for="child in subfolders" :key="child.id" class="folder" role="button" tabindex="0" @click="selectedId = child.id" @keydown.enter.prevent="selectedId = child.id">
            <span class="icon-chip"><Folder :size="16" /></span>
            <span class="grow">
              <span class="strong block clamp">{{ child.name }}</span>
              <span v-if="child.description" class="muted small block two-line">{{ child.description }}</span>
            </span>
            <span class="muted small">{{ child.fileCount }} file{{ child.fileCount === 1 ? '' : 's' }}</span>
            <button v-if="isAdmin" class="link-btn danger" @click.stop="deleteFolder(child)"><Trash2 :size="13" />Delete</button>
            <ChevronRight class="muted" :size="16" />
          </div>
          <div v-if="isAdmin && files.length" class="select-bar">
            <label class="check"><input type="checkbox" :checked="allFilesSelected" :indeterminate.prop="selectedFileIds.size > 0 && !allFilesSelected" @change="toggleAllFiles" />{{ selectedFileIds.size ? `${selectedFileIds.size} selected` : 'Select all files' }}</label>
            <template v-if="selectedFileIds.size">
              <button class="btn btn-sm danger-btn" :disabled="isDeletingFiles" @click="deleteSelectedFiles"><Trash2 :size="14" />{{ isDeletingFiles ? 'Deleting…' : `Delete ${selectedFileIds.size === 1 ? 'file' : `${selectedFileIds.size} files`}` }}</button>
              <button class="link-btn" @click="selectedFileIds = new Set()">Clear</button>
            </template>
          </div>
          <LoadingBlock v-if="isLoadingFiles && !files.length" />
          <p v-else-if="!files.length && !subfolders.length" class="empty">{{ isAdmin ? 'This folder is empty. Drag files here or use "Upload Files" to add PDFs, slides, documents, videos, or audio, or "New Subfolder" to add a folder inside it.' : 'This folder is empty.' }}</p>
          <div v-for="file in files" :key="file.id" class="file" :class="{ picked: selectedFileIds.has(file.id) }">
            <input v-if="isAdmin" type="checkbox" class="file-check" :checked="selectedFileIds.has(file.id)" :aria-label="`Select ${file.file_name}`" @change="toggleFile(file.id)" />
            <span class="icon-chip"><component :is="fileKind(file).icon" :size="16" /></span>
            <div class="grow">
              <p class="strong two-line">{{ file.file_name }}</p>
              <p class="muted small clamp">{{ fileMeta(file) }}</p>
            </div>
            <span v-if="file.size_bytes != null" class="size-chip" :title="`${file.size_bytes.toLocaleString()} bytes`">{{ formatBytes(file.size_bytes) }}</span>
            <span v-if="busyFileId === file.id" class="spinner sm" />
            <div v-else class="row file-actions">
              <button class="link-btn" @click="openFile(file, false)"><Eye :size="13" />Open</button>
              <button class="link-btn" @click="openFile(file, true)"><Download :size="13" />Download</button>
              <button v-if="isAdmin" class="link-btn danger" @click="deleteFile(file)"><Trash2 :size="13" />Delete</button>
            </div>
          </div>
        </template>
      </section>
    </div>

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
}
</style>
