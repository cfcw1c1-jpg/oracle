<script setup>
import { Download, RefreshCw } from 'lucide-vue-next';
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import DataTable from '@/components/DataTable.vue';
import LoadingBlock from '@/components/LoadingBlock.vue';
import PageHead from '@/components/PageHead.vue';
import SearchInput from '@/components/SearchInput.vue';
import { exportCsv, formatDateTime } from '@/lib/data';
import { FAILURE_MESSAGES, fetchCelebrants, generateCelebrants } from '@/lib/ogdApi';

// Each chapter signs in to OGD in its own browser, so only a couple run at once.
const CONCURRENT_RUNS = 2;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const KINDS = [
  { key: 'birthday', label: 'Birthdays' },
  { key: 'anniversary', label: 'Wedding Anniversaries' },
];
// Matches SERVICE_TYPES in api/_lib/celebrantsReport.mjs.
const SERVICE_TYPES = 'Chapter Head, Chapter Leader, Unit Head, Unit Leader, Household Head, Household Leader, FAMIN Household Head, FAMIN Household Leader and Member';

function manilaMonth() {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', month: 'numeric' }).format(new Date()));
}

const month = ref(manilaMonth());
const kind = ref('birthday');
const chapters = ref([]);
const loadState = reactive({ status: 'loading', message: '' });
const chapterSearch = ref('');
const celebrantSearch = ref('');
const runningIds = ref(new Set());
const rowErrors = ref({});
const isRunningAll = ref(false);
let isActive = true;
let loadToken = 0;

const kindLabel = computed(() => KINDS.find((entry) => entry.key === kind.value).label);
const readyCount = computed(() => chapters.value.filter((row) => row.isReady).length);
const isBusy = computed(() => isRunningAll.value || runningIds.value.size > 0);

function reportStatus(row, key) {
  if (runningIds.value.has(row.areaId)) return { label: 'Generating…', tone: 'info' };
  const report = row[key];
  if (!report) return row.isReady ? { label: 'Not generated', tone: '' } : { label: 'Needs setup', tone: '' };
  if (report.status === 'failed') return { label: 'Failed', tone: 'danger' };
  return { label: `${report.records.length} celebrant${report.records.length === 1 ? '' : 's'}`, tone: 'success' };
}

function lastGenerated(row) {
  return [row.birthday?.generatedAt, row.anniversary?.generatedAt].filter(Boolean).sort().at(-1) ?? null;
}

const chapterColumns = [
  { key: 'sector', label: 'Sector' },
  { key: 'chapter', label: 'Chapter' },
  { key: 'birthday', label: 'Birthdays', value: (row) => row.birthday?.records.length ?? -1 },
  { key: 'anniversary', label: 'Wedding Anniversaries', value: (row) => row.anniversary?.records.length ?? -1 },
  { key: 'generatedAt', label: 'Last Generated', value: lastGenerated },
  { key: 'actions', label: 'Actions', action: true },
];

const visibleChapters = computed(() => {
  const query = chapterSearch.value.trim().toLowerCase();
  return query ? chapters.value.filter((row) => [row.sector, row.cluster, row.chapter].some((value) => value?.toLowerCase().includes(query))) : chapters.value;
});

// OGD's own headings, in the order the first chapter's list shows them.
const celebrantHeaders = computed(() => {
  const headers = [];
  for (const row of chapters.value) {
    for (const header of row[kind.value]?.headers ?? []) if (header && !headers.includes(header)) headers.push(header);
  }
  return headers;
});

const celebrants = computed(() => chapters.value.flatMap((row) => {
  const report = row[kind.value];
  if (!report?.records?.length) return [];
  return report.records.map((cells, index) => ({
    rowId: `${row.areaId}-${index}`,
    Chapter: row.chapter,
    Sector: row.sector,
    ...Object.fromEntries(report.headers.map((header, column) => [header, cells[column] ?? ''])),
  }));
}));

const celebrantColumns = computed(() => [
  { key: 'Chapter', label: 'Chapter' },
  ...celebrantHeaders.value.filter((header) => header !== 'Chapter').map((header) => ({ key: header, label: header })),
]);

const visibleCelebrants = computed(() => {
  const query = celebrantSearch.value.trim().toLowerCase();
  if (!query) return celebrants.value;
  return celebrants.value.filter((row) => Object.values(row).some((value) => String(value ?? '').toLowerCase().includes(query)));
});

async function load() {
  const token = ++loadToken;
  try {
    const result = await fetchCelebrants(month.value);
    if (token !== loadToken || !isActive) return;
    chapters.value = result.chapters;
    Object.assign(loadState, { status: 'success', message: '' });
  } catch (error) {
    if (token !== loadToken || !isActive) return;
    Object.assign(loadState, { status: 'error', message: error.message });
  }
}

function setRunning(areaId, isRunning) {
  const next = new Set(runningIds.value);
  if (isRunning) next.add(areaId);
  else next.delete(areaId);
  runningIds.value = next;
}

async function generateChapter(areaId) {
  setRunning(areaId, true);
  rowErrors.value = { ...rowErrors.value, [areaId]: null };
  try {
    await generateCelebrants({ areaId, month: month.value });
  } catch (error) {
    if (isActive) rowErrors.value = { ...rowErrors.value, [areaId]: error.message };
  } finally {
    if (isActive) {
      setRunning(areaId, false);
      load();
    }
  }
}

async function generateAll() {
  const queue = visibleChapters.value.filter((row) => row.isReady).map((row) => row.areaId);
  isRunningAll.value = true;
  async function worker() {
    while (queue.length && isActive) await generateChapter(queue.shift());
  }
  try {
    await Promise.all(Array.from({ length: CONCURRENT_RUNS }, worker));
  } finally {
    if (isActive) isRunningAll.value = false;
  }
}

function handleExport() {
  if (!visibleCelebrants.value.length) return;
  const name = `${kind.value === 'birthday' ? 'birthday' : 'wedding-anniversary'}-celebrants-${MONTHS[month.value - 1].toLowerCase()}`;
  exportCsv(name, [{ key: 'Sector', label: 'Sector' }, ...celebrantColumns.value], visibleCelebrants.value);
}

watch(month, () => {
  rowErrors.value = {};
  Object.assign(loadState, { status: 'loading', message: '' });
  load();
});

onMounted(load);
onBeforeUnmount(() => {
  isActive = false;
});
</script>

<template>
  <div class="page">
    <PageHead title="Reports" subtitle="Birthday and wedding anniversary celebrants, generated from OGD for the month you choose.">
      <button v-if="loadState.status === 'success'" class="btn btn-primary" :disabled="!readyCount || isBusy" @click="generateAll">
        <RefreshCw :size="14" />{{ isRunningAll ? 'Generating…' : 'Generate All Chapters' }}
      </button>
    </PageHead>

    <div class="controls">
      <label class="field month">
        <span class="field-label">Month</span>
        <select v-model.number="month" class="select" :disabled="isBusy" aria-label="Month">
          <option v-for="(name, index) in MONTHS" :key="name" :value="index + 1">{{ name }}</option>
        </select>
      </label>
      <p class="muted small filters">Includes Service Types {{ SERVICE_TYPES }}. No Service Groups are selected.</p>
    </div>

    <p v-if="isBusy" class="notice">Each chapter signs in to OGD and generates both lists, which can take a minute or two. Keep this page open until it finishes.</p>

    <section class="card">
      <div class="card-pad section-head"><h2 class="section-title">Chapters</h2></div>
      <div class="card-pad search-pad"><SearchInput v-model="chapterSearch" placeholder="Search sector or chapter..." /></div>
      <LoadingBlock v-if="loadState.status === 'loading'" />
      <div v-else-if="loadState.status === 'error'" class="card-pad stack">
        <p class="text-danger">{{ loadState.message }}</p>
        <div><button class="btn btn-sm" @click="load">Try again</button></div>
      </div>
      <DataTable v-else :columns="chapterColumns" :rows="visibleChapters" row-key="areaId" :initial-sort="{ key: 'sector', ascending: true }" :empty-text="chapters.length ? 'No chapters match your search.' : 'No chapters are assigned to your account yet.'">
        <template #cell-sector="{ value }">{{ value || '—' }}</template>
        <template #cell-chapter="{ value }"><span class="strong">{{ value }}</span></template>
        <template v-for="entry in KINDS" :key="entry.key" #[`cell-${entry.key}`]="{ row }">
          <div class="status">
            <span class="pill" :class="reportStatus(row, entry.key).tone">{{ reportStatus(row, entry.key).label }}</span>
            <template v-if="row[entry.key]?.status === 'failed' && !runningIds.has(row.areaId)">
              <p v-if="FAILURE_MESSAGES[row[entry.key].failureCode]" class="small text-danger">{{ FAILURE_MESSAGES[row[entry.key].failureCode] }}</p>
              <p v-if="row[entry.key].statusDetail" class="muted tiny detail">{{ row[entry.key].statusDetail }}</p>
            </template>
          </div>
        </template>
        <template #cell-generatedAt="{ row }">
          <span class="nowrap">{{ formatDateTime(lastGenerated(row)) }}</span>
          <p v-if="rowErrors[row.areaId]" class="small text-danger">{{ rowErrors[row.areaId] }}</p>
        </template>
        <template #cell-actions="{ row }">
          <button v-if="row.isReady && !runningIds.has(row.areaId) && !isRunningAll" class="link-btn" @click="generateChapter(row.areaId)"><RefreshCw :size="13" />Generate</button>
        </template>
      </DataTable>
    </section>

    <section v-if="loadState.status === 'success'" class="card">
      <div class="card-pad section-head">
        <h2 class="section-title">{{ kindLabel }} in {{ MONTHS[month - 1] }} ({{ celebrants.length }})</h2>
        <button class="btn btn-sm" :disabled="!visibleCelebrants.length" @click="handleExport"><Download :size="14" />Export CSV</button>
      </div>
      <div class="card-pad search-pad stack">
        <div class="tabs" role="tablist">
          <button v-for="entry in KINDS" :key="entry.key" class="tab" role="tab" :aria-selected="kind === entry.key" :class="{ active: kind === entry.key }" @click="kind = entry.key">{{ entry.label }}</button>
        </div>
        <SearchInput v-model="celebrantSearch" placeholder="Search celebrants..." />
      </div>
      <DataTable :columns="celebrantColumns" :rows="visibleCelebrants" row-key="rowId" :initial-sort="{ key: 'Chapter', ascending: true }" :empty-text="celebrants.length ? 'No celebrants match your search.' : 'Generate a chapter to see its celebrants here.'">
        <template #cell-Chapter="{ value }"><span class="strong">{{ value }}</span></template>
      </DataTable>
    </section>
  </div>
</template>

<style scoped>
.controls { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px 20px; }
.month { width: 200px; max-width: 100%; }
.filters { flex: 1 1 260px; margin: 0; padding-bottom: 4px; }
.section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding-bottom: 0; }
.section-title { font-size: 15px; font-weight: var(--fw-heading); margin: 0; }
.search-pad { padding-top: 12px; padding-bottom: 12px; }
.status { text-align: left; min-width: 150px; }
.tiny { font-size: 11px; margin-top: 2px; }
.detail { max-width: 360px; max-height: 6em; overflow: auto; word-break: break-word; }
</style>
