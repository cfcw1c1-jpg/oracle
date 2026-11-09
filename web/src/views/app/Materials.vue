<script setup>
import { Archive, ChevronLeft, ChevronRight, Download, Eye, File, FileImage, FileSpreadsheet, FileText, Film, Folder, FolderOpen, Music, Paperclip, Pencil, Plus, Presentation, Trash2, UploadCloud } from 'lucide-vue-next';
import { computed, onMounted, ref, watch } from 'vue';
import AppModal from '@/components/AppModal.vue';
import LoadingBlock from '@/components/LoadingBlock.vue';
import SearchInput from '@/components/SearchInput.vue';
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

const selectedFolder = computed(() => folders.value.find((folder) => folder.id === selectedId.value) || null);
const visibleFolders = computed(() => {
  const query = folderSearch.value.trim().toLowerCase();
  return query ? folders.value.filter((folder) => folder.name.toLowerCase().includes(query) || (folder.description || '').toLowerCase().includes(query)) : folders.value;
});

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
  return [fileKind(file).label, formatBytes(file.size_bytes), date].filter(Boolean).join(' · ');
}

function storageSafeName(name) {
  return (name || 'file').normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-120);
}

async function loadFolders() {
  try {
    const { data, error } = await supabase.from('material_folders').select('id, name, description, created_at, materials ( count )').order('name', { ascending: true });
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
watch(selectedId, loadFiles);

async function saveFolder() {
  const name = folderForm.value.name.trim();
  const description = folderForm.value.description.trim() || null;
  if (!name) {
    showAlert('Folder Name Required', 'Give the folder a name before saving.');
    return;
  }
  isSavingFolder.value = true;
  try {
    if (folderForm.value.id) {
      const { error } = await supabase.from('material_folders').update({ name, description, updated_at: new Date().toISOString() }).eq('id', folderForm.value.id);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from('material_folders').insert([{ name, description }]).select('id').single();
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
  if (!confirmAction('Delete Folder', `Delete "${folder.name}" and all ${folder.fileCount} file(s) in it? This can't be undone.`)) return;
  try {
    // Deleting the rows doesn't remove the stored files, so those go first.
    const { data, error: listError } = await supabase.from('materials').select('storage_path').eq('folder_id', folder.id);
    if (listError) throw listError;
    const paths = (data || []).map((row) => row.storage_path);
    if (paths.length) {
      const { error } = await supabase.storage.from(BUCKET).remove(paths);
      if (error) throw error;
    }
    const { error } = await supabase.from('material_folders').delete().eq('id', folder.id);
    if (error) throw error;
    selectedId.value = null;
    await loadFolders();
  } catch (error) {
    showAlert('Error Deleting Folder', error.message);
  }
}

async function uploadChosenFiles(event) {
  const chosen = [...event.target.files];
  event.target.value = '';
  const folder = selectedFolder.value;
  if (!chosen.length || !folder || uploadProgress.value) return;

  const failures = [];
  uploadProgress.value = { done: 0, total: chosen.length };
  for (const [index, file] of chosen.entries()) {
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
    } catch (error) {
      failures.push(`${file.name}: ${error.message}`);
    }
    uploadProgress.value = { done: index + 1, total: chosen.length };
  }
  uploadProgress.value = null;
  if (failures.length) showAlert('Some Files Failed to Upload', failures.join('\n'));
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
          <button v-if="isAdmin" class="btn btn-primary btn-sm" @click="folderForm = { name: '', description: '' }"><Plus :size="14" />New Folder</button>
        </header>
        <div class="folder-search"><SearchInput v-model="folderSearch" placeholder="Search folders" /></div>
        <LoadingBlock v-if="isLoadingFolders && !folders.length" />
        <p v-else-if="!visibleFolders.length" class="empty">{{ folders.length ? 'No folders match your search.' : isAdmin ? 'No folders yet. Create one to start uploading.' : 'No materials have been shared yet.' }}</p>
        <button v-for="folder in visibleFolders" :key="folder.id" class="folder" :class="{ on: folder.id === selectedId }" @click="selectedId = folder.id">
          <span class="icon-chip"><component :is="folder.id === selectedId ? FolderOpen : Folder" :size="16" /></span>
          <span class="grow">
            <span class="strong block clamp">{{ folder.name }}</span>
            <span v-if="folder.description" class="muted small block two-line">{{ folder.description }}</span>
          </span>
          <span class="muted small">{{ folder.fileCount }}</span>
          <ChevronRight class="m-only muted" :size="16" />
        </button>
      </section>

      <section class="card pane-files">
        <div v-if="!selectedFolder" class="placeholder"><FolderOpen :size="30" /><p>Select a folder to see its files.</p></div>
        <template v-else>
          <header class="card-head">
            <button class="icon-btn m-only" aria-label="Back to folders" @click="selectedId = null"><ChevronLeft :size="20" /></button>
            <div class="grow head-text">
              <h2 class="card-title">{{ selectedFolder.name }}</h2>
              <p v-if="selectedFolder.description" class="card-sub">{{ selectedFolder.description }}</p>
            </div>
            <div v-if="isAdmin" class="row row-wrap">
              <button class="link-btn" @click="folderForm = { id: selectedFolder.id, name: selectedFolder.name, description: selectedFolder.description || '' }"><Pencil :size="13" />Edit</button>
              <button class="link-btn danger" @click="deleteFolder(selectedFolder)"><Trash2 :size="13" />Delete</button>
              <input ref="fileInput" type="file" multiple hidden @change="uploadChosenFiles" />
              <button class="btn btn-primary btn-sm" :disabled="!!uploadProgress" @click="fileInput.click()"><UploadCloud :size="14" />{{ uploadProgress ? `Uploading ${uploadProgress.done}/${uploadProgress.total}` : 'Upload Files' }}</button>
            </div>
          </header>
          <LoadingBlock v-if="isLoadingFiles && !files.length" />
          <p v-else-if="!files.length" class="empty">{{ isAdmin ? 'This folder is empty. Use "Upload Files" to add PDFs, slides, documents, videos, or audio.' : 'This folder is empty.' }}</p>
          <div v-for="file in files" :key="file.id" class="file">
            <span class="icon-chip"><component :is="fileKind(file).icon" :size="16" /></span>
            <div class="grow">
              <p class="strong two-line">{{ file.file_name }}</p>
              <p class="muted small clamp">{{ fileMeta(file) }}</p>
            </div>
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

    <AppModal v-if="folderForm" :title="folderForm.id ? 'Edit Folder' : 'New Folder'" :locked="isSavingFolder" @close="folderForm = null">
      <div class="stack">
        <label class="field"><span class="field-label">Name</span><input v-model="folderForm.name" class="input" placeholder="e.g. CLP Talk 1 Materials" /></label>
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
.placeholder { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 60px 20px; color: var(--muted); font-size: 13px; }
.head-text { min-width: 180px; }
.m-only { display: none; }
@media (max-width: 819.98px) {
  .mat { grid-template-columns: minmax(0, 1fr); }
  .m-only { display: inline-flex; }
  .pane-files { display: none; }
  .has-selection .pane-folders { display: none; }
  .has-selection .pane-files { display: block; }
}
</style>
