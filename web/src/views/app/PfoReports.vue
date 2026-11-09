<script setup>
import { CheckCircle2, ChevronDown, CircleX, Download, MinusCircle } from 'lucide-vue-next';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import DataTable from '@/components/DataTable.vue';
import LoadingBlock from '@/components/LoadingBlock.vue';
import PageHead from '@/components/PageHead.vue';
import SearchInput from '@/components/SearchInput.vue';
import StatCard from '@/components/StatCard.vue';
import { buildAreaOptions, loadAssignedAreaNames, matchesArea } from '@/lib/areas';
import { downloadBlob, fetchAllRows, isActiveStatus, showAlert } from '@/lib/data';
import { getRoleLabel, normalizeRole } from '@/lib/formation';
import { REPORT_COLUMNS } from '@/lib/pfoReportColumns';

const NO_HOUSEHOLD_HEAD = 'No Household Head';
const OVERALL_STATUSES = ['Attended all', 'Attended but with missing', 'Not Attended'];

const selected = ref([]);
const isPickerOpen = ref(false);
const picker = ref(null);
const query = ref('');
const reportData = ref([]);
const isLoading = ref(false);
const assignedAreaNames = ref([]);
const areaFilter = ref('All');
const groupByHousehold = ref(false);

const householdOf = (item) => (item.members?.NameOfHouseholdHead || '').trim() || NO_HOUSEHOLD_HEAD;
const memberName = (item) => (item.members ? `${item.members.Lastname}, ${item.members.Firstname}` : `ID: ${item.MemberIDNo}`);
const trackCode = (id) => id.split('-')[0].replace('_', '.').replace(/\s+/g, '');
const attended = (value) => value === 'Y' || value === 'y';
const overallStatus = (item) => (item.attendedAll ? OVERALL_STATUSES[0] : item.attendedCount > 0 ? OVERALL_STATUSES[1] : OVERALL_STATUSES[2]);
const roleOf = (item) => getRoleLabel(normalizeRole(item.members?.PastoralService));

function compareHouseholds(a, b) {
  if (a === b) return 0;
  if (a === NO_HOUSEHOLD_HEAD) return 1;
  if (b === NO_HOUSEHOLD_HEAD) return -1;
  return a.toLowerCase().localeCompare(b.toLowerCase());
}

const visibleColumns = computed(() => {
  const text = query.value.trim().toLowerCase();
  return text ? REPORT_COLUMNS.filter((column) => column.label.toLowerCase().includes(text) || column.group.toLowerCase().includes(text)) : REPORT_COLUMNS;
});
const allVisibleSelected = computed(() => visibleColumns.value.length > 0 && visibleColumns.value.every((column) => isChosen(column)));
const pickerSummary = computed(() => (selected.value.length ? selected.value.map((column) => column.label).join(', ') : 'None selected'));

function isChosen(column) {
  return selected.value.some((item) => item.id === column.id);
}

function toggleColumn(column) {
  selected.value = isChosen(column) ? selected.value.filter((item) => item.id !== column.id) : [...selected.value, column];
}

function toggleAllVisible() {
  const visibleIds = new Set(visibleColumns.value.map((column) => column.id));
  selected.value = allVisibleSelected.value ? selected.value.filter((item) => !visibleIds.has(item.id)) : [...selected.value, ...visibleColumns.value.filter((column) => !isChosen(column))];
}

const areaOptions = computed(() => buildAreaOptions(assignedAreaNames.value, reportData.value.map((row) => row.members?.AreaName)));
const filteredRows = computed(() => {
  const rows = reportData.value.filter((row) => matchesArea(areaFilter.value, row.members?.AreaName));
  return groupByHousehold.value ? [...rows].sort((a, b) => compareHouseholds(householdOf(a), householdOf(b))) : rows;
});

// Numbers restart inside each household when grouped.
const numberedRows = computed(() => {
  let previous = null;
  let number = 0;
  return filteredRows.value.map((item) => {
    const head = householdOf(item);
    number = groupByHousehold.value && head !== previous ? 1 : number + 1;
    previous = head;
    return { ...item, rowNumber: number };
  });
});

const counts = computed(() => filteredRows.value.reduce((tally, item) => {
  if (item.attendedCount === 0) tally.failed += 1;
  else if (item.attendedAll) tally.passed += 1;
  else tally.mixed += 1;
  return tally;
}, { passed: 0, failed: 0, mixed: 0 }));

const columns = computed(() => [
  { key: 'rowNumber', label: '#', width: '56px' },
  ...(groupByHousehold.value ? [{ key: 'household', label: 'Household Head', value: householdOf }] : []),
  { key: 'name', label: 'Member Name', value: memberName },
  { key: 'MemberIDNo', label: 'ID Number' },
  { key: 'status', label: 'Status', value: (item) => (item.attendedAll ? 'Attended' : 'Missing') },
]);

let reportToken = 0;
async function generateReport() {
  const chosen = selected.value;
  const token = ++reportToken;
  if (!chosen.length) {
    reportData.value = [];
    return;
  }
  isLoading.value = true;
  try {
    const columnList = chosen.map((column) => `"${column.id}"`).join(', ');
    const data = await fetchAllRows('pfo_members', `MemberIDNo, ${columnList}, members (Firstname, Lastname, AreaName, PastoralService, NameOfHouseholdHead, Status)`, { orderBy: 'MemberIDNo' });
    if (token !== reportToken) return;
    reportData.value = data
      .filter((item) => isActiveStatus(item.members?.Status))
      .map((item) => {
        const attendedCount = chosen.filter((column) => attended(item[column.id])).length;
        return { ...item, attendedCount, attendedAll: attendedCount === chosen.length };
      })
      .sort((a, b) => (a.members?.Lastname || '').toLowerCase().localeCompare((b.members?.Lastname || '').toLowerCase()));
  } catch (error) {
    showAlert('Error Compiling Report', error.message);
  } finally {
    if (token === reportToken) isLoading.value = false;
  }
}
watch(selected, generateReport);

function canExport() {
  if (!selected.value.length) {
    showAlert('No Filters Selected', 'Please select at least one training column filter target before running extraction.');
    return false;
  }
  if (!filteredRows.value.length) {
    showAlert('Empty Dataset', 'There are no member records available to process.');
    return false;
  }
  return true;
}

function fileStamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function exportName(extension) {
  return `cfc-pfo-report${groupByHousehold.value ? '-by-household' : ''}-${fileStamp()}.${extension}`;
}

function exportTxt() {
  if (!canExport()) return;
  const rows = filteredRows.value;
  const now = new Date();
  const divider = '-------|------------------------------------------|-------------|------------------\n';
  const rule = '-----------------------------------------------------------------------\n';
  let text = `=======================================================================\n                     PFO TRAINING MATRIX ACCREDITATION\n=======================================================================\n`;
  text += `COMPILED DATE:     ${now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} ${now.toLocaleTimeString('en-GB')}\n`;
  text += `TOTAL DATA COUNT:  ${rows.length} Registered Row Entries\nMEMBER STATUS:     Active members only\n`;
  if (groupByHousehold.value) text += 'GROUPED BY:        Household Head\n';
  text += `STATUS KEY:        Y = Attended Already | N = Not Yet Attended\n${rule}MANDATED TRACK FILTER TARGETS CHECKED:\n`;
  selected.value.forEach((column) => {
    text += `  [${trackCode(column.id)}]: — ${column.label}\n`;
  });
  text += `${rule}\n   #   | MEMBER NAME                              | ID NUMBER   | STATUS BREAKDOWN\n${divider}`;

  let currentHead = null;
  let groupIndex = 0;
  rows.forEach((item, index) => {
    if (groupByHousehold.value && householdOf(item) !== currentHead) {
      currentHead = householdOf(item);
      groupIndex = 0;
      text += `\n HOUSEHOLD HEAD: ${currentHead}\n${divider}`;
    }
    groupIndex += 1;
    const name = `${item.members?.Lastname || ''}, ${item.members?.Firstname || ''}`.padEnd(40, ' ').substring(0, 40);
    const done = selected.value.filter((column) => attended(item[column.id])).map((column) => trackCode(column.id));
    const missing = selected.value.filter((column) => !attended(item[column.id])).map((column) => trackCode(column.id));
    const parts = [];
    if (done.length) parts.push(`Attended: ${done.join(', ')}`);
    if (missing.length) parts.push(`Not Attended: ${missing.length === selected.value.length ? 'All' : missing.join(', ')}`);
    text += ` ${String(groupByHousehold.value ? groupIndex : index + 1).padEnd(4, ' ')} | ${name} | ${String(item.MemberIDNo || 'N/A').padEnd(11, ' ')} | ${parts.join(' | ')}\n`;
  });
  text += `\n${rule}End of Matrix Document — Securely compiled via PFO Portal Engine.\n`;
  downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), exportName('txt'));
}

function detailHeader() {
  return ['Member Name', 'Member ID', 'Area', 'Role', ...selected.value.map((column) => trackCode(column.id)), 'Overall Status'];
}

function detailCells(item) {
  return [`${item.members?.Lastname || ''}, ${item.members?.Firstname || ''}`, item.MemberIDNo || 'N/A', item.members?.AreaName || '', roleOf(item), ...selected.value.map((column) => (attended(item[column.id]) ? 'Y' : 'N')), overallStatus(item)];
}

function statusSheet(status) {
  const header = ['#', ...(groupByHousehold.value ? ['Household Head'] : []), ...detailHeader()];
  return [header, ...filteredRows.value.filter((item) => overallStatus(item) === status).map((item, index) => [index + 1, ...(groupByHousehold.value ? [householdOf(item)] : []), ...detailCells(item)])];
}

function householdDetailSheet() {
  const groups = new Map();
  filteredRows.value.forEach((item) => groups.set(householdOf(item), [...(groups.get(householdOf(item)) || []), item]));
  const rows = [];
  groups.forEach((members, head) => {
    if (rows.length) rows.push([]);
    const breakdown = OVERALL_STATUSES.map((status) => `${status}: ${members.filter((member) => overallStatus(member) === status).length}`).join(' | ');
    rows.push([`HOUSEHOLD HEAD: ${head}`, `${members.length} member${members.length === 1 ? '' : 's'}`, breakdown]);
    members.forEach((item, index) => rows.push([index + 1, ...detailCells(item)]));
  });
  return [['#', ...detailHeader()], ...rows];
}

function summarySheet(label, keyOf, sortKeys) {
  const tally = new Map();
  filteredRows.value.forEach((item) => {
    const key = keyOf(item);
    if (!tally.has(key)) tally.set(key, Object.fromEntries(OVERALL_STATUSES.map((status) => [status, 0])));
    tally.get(key)[overallStatus(item)] += 1;
  });
  const keys = sortKeys ? [...tally.keys()].sort() : [...tally.keys()];
  const totals = Object.fromEntries(OVERALL_STATUSES.map((status) => [status, 0]));
  const rows = keys.map((key) => {
    const entry = tally.get(key);
    OVERALL_STATUSES.forEach((status) => {
      totals[status] += entry[status];
    });
    return [key, ...OVERALL_STATUSES.map((status) => entry[status]), OVERALL_STATUSES.reduce((sum, status) => sum + entry[status], 0)];
  });
  return [[label, ...OVERALL_STATUSES, 'Total'], ...rows, ['TOTAL', ...OVERALL_STATUSES.map((status) => totals[status]), filteredRows.value.length]];
}

async function exportXlsx() {
  if (!canExport()) return;
  try {
    const XLSX = await import('xlsx');
    const workbook = XLSX.utils.book_new();
    const addSheet = (rows, name) => XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
    OVERALL_STATUSES.forEach((status) => addSheet(statusSheet(status), status));
    if (groupByHousehold.value) {
      addSheet(householdDetailSheet(), 'Members by Household');
      addSheet(summarySheet('Household Head', householdOf, false), 'Summary by Household');
    }
    addSheet(summarySheet('Role', roleOf, true), 'Summary by Role');
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    downloadBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), exportName('xlsx'));
  } catch (error) {
    console.error(error);
    showAlert('Export Failed', 'An error occurred while compiling your matrix spreadsheet file.');
  }
}

function closeOnOutside(event) {
  if (!picker.value?.contains(event.target)) isPickerOpen.value = false;
}

onMounted(async () => {
  document.addEventListener('mousedown', closeOnOutside);
  try {
    assignedAreaNames.value = await loadAssignedAreaNames();
  } catch (error) {
    console.error('Error loading assigned areas:', error.message);
  }
});
onBeforeUnmount(() => document.removeEventListener('mousedown', closeOnOutside));
</script>

<template>
  <div class="page">
    <PageHead title="PFO Training Reports" subtitle="Filter multiple milestone validation tracks synchronously.">
      <button class="btn" :disabled="isLoading" @click="exportTxt"><Download :size="14" />Export as TXT</button>
      <button class="btn btn-primary" :disabled="isLoading" @click="exportXlsx"><Download :size="14" />Export as XLSX</button>
    </PageHead>

    <section class="card card-pad filters">
      <div ref="picker" class="field picker">
        <span class="field-label">Selected Filter Targets ({{ selected.length }})</span>
        <button class="select head" :aria-expanded="isPickerOpen" @click="isPickerOpen = !isPickerOpen"><span class="clamp">{{ pickerSummary }}</span><ChevronDown :size="14" /></button>
        <div v-if="isPickerOpen" class="menu">
          <SearchInput v-model="query" placeholder="Search and toggle multiple tracks..." />
          <label class="check strong"><input type="checkbox" :checked="allVisibleSelected" @change="toggleAllVisible" />{{ allVisibleSelected ? 'Deselect All' : 'Select All' }} ({{ visibleColumns.length }})</label>
          <div class="menu-list">
            <label v-for="column in visibleColumns" :key="column.id" class="check item">
              <input type="checkbox" :checked="isChosen(column)" @change="toggleColumn(column)" />
              <span class="grow"><span class="block">{{ column.label }}</span><span class="muted small block">{{ column.group }}</span></span>
            </label>
            <p v-if="!visibleColumns.length" class="muted small">No training tracks match your entry.</p>
          </div>
          <button class="btn btn-primary btn-block" @click="isPickerOpen = false">Apply Selected Filters</button>
        </div>
      </div>
      <label class="field area"><span class="field-label">Area</span><select v-model="areaFilter" class="select"><option v-for="option in areaOptions" :key="option">{{ option }}</option></select></label>
      <div class="field"><span class="field-label">Group By</span><label class="check grouped"><input v-model="groupByHousehold" type="checkbox" />Household Head</label></div>
    </section>

    <section class="grid grid-4">
      <StatCard label="Passed Matches" :value="isLoading ? '...' : counts.passed" :icon="CheckCircle2" />
      <StatCard label="Failed Matches" :value="isLoading ? '...' : counts.failed" :icon="CircleX" />
      <StatCard label="Mixed Matches" :value="isLoading ? '...' : counts.mixed" :icon="MinusCircle" />
    </section>

    <section class="card">
      <div v-if="isLoading" class="working"><LoadingBlock /><p class="muted small">Cross-matching dynamic criteria matrices...</p></div>
      <DataTable v-else :columns="columns" :rows="numberedRows" row-key="MemberIDNo" empty-text="No matching membership targets found.">
        <template #cell-name="{ value }"><span class="strong">{{ value }}</span></template>
        <template #cell-status="{ row }"><span class="pill" :class="row.attendedAll ? 'success' : 'danger'">{{ row.attendedAll ? 'Attended' : 'Missing' }}</span></template>
      </DataTable>
    </section>
  </div>
</template>

<style scoped>
.filters { display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-start; }
.picker { position: relative; flex: 1; min-width: 240px; }
.head { display: flex; align-items: center; justify-content: space-between; gap: 8px; text-align: left; }
.menu { position: absolute; z-index: 40; top: calc(100% + 5px); left: 0; right: 0; min-width: 280px; padding: 12px; display: flex; flex-direction: column; gap: 10px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-md); box-shadow: var(--shadow-pop); }
.menu-list { max-height: 280px; overflow-y: auto; }
.item { display: flex; align-items: flex-start; padding: 6px 2px; }
.block { display: block; }
.area { min-width: 180px; }
.grouped { padding: 8px 0; }
.working { padding: 8px 0 24px; text-align: center; }
</style>
