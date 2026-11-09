<script setup>
import { CircleX, FileText, Paperclip, TriangleAlert, UploadCloud } from 'lucide-vue-next';
import { computed, reactive, ref } from 'vue';
import { csvRowsToObjects, parseCsv } from '@/lib/csv';
import { showAlert } from '@/lib/data';
import { TRAINING_COLUMNS } from '@/lib/formation';
import { supabase } from '@/lib/supabase';

// The match key, MemberIDNo, is handled separately.
const MEMBER_FIELDS = ['Lastname', 'Firstname', 'PastoralService', 'AreaName', 'NameOfHouseholdHead'];
const KNOWN_PFO_COLUMNS = TRAINING_COLUMNS.map((column) => column.id);

const fileInput = ref(null);
const fileName = ref(null);
const headers = ref([]);
const records = ref([]);
const isImporting = ref(false);
const progress = reactive({ done: 0, total: 0 });
const results = ref(null);

const memberHeaders = computed(() => MEMBER_FIELDS.filter((field) => headers.value.includes(field)));

// Postgres cuts identifiers at 63 characters, so a long CSV header matches the
// longest column name it begins with.
const columnMapping = computed(() => {
  const map = {};
  const unrecognized = [];
  headers.value.filter((header) => header !== 'MemberIDNo' && !MEMBER_FIELDS.includes(header)).forEach((header) => {
    const match = KNOWN_PFO_COLUMNS.includes(header) ? header : KNOWN_PFO_COLUMNS.filter((column) => header.startsWith(column)).sort((a, b) => b.length - a.length)[0];
    if (match) map[header] = match;
    else unrecognized.push(header);
  });
  return { map, unrecognized };
});
const pfoColumnCount = computed(() => Object.keys(columnMapping.value.map).length);
const validRecords = computed(() => records.value.filter((record) => record.MemberIDNo?.trim()));
const skippedCount = computed(() => records.value.length - validRecords.value.length);

function onFileChosen(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const parsed = csvRowsToObjects(parseCsv(String(reader.result || '')));
    if (!parsed.headers.length) {
      showAlert('Empty File', 'That file has no rows.');
      return;
    }
    if (!parsed.headers.includes('MemberIDNo')) {
      showAlert('Missing Column', 'This CSV has no "MemberIDNo" column, which is required to match records.');
      return;
    }
    fileName.value = file.name;
    headers.value = parsed.headers;
    records.value = parsed.records;
    results.value = null;
  };
  reader.onerror = () => showAlert('Read Failed', 'Could not read the selected file.');
  reader.readAsText(file);
}

function reset() {
  fileName.value = null;
  headers.value = [];
  records.value = [];
  results.value = null;
}

// One upsert per row: in a batch, columns missing from one row could be filled
// with nulls, and a blank cell must never clear existing data.
async function runImport() {
  if (!validRecords.value.length) return;
  isImporting.value = true;
  Object.assign(progress, { done: 0, total: validRecords.value.length });
  const outcome = { membersUpserted: 0, pfoUpserted: 0, skipped: skippedCount.value, errors: [] };

  for (const record of validRecords.value) {
    const memberId = record.MemberIDNo.trim();
    const memberPayload = { MemberIDNo: memberId };
    memberHeaders.value.forEach((field) => {
      if (record[field]) memberPayload[field] = record[field];
    });
    const memberResult = await supabase.from('members').upsert([memberPayload], { onConflict: 'MemberIDNo' });
    if (memberResult.error) outcome.errors.push(`${memberId}: ${memberResult.error.message}`);
    else outcome.membersUpserted += 1;

    const talks = Object.entries(columnMapping.value.map).filter(([header]) => record[header]).map(([header, column]) => [column, record[header]]);
    if (talks.length) {
      const pfoResult = await supabase.from('pfo_members').upsert([{ MemberIDNo: memberId, ...Object.fromEntries(talks) }], { onConflict: 'MemberIDNo' });
      if (pfoResult.error) outcome.errors.push(`${memberId} (PFO): ${pfoResult.error.message}`);
      else outcome.pfoUpserted += 1;
    }
    progress.done += 1;
  }
  results.value = outcome;
  isImporting.value = false;
}
</script>

<template>
  <div class="stack gap">
    <p class="muted">Upload a roster/PFO-progress CSV to update the Directory and formation records, matched by MemberIDNo.</p>

    <section class="card card-pad stack">
      <h2 class="card-title">1. Choose File</h2>
      <div class="row row-wrap">
        <input ref="fileInput" type="file" accept=".csv,text/csv" hidden @change="onFileChosen" />
        <button class="btn btn-primary" :disabled="isImporting" @click="fileInput.click()"><Paperclip :size="15" />Choose CSV File</button>
        <span v-if="fileName" class="pill row"><FileText :size="13" /><span class="clamp">{{ fileName }}</span>
          <button class="chip-x" :disabled="isImporting" aria-label="Remove file" @click="reset"><CircleX :size="15" /></button>
        </span>
      </div>
    </section>

    <section v-if="fileName" class="card card-pad stack">
      <div>
        <h2 class="card-title">2. Preview</h2>
        <p class="card-sub">{{ records.length }} row{{ records.length === 1 ? '' : 's' }} found</p>
      </div>
      <div class="row row-wrap">
        <span class="pill success">{{ validRecords.length }} ready to import</span>
        <span v-if="skippedCount" class="pill warning">{{ skippedCount }} skipped (no MemberIDNo)</span>
        <span class="pill">{{ memberHeaders.length }} member field{{ memberHeaders.length === 1 ? '' : 's' }}</span>
        <span class="pill">{{ pfoColumnCount }} PFO column{{ pfoColumnCount === 1 ? '' : 's' }}</span>
      </div>
      <p v-if="columnMapping.unrecognized.length" class="notice warn row"><TriangleAlert :size="14" />{{ columnMapping.unrecognized.length }} column{{ columnMapping.unrecognized.length === 1 ? '' : 's' }} not recognized and will be ignored: {{ columnMapping.unrecognized.join(', ') }}</p>
      <h3 class="field-label">First Rows</h3>
      <p v-for="record in validRecords.slice(0, 5)" :key="record.MemberIDNo" class="small clamp">{{ record.Lastname || '—' }}, {{ record.Firstname || '—' }} · {{ record.MemberIDNo }} · {{ record.AreaName || '—' }}</p>
      <p v-if="validRecords.length > 5" class="muted small">…and {{ validRecords.length - 5 }} more.</p>
      <div>
        <button class="btn btn-primary" :disabled="isImporting || !validRecords.length" @click="runImport">
          <UploadCloud :size="15" />{{ isImporting ? `Importing ${progress.done} / ${progress.total}…` : `Import ${validRecords.length} Record${validRecords.length === 1 ? '' : 's'}` }}
        </button>
      </div>
    </section>

    <section v-if="results" class="card card-pad stack">
      <h2 class="card-title">3. Result</h2>
      <div class="row row-wrap">
        <span class="pill success">{{ results.membersUpserted }} members updated</span>
        <span class="pill success">{{ results.pfoUpserted }} PFO records updated</span>
        <span v-if="results.skipped" class="pill warning">{{ results.skipped }} skipped</span>
        <span v-if="results.errors.length" class="pill danger">{{ results.errors.length }} error{{ results.errors.length === 1 ? '' : 's' }}</span>
      </div>
      <div v-if="results.errors.length" class="errors"><p v-for="(message, index) in results.errors" :key="index" class="small text-danger">{{ message }}</p></div>
    </section>

    <section v-if="!fileName" class="card card-pad">
      <h2 class="card-title">How It Works</h2>
      <p class="muted howto">Choose a CSV with Lastname, Firstname, MemberIDNo, PastoralService, AreaName, NameOfHouseholdHead, and any formation talk columns. Blank cells never overwrite existing data — only non-blank cells are saved.</p>
    </section>
  </div>
</template>

<style scoped>
.gap { gap: 18px; }
.warn { background: var(--warning-soft); color: var(--warning); align-items: flex-start; }
.chip-x { border: 0; background: none; padding: 0; display: inline-flex; color: var(--muted); }
.errors { max-height: 220px; overflow-y: auto; }
.howto { margin-top: 6px; }
</style>
