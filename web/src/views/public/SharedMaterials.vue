<script setup>
import { Clock, Download, Eye, File, FileImage, FileSpreadsheet, FileText, Film, Folder, Music, Paperclip, Presentation, QrCode } from 'lucide-vue-next';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import ImageViewer from '@/components/ImageViewer.vue';
import LoadingBlock from '@/components/LoadingBlock.vue';
import PublicShell from '@/components/PublicShell.vue';

// Public page for a Materials share link / QR code: lists the shared files
// for viewing and downloading until the link's time limit ends, then says a
// new QR code is needed. /api/materials checks the token every time.

const route = useRoute();
const token = typeof route.query.token === 'string' ? route.query.token : '';
const shared = ref(null);
const state = ref('loading'); // loading | ready | expired | invalid | error
const message = ref('');
const busyId = ref(null);
const thumbnails = ref({});
const viewer = ref(null);
const now = ref(Date.now());
let ticker = null;

const files = computed(() => shared.value?.folders.flatMap((folder) => folder.files) ?? []);
const totalBytes = computed(() => files.value.reduce((sum, file) => sum + (file.size || 0), 0));
const msLeft = computed(() => (shared.value ? new Date(shared.value.expiresAt).getTime() - now.value : 0));

function kindOf(file) {
  const mime = (file.mimeType || '').toLowerCase();
  const ext = (file.name || '').split('.').pop().toLowerCase();
  if (mime === 'application/pdf' || ext === 'pdf') return { icon: FileText, label: 'PDF' };
  if (mime.includes('presentation') || mime.includes('powerpoint') || ['ppt', 'pptx', 'key', 'odp'].includes(ext)) return { icon: Presentation, label: 'Slides' };
  if (mime.includes('spreadsheet') || mime.includes('excel') || ['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return { icon: FileSpreadsheet, label: 'Spreadsheet' };
  if (mime.includes('word') || mime.startsWith('text/') || ['doc', 'docx', 'txt', 'rtf', 'odt'].includes(ext)) return { icon: File, label: 'Document' };
  if (mime.startsWith('video/')) return { icon: Film, label: 'Video' };
  if (mime.startsWith('audio/')) return { icon: Music, label: 'Audio' };
  if (mime.startsWith('image/')) return { icon: FileImage, label: 'Image', image: true };
  return { icon: Paperclip, label: 'File' };
}

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

function formatWhen(iso) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

const timeLeftLabel = computed(() => {
  const minutes = Math.max(0, Math.floor(msLeft.value / 60000));
  if (minutes < 1) return 'less than a minute left';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} left`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ${minutes % 60 ? `${minutes % 60} min ` : ''}left`;
  return `${Math.floor(hours / 24)} days left`;
});

function markExpired(text) {
  state.value = 'expired';
  message.value = text || 'This share link has expired.';
  viewer.value = null;
}

async function load() {
  if (!token) {
    state.value = 'invalid';
    return;
  }
  try {
    const response = await fetch(`/api/materials?share=${encodeURIComponent(token)}`);
    const payload = await response.json().catch(() => null);
    if (response.status === 410) return markExpired(payload?.expiresAt ? `This share link ended on ${formatWhen(payload.expiresAt)}.` : '');
    if (response.status === 404) {
      state.value = 'invalid';
      message.value = payload?.error || '';
      return;
    }
    if (!response.ok || !payload) throw new Error(payload?.error || 'Something went wrong.');
    shared.value = payload;
    state.value = 'ready';
    loadThumbnails();
  } catch (error) {
    state.value = 'error';
    message.value = error.message;
  }
}

async function linkFor(file, download) {
  const response = await fetch('/api/materials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'share-link', token, materialId: file.id, download }),
  });
  const payload = await response.json().catch(() => null);
  if (response.status === 410) {
    markExpired(payload?.expiresAt ? `This share link ended on ${formatWhen(payload.expiresAt)}.` : '');
    throw new Error('expired');
  }
  if (!response.ok || !payload?.url) throw new Error(payload?.error || 'This file could not be opened.');
  return payload.url;
}

async function loadThumbnails() {
  const images = files.value.filter((file) => kindOf(file).image);
  for (let index = 0; index < images.length; index += 4) {
    const links = await Promise.all(images.slice(index, index + 4).map((file) => linkFor(file, false).then((url) => [file.id, url]).catch(() => null)));
    if (state.value !== 'ready') return;
    thumbnails.value = { ...thumbnails.value, ...Object.fromEntries(links.filter(Boolean)) };
  }
}

const viewerImages = computed(() => files.value.filter((file) => kindOf(file).image).map((file) => ({
  id: file.id,
  name: file.name,
  url: thumbnails.value[file.id] || null,
  meta: formatBytes(file.size),
})));

async function fetchViewerUrl(fileId) {
  const file = files.value.find((item) => item.id === fileId);
  if (!file || thumbnails.value[fileId]) return;
  const url = await linkFor(file, false).catch(() => null);
  if (url) thumbnails.value = { ...thumbnails.value, [fileId]: url };
}

async function open(file, download) {
  if (!download && kindOf(file).image) {
    viewer.value = { index: viewerImages.value.findIndex((image) => image.id === file.id) };
    return;
  }
  busyId.value = file.id;
  // Opened before the await, or browsers treat it as an unprompted popup.
  const tab = download ? null : window.open('', '_blank');
  try {
    const url = await linkFor(file, download);
    if (download) window.location.href = url;
    else if (tab) {
      tab.opener = null;
      tab.location.href = url;
    }
  } catch (error) {
    tab?.close();
    if (error.message !== 'expired') window.alert(error.message);
  } finally {
    busyId.value = null;
  }
}

function downloadFromViewer(image) {
  const file = files.value.find((item) => item.id === image?.id);
  if (file) open(file, true);
}

onMounted(() => {
  load();
  // Ends the page when the link runs out, even if it stays open.
  ticker = setInterval(() => {
    now.value = Date.now();
    if (state.value === 'ready' && msLeft.value <= 0) markExpired(`This share link ended on ${formatWhen(shared.value.expiresAt)}.`);
  }, 15000);
});
onBeforeUnmount(() => clearInterval(ticker));
</script>

<template>
  <PublicShell subtitle="SHARED MATERIALS">
    <LoadingBlock v-if="state === 'loading'" />

    <section v-else-if="state === 'expired'" class="card notice">
      <span class="notice-icon"><QrCode :size="28" /></span>
      <h1 class="notice-title">This link has expired</h1>
      <p class="muted">{{ message }}</p>
      <p>Ask the person who shared these materials for a <strong>new QR code or link</strong>.</p>
    </section>

    <section v-else-if="state === 'invalid'" class="card notice">
      <span class="notice-icon"><QrCode :size="28" /></span>
      <h1 class="notice-title">Link not available</h1>
      <p class="muted">{{ message || 'This share link is not valid or was turned off.' }}</p>
      <p>Ask the person who shared these materials for a new QR code or link.</p>
    </section>

    <section v-else-if="state === 'error'" class="card notice">
      <h1 class="notice-title">Something went wrong</h1>
      <p class="muted">{{ message }}</p>
      <button class="btn" @click="state = 'loading'; load()">Try Again</button>
    </section>

    <template v-else>
      <section class="card head">
        <span class="icon-chip big"><component :is="shared.kind === 'folder' ? Folder : kindOf(files[0] || {}).icon" :size="20" /></span>
        <div class="grow">
          <h1 class="title">{{ shared.title }}</h1>
          <p class="muted small">{{ files.length }} file{{ files.length === 1 ? '' : 's' }} · {{ formatBytes(totalBytes) }}</p>
        </div>
        <p class="expiry" :class="{ soon: msLeft < 3600000 }"><Clock :size="14" />Available until {{ formatWhen(shared.expiresAt) }} <span>({{ timeLeftLabel }})</span></p>
      </section>

      <p v-if="!files.length" class="card empty">No files have been added here yet.</p>
      <section v-for="folder in shared.folders" v-show="folder.files.length" :key="folder.path.join('/') || 'root'" class="card group">
        <h2 v-if="folder.path.length" class="group-title"><Folder :size="15" />{{ folder.path.join(' / ') }}</h2>
        <div v-for="file in folder.files" :key="file.id" class="file">
          <button v-if="kindOf(file).image" class="thumb" :aria-label="`View ${file.name}`" @click="open(file, false)">
            <img v-if="thumbnails[file.id]" :src="thumbnails[file.id]" alt="" loading="lazy" />
            <FileImage v-else :size="16" />
          </button>
          <span v-else class="icon-chip"><component :is="kindOf(file).icon" :size="16" /></span>
          <div class="grow">
            <p class="strong name">{{ file.name }}</p>
            <p class="muted small">{{ kindOf(file).label }} · {{ formatBytes(file.size) }}</p>
          </div>
          <span v-if="busyId === file.id" class="spinner sm" />
          <div v-else class="row actions">
            <button class="link-btn" @click="open(file, false)"><Eye :size="14" />Open</button>
            <button class="link-btn" @click="open(file, true)"><Download :size="14" />Download</button>
          </div>
        </div>
      </section>
    </template>

    <ImageViewer
      v-if="viewer && viewerImages.length"
      v-model:index="viewer.index"
      :images="viewerImages"
      @need-url="fetchViewerUrl"
      @download="downloadFromViewer"
      @close="viewer = null"
    />
  </PublicShell>
</template>

<style scoped>
.card { margin-bottom: 14px; }
.head { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 18px 20px; }
.icon-chip.big { width: 44px; height: 44px; }
.title { margin: 0; font-size: 20px; line-height: 1.25; }
.expiry { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 0; width: 100%; padding: 8px 12px; border-radius: 10px; background: var(--accent-soft); font-size: 13px; font-weight: 600; }
.expiry span { font-weight: 500; color: var(--muted); }
.expiry.soon { background: color-mix(in srgb, #f59e0b 18%, transparent); }
.group { padding: 4px 0; overflow: hidden; }
.group-title { display: flex; align-items: center; gap: 8px; margin: 0; padding: 12px 20px; font-size: 13px; font-weight: 700; color: var(--muted); }
.file { display: flex; align-items: center; gap: 12px; padding: 12px 20px; border-top: 1px solid var(--line); font-size: 13px; flex-wrap: wrap; }
.group-title + .file, .group > .file:first-child { border-top: 0; }
.name { overflow-wrap: anywhere; }
.actions { gap: 14px; }
.thumb { flex: none; width: 44px; height: 44px; padding: 0; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--surface-hover); display: inline-flex; align-items: center; justify-content: center; color: var(--muted); cursor: zoom-in; }
.thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.empty { padding: 24px 20px; color: var(--muted); }
.notice { display: grid; justify-items: center; gap: 8px; padding: 36px 24px; text-align: center; }
.notice p { margin: 0; max-width: 420px; }
.notice-icon { display: inline-flex; width: 56px; height: 56px; align-items: center; justify-content: center; border-radius: 50%; background: var(--accent-soft); }
.notice-title { margin: 6px 0 0; font-size: 20px; }
</style>
