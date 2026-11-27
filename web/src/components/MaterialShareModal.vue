<script setup>
import { Check, Copy, Download, Link as LinkIcon, QrCode, Trash2 } from 'lucide-vue-next';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import AppModal from '@/components/AppModal.vue';
import { confirmAction, showAlert } from '@/lib/data';
import { qrPng, qrSvg } from '@/lib/qr';
import { supabase } from '@/lib/supabase';

// Makes public, time-limited share links (with QR codes) for a Materials
// folder or file. When a link's time is up it stops working, and a new link
// (a new QR code) is made here. target: { type: 'folder' | 'file', id, name }.
const props = defineProps({ target: { type: Object, required: true } });
defineEmits(['close']);

const DURATIONS = [
  { label: '1 hour', hours: 1 },
  { label: '6 hours', hours: 6 },
  { label: '1 day', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '1 week', hours: 168 },
  { label: '30 days', hours: 720 },
];

const hours = ref(24);
const shares = ref([]);
const isLoading = ref(true);
const isCreating = ref(false);
const shownId = ref(null);
const copiedId = ref(null);
const now = ref(Date.now());
const ticker = setInterval(() => {
  now.value = Date.now();
}, 30000);

const column = computed(() => (props.target.type === 'folder' ? 'folder_id' : 'material_id'));
const linkFor = (share) => `${window.location.origin}/shared-materials?token=${share.token}`;
const isActive = (share) => !share.revoked_at && new Date(share.expires_at).getTime() > now.value;
const activeShares = computed(() => shares.value.filter(isActive));
const pastShares = computed(() => shares.value.filter((share) => !isActive(share)).slice(0, 5));
const shown = computed(() => shares.value.find((share) => share.id === shownId.value && isActive(share)) || null);
const shownSvg = computed(() => (shown.value ? qrSvg(linkFor(shown.value)) : ''));

function formatWhen(iso) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

function timeLeft(iso) {
  const minutes = Math.max(0, Math.round((new Date(iso).getTime() - now.value) / 60000));
  if (minutes < 60) return `${minutes} min left`;
  const hoursLeft = Math.round(minutes / 60);
  if (hoursLeft < 48) return `${hoursLeft} hour${hoursLeft === 1 ? '' : 's'} left`;
  return `${Math.round(hoursLeft / 24)} days left`;
}

// 24 random bytes as URL-safe text: not guessable.
function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function loadShares() {
  isLoading.value = true;
  try {
    const { data, error } = await supabase
      .from('material_shares')
      .select('id, token, expires_at, revoked_at, view_count, created_at')
      .eq(column.value, props.target.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    shares.value = data || [];
    if (!shownId.value) shownId.value = activeShares.value[0]?.id ?? null;
  } catch (error) {
    showAlert('Error Loading Share Links', error.message);
  } finally {
    isLoading.value = false;
  }
}

async function createShare() {
  isCreating.value = true;
  try {
    const expiresAt = new Date(Date.now() + hours.value * 3600 * 1000).toISOString();
    const { data, error } = await supabase
      .from('material_shares')
      .insert([{ token: newToken(), [column.value]: props.target.id, expires_at: expiresAt }])
      .select('id')
      .single();
    if (error) throw error;
    shownId.value = data.id;
    await loadShares();
  } catch (error) {
    showAlert('Error Creating Share Link', error.message);
  } finally {
    isCreating.value = false;
  }
}

async function revoke(share) {
  if (!confirmAction('Turn Off Link', 'Turn off this share link now? Anyone using it or its QR code will lose access.')) return;
  const { error } = await supabase.from('material_shares').update({ revoked_at: new Date().toISOString() }).eq('id', share.id);
  if (error) showAlert('Error Turning Off Link', error.message);
  if (shownId.value === share.id) shownId.value = null;
  await loadShares();
}

async function copy(share) {
  try {
    await navigator.clipboard.writeText(linkFor(share));
    copiedId.value = share.id;
    setTimeout(() => {
      if (copiedId.value === share.id) copiedId.value = null;
    }, 2000);
  } catch {
    window.prompt('Copy this link:', linkFor(share));
  }
}

async function downloadQr(share) {
  const blob = await qrPng(linkFor(share), `${props.target.name} · until ${formatWhen(share.expires_at)}`);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `qr-${props.target.name.replace(/[^\w-]+/g, '-').slice(0, 60)}.png`;
  link.click();
  URL.revokeObjectURL(url);
}

onMounted(loadShares);
onBeforeUnmount(() => clearInterval(ticker));
</script>

<template>
  <AppModal :title="`Share ${target.type === 'folder' ? 'Folder' : 'File'}`" :subtitle="target.name" :width="620" @close="$emit('close')">
    <div class="stack">
      <p class="muted small">Anyone with the link or QR code can view and download {{ target.type === 'folder' ? 'the files in this folder and its subfolders' : 'this file' }} without signing in, until the time limit ends. After that the link stops working; make a new one here for a new QR code.</p>

      <div class="create">
        <label class="field grow"><span class="field-label">Link works for</span>
          <select v-model.number="hours" class="select">
            <option v-for="option in DURATIONS" :key="option.hours" :value="option.hours">{{ option.label }}</option>
          </select>
        </label>
        <button class="btn btn-primary" :disabled="isCreating" @click="createShare"><QrCode :size="15" />{{ isCreating ? 'Creating…' : 'Create Link & QR Code' }}</button>
      </div>

      <div v-if="shown" class="qr-card">
        <div class="qr" role="img" :aria-label="`QR code for ${target.name}`" v-html="shownSvg" />
        <div class="qr-info">
          <p class="strong">Works until {{ formatWhen(shown.expires_at) }}</p>
          <p class="muted small">{{ timeLeft(shown.expires_at) }} · opened {{ shown.view_count }} time{{ shown.view_count === 1 ? '' : 's' }}</p>
          <input class="input link-input" :value="linkFor(shown)" readonly aria-label="Share link" @focus="$event.target.select()" />
          <div class="row row-wrap">
            <button class="btn btn-sm" @click="copy(shown)"><component :is="copiedId === shown.id ? Check : Copy" :size="14" />{{ copiedId === shown.id ? 'Copied' : 'Copy Link' }}</button>
            <button class="btn btn-sm" @click="downloadQr(shown)"><Download :size="14" />Download QR</button>
            <button class="link-btn danger" @click="revoke(shown)"><Trash2 :size="13" />Turn Off</button>
          </div>
        </div>
      </div>

      <section v-if="activeShares.length > 1 || (activeShares.length && !shown)">
        <h3 class="list-title">Active links</h3>
        <div v-for="share in activeShares" :key="share.id" class="share-row" :class="{ on: share.id === shownId }">
          <LinkIcon :size="14" class="muted" />
          <span class="grow small">Until {{ formatWhen(share.expires_at) }} <span class="muted">· {{ timeLeft(share.expires_at) }} · {{ share.view_count }} open{{ share.view_count === 1 ? '' : 's' }}</span></span>
          <button class="link-btn" @click="shownId = share.id"><QrCode :size="13" />Show QR</button>
          <button class="link-btn danger" @click="revoke(share)">Turn Off</button>
        </div>
      </section>

      <section v-if="pastShares.length">
        <h3 class="list-title">Ended links</h3>
        <div v-for="share in pastShares" :key="share.id" class="share-row ended">
          <LinkIcon :size="14" />
          <span class="grow small">{{ share.revoked_at ? `Turned off ${formatWhen(share.revoked_at)}` : `Expired ${formatWhen(share.expires_at)}` }} · {{ share.view_count }} open{{ share.view_count === 1 ? '' : 's' }}</span>
        </div>
      </section>
      <p v-if="isLoading && !shares.length" class="muted small">Loading links…</p>
    </div>
  </AppModal>
</template>

<style scoped>
.create { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
.qr-card { display: flex; gap: 18px; align-items: center; flex-wrap: wrap; padding: 16px; border: 1px solid var(--line); border-radius: var(--radius-md, 10px); background: var(--surface-hover); }
.qr { width: 180px; height: 180px; flex: none; padding: 6px; background: #fff; border-radius: 10px; }
.qr :deep(svg) { width: 100%; height: 100%; display: block; }
.qr-info { flex: 1; min-width: 220px; display: grid; gap: 8px; }
.link-input { font-size: 12px; }
.list-title { margin: 4px 0 6px; font-size: 12px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }
.share-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-top: 1px solid var(--line); }
.share-row.on { background: var(--accent-soft); }
.share-row.ended { color: var(--muted); }
</style>
