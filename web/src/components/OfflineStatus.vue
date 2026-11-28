<script setup>
import { AlertTriangle, CloudOff, CloudUpload, RefreshCw } from 'lucide-vue-next';
import { computed, ref } from 'vue';
import AppModal from '@/components/AppModal.vue';
import { useOnline } from '@/lib/offline';
import { discard, flush, outbox, retry } from '@/lib/outbox';

// Header chip for working offline: "Offline", how many changes wait to sync,
// "Syncing…", and changes that need a decision. Click it for the list.
const online = useOnline();
const isOpen = ref(false);

const pending = computed(() => outbox.items.filter((item) => item.status === 'pending'));
const problems = computed(() => outbox.items.filter((item) => item.status !== 'pending'));
const visible = computed(() => !online.value || outbox.items.length > 0 || outbox.syncing);
const label = computed(() => {
  if (problems.value.length) return `${problems.value.length} to review`;
  if (outbox.syncing) return 'Syncing…';
  if (!online.value) return pending.value.length ? `Offline · ${pending.value.length} waiting` : 'Offline';
  return `${pending.value.length} waiting`;
});
const tone = computed(() => (problems.value.length ? 'danger' : !online.value ? 'offline' : 'syncing'));

const FIELD_LABELS = {
  Lastname: 'Last name', Firstname: 'First name', Status: 'Status', SpouseName: 'Spouse', Phone: 'Phone', MobileNo: 'Mobile #',
  Email: 'Email', PastoralService: 'Pastoral service', AreaName: 'Area', NameOfHouseholdHead: 'Household head',
  YearRegistered: 'Year registered', Birthday: 'Birthday', WeddingDate: 'Church wedding date',
};
const fieldLabel = (field) => FIELD_LABELS[field] ?? field;

function when(iso) {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function differences(item) {
  if (item.kind !== 'member-update' || !item.serverValues) return [];
  return Object.keys(item.serverValues).map((field) => ({
    field: fieldLabel(field),
    mine: item.payload.changes[field] ?? '(blank)',
    theirs: item.serverValues[field] ?? '(blank)',
  }));
}
</script>

<template>
  <button v-if="visible" class="offline-chip" :class="tone" :title="online ? 'Changes saved on this device' : 'No internet connection'" @click="isOpen = true">
    <AlertTriangle v-if="problems.length" :size="15" />
    <RefreshCw v-else-if="outbox.syncing" :size="15" class="spin" />
    <CloudOff v-else-if="!online" :size="15" />
    <CloudUpload v-else :size="15" />
    <span>{{ label }}</span>
  </button>

  <AppModal v-if="isOpen" title="Saved on This Device" :subtitle="online ? 'These changes are sent to Oracle automatically.' : 'You are offline. These changes are sent when the connection returns.'" :width="560" @close="isOpen = false">
    <p v-if="!outbox.items.length" class="muted">Nothing is waiting. Everything is synced.</p>
    <div v-for="item in outbox.items" :key="item.id" class="item" :class="item.status">
      <div class="item-head">
        <strong class="grow">{{ item.label }}</strong>
        <span class="pill" :class="{ warning: item.status === 'pending', danger: item.status !== 'pending' }">{{ item.status === 'pending' ? 'Waiting' : item.status === 'conflict' ? 'Needs review' : 'Not saved' }}</span>
      </div>
      <p class="muted small">Saved {{ when(item.createdAt) }}</p>
      <p v-if="item.detail" class="small detail">{{ item.detail }}</p>
      <table v-if="differences(item).length" class="diff">
        <thead><tr><th>Field</th><th>Yours</th><th>Now in Oracle</th></tr></thead>
        <tbody><tr v-for="row in differences(item)" :key="row.field"><td>{{ row.field }}</td><td>{{ row.mine }}</td><td>{{ row.theirs }}</td></tr></tbody>
      </table>
      <div v-if="item.status !== 'pending'" class="row row-wrap actions">
        <button v-if="item.status === 'conflict'" class="btn btn-sm btn-primary" :disabled="!online" @click="retry(item.id, { force: true })">Keep Mine</button>
        <button v-if="item.status === 'conflict'" class="btn btn-sm" @click="discard(item.id)">Use Theirs</button>
        <button v-if="item.status === 'failed'" class="btn btn-sm" :disabled="!online" @click="retry(item.id)">Try Again</button>
        <button v-if="item.status === 'failed'" class="link-btn danger" @click="discard(item.id)">Discard</button>
      </div>
    </div>
    <template #footer>
      <button class="btn" @click="isOpen = false">Close</button>
      <button class="btn btn-primary" :disabled="!online || outbox.syncing || !pending.length" @click="flush()"><RefreshCw :size="14" />Sync Now</button>
    </template>
  </AppModal>
</template>

<style scoped>
.offline-chip { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border-radius: 999px; border: 1px solid transparent; font-size: 12px; font-weight: 600; white-space: nowrap; cursor: pointer; }
.offline-chip.offline { background: color-mix(in srgb, #f59e0b 18%, transparent); border-color: color-mix(in srgb, #f59e0b 45%, transparent); color: #92400e; }
.offline-chip.syncing { background: var(--accent-soft); border-color: var(--line); color: inherit; }
.offline-chip.danger { background: color-mix(in srgb, #dc2626 14%, transparent); border-color: color-mix(in srgb, #dc2626 40%, transparent); color: #991b1b; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
.item { padding: 12px 0; border-top: 1px solid var(--line); display: grid; gap: 4px; }
.item:first-child { border-top: 0; }
.item-head { display: flex; align-items: center; gap: 10px; }
.detail { margin: 2px 0 0; }
.diff { width: 100%; margin-top: 6px; border-collapse: collapse; font-size: 12px; }
.diff th, .diff td { padding: 4px 6px; border: 1px solid var(--line); text-align: left; }
.diff th { background: var(--surface-hover); }
.actions { margin-top: 6px; }
</style>
