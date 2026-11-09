<script setup>
import { RefreshCw } from 'lucide-vue-next';
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import DataTable from '@/components/DataTable.vue';
import LoadingBlock from '@/components/LoadingBlock.vue';
import PageHead from '@/components/PageHead.vue';
import SearchInput from '@/components/SearchInput.vue';
import { formatDateTime } from '@/lib/data';
import { checkPastoralReport, FAILURE_MESSAGES, fetchPastoralReports } from '@/lib/ogdApi';

// Each check runs its own browser, so only a couple run at once.
const CONCURRENT_CHECKS = 2;
const STATUS = {
  generated: { label: 'Generated', tone: 'success' }, not_generated: { label: 'Not generated', tone: 'warning' },
  failed: { label: 'Check failed', tone: 'danger' }, checking: { label: 'Checking…', tone: 'info' },
  unchecked: { label: 'Not checked', tone: '' }, not_ready: { label: 'Needs setup', tone: '' },
};

const month = ref('');
const rows = ref([]);
const loadState = reactive({ status: 'loading', message: '' });
const search = ref('');
const checkingIds = ref(new Set());
const rowErrors = ref({});
const isCheckingAll = ref(false);
let isActive = true;

function displayStatus(row) {
  if (checkingIds.value.has(row.areaId)) return 'checking';
  return row.status || (row.isReady ? 'unchecked' : 'not_ready');
}

const columns = [
  { key: 'sector', label: 'Sector' },
  { key: 'chapter', label: 'Chapter' },
  { key: 'status', label: 'This Month', value: (row) => STATUS[displayStatus(row)].label },
  { key: 'latestMonthYear', label: 'Latest Report' },
  { key: 'checkedAt', label: 'Last Checked' },
  { key: 'actions', label: 'Actions', action: true },
];

const generatedCount = computed(() => rows.value.filter((row) => row.status === 'generated').length);
const readyCount = computed(() => rows.value.filter((row) => row.isReady).length);
const visibleRows = computed(() => {
  const query = search.value.trim().toLowerCase();
  return query ? rows.value.filter((row) => [row.sector, row.cluster, row.chapter].some((value) => value?.toLowerCase().includes(query))) : rows.value;
});

async function load() {
  try {
    const result = await fetchPastoralReports();
    month.value = result.month;
    rows.value = result.chapters;
    Object.assign(loadState, { status: 'success', message: '' });
  } catch (error) {
    Object.assign(loadState, { status: 'error', message: error.message });
  }
}

function setChecking(areaId, isChecking) {
  const next = new Set(checkingIds.value);
  if (isChecking) next.add(areaId);
  else next.delete(areaId);
  checkingIds.value = next;
}

async function checkChapter(areaId) {
  setChecking(areaId, true);
  rowErrors.value = { ...rowErrors.value, [areaId]: null };
  try {
    await checkPastoralReport({ areaId });
  } catch (error) {
    if (isActive) rowErrors.value = { ...rowErrors.value, [areaId]: error.message };
  } finally {
    if (isActive) {
      setChecking(areaId, false);
      load();
    }
  }
}

async function checkAll() {
  const queue = rows.value.filter((row) => row.isReady).map((row) => row.areaId);
  isCheckingAll.value = true;
  async function worker() {
    while (queue.length && isActive) await checkChapter(queue.shift());
  }
  try {
    await Promise.all(Array.from({ length: CONCURRENT_CHECKS }, worker));
  } finally {
    if (isActive) isCheckingAll.value = false;
  }
}

onMounted(load);
onBeforeUnmount(() => {
  isActive = false;
});
</script>

<template>
  <div class="page">
    <PageHead title="Monthly Pastoral Reports" subtitle="See which chapters have generated their report in OGD this month.">
      <button v-if="loadState.status === 'success'" class="btn btn-primary" :disabled="!readyCount || isCheckingAll" @click="checkAll"><RefreshCw :size="14" />{{ isCheckingAll ? 'Checking…' : 'Check All Chapters' }}</button>
    </PageHead>

    <p v-if="loadState.status === 'success'" class="summary">{{ month }}: {{ generatedCount }} of {{ rows.length }} chapters generated</p>
    <p v-if="isCheckingAll" class="notice">Checking each chapter can take a minute or two. Keep this page open until it finishes.</p>
    <SearchInput v-model="search" placeholder="Search sector or chapter..." />

    <section class="card">
      <LoadingBlock v-if="loadState.status === 'loading'" />
      <div v-else-if="loadState.status === 'error'" class="card-pad stack">
        <p class="text-danger">{{ loadState.message }}</p>
        <div><button class="btn btn-sm" @click="load">Try again</button></div>
      </div>
      <DataTable v-else :columns="columns" :rows="visibleRows" row-key="areaId" :initial-sort="{ key: 'sector', ascending: true }" :empty-text="rows.length ? 'No chapters match your search.' : 'No chapters are assigned to your account yet.'">
        <template #cell-sector="{ value }">{{ value || '—' }}</template>
        <template #cell-chapter="{ value }"><span class="strong">{{ value }}</span></template>
        <template #cell-status="{ row }">
          <div class="status">
            <span class="pill" :class="STATUS[displayStatus(row)].tone">{{ STATUS[displayStatus(row)].label }}</span>
            <p v-if="displayStatus(row) === 'failed' && FAILURE_MESSAGES[row.failureCode]" class="small text-danger">{{ FAILURE_MESSAGES[row.failureCode] }}</p>
            <p v-if="displayStatus(row) === 'failed' && row.statusDetail" class="muted tiny">{{ row.statusDetail }}</p>
            <p v-if="rowErrors[row.areaId]" class="small text-danger">{{ rowErrors[row.areaId] }}</p>
          </div>
        </template>
        <template #cell-latestMonthYear="{ value }">{{ value || '—' }}</template>
        <template #cell-checkedAt="{ value }"><span class="nowrap">{{ formatDateTime(value) }}</span></template>
        <template #cell-actions="{ row }">
          <button v-if="row.isReady && !checkingIds.has(row.areaId) && !isCheckingAll" class="link-btn" @click="checkChapter(row.areaId)"><RefreshCw :size="13" />Check</button>
        </template>
      </DataTable>
    </section>
  </div>
</template>

<style scoped>
.summary { font-size: 15px; font-weight: var(--fw-heading); }
.status { text-align: left; min-width: 150px; }
.tiny { font-size: 11px; margin-top: 2px; }
</style>
