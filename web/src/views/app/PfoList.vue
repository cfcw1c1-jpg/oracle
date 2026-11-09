<script setup>
import { Check, ChevronLeft, ChevronRight } from 'lucide-vue-next';
import { computed, onMounted, ref, watch } from 'vue';
import LoadingBlock from '@/components/LoadingBlock.vue';
import MultiSelect from '@/components/MultiSelect.vue';
import PageHead from '@/components/PageHead.vue';
import SearchInput from '@/components/SearchInput.vue';
import { useIsWide } from '@/composables/useIsWide';
import { buildAreaOptions, loadAssignedAreaNames, matchesArea } from '@/lib/areas';
import { fetchAllRows, showAlert } from '@/lib/data';
import { GROUPED_HEADERS, parseTrainingName, PFO_TRAINING_SELECT, TRAINING_COLUMNS } from '@/lib/formation';
import { supabase } from '@/lib/supabase';

const PAGE_SIZES = [10, 20, 30, 50, 100, 200];

const isWide = useIsWide();
const matrix = ref([]);
const isLoading = ref(true);
const search = ref('');
const assignedAreaNames = ref([]);
const areaFilter = ref('All');
const selectedMemberIds = ref([]);
const page = ref(1);
const pageSize = ref(PAGE_SIZES[1]);

const areaOptions = computed(() => buildAreaOptions(assignedAreaNames.value, matrix.value.map((row) => row.members?.AreaName)));
const memberOptions = computed(() => matrix.value.map((row) => ({ value: row.MemberIDNo, label: `${row.members?.Lastname || ''}, ${row.members?.Firstname || ''}` })));

const filteredRows = computed(() => {
  const query = search.value.trim().toLowerCase();
  return matrix.value.filter((row) => {
    const matchesSearch = !query || [row.members?.Firstname, row.members?.Lastname, row.MemberIDNo].some((value) => String(value ?? '').toLowerCase().includes(query));
    const matchesMember = selectedMemberIds.value.length === 0 || selectedMemberIds.value.includes(row.MemberIDNo);
    return matchesSearch && matchesMember && matchesArea(areaFilter.value, row.members?.AreaName);
  });
});

const pageCount = computed(() => Math.max(1, Math.ceil(filteredRows.value.length / pageSize.value)));
const pageRows = computed(() => filteredRows.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value));

watch([search, areaFilter, selectedMemberIds, pageSize], () => {
  page.value = 1;
});

function displayName(row) {
  return row.members ? `${row.members.Lastname}, ${row.members.Firstname}` : `ID: ${row.MemberIDNo}`;
}

function isChecked(value) {
  return value === 'Y' || value === 'y';
}

async function fetchMatrix() {
  isLoading.value = true;
  try {
    const rows = await fetchAllRows('pfo_members', `${PFO_TRAINING_SELECT}, members (Firstname, Lastname, AreaName)`, { orderBy: 'MemberIDNo' });
    matrix.value = rows.sort((a, b) => (a.members?.Lastname || '').toLowerCase().localeCompare((b.members?.Lastname || '').toLowerCase()));
  } catch (error) {
    showAlert('Error Loading Trainings', error.message);
  } finally {
    isLoading.value = false;
  }
}

// Updates on screen first, and puts the old value back if saving fails.
async function toggleCell(row, columnId) {
  const previous = row[columnId];
  row[columnId] = isChecked(previous) ? 'N' : 'Y';
  try {
    const { error } = await supabase.from('pfo_members').update({ [columnId]: row[columnId] }).eq('MemberIDNo', row.MemberIDNo);
    if (error) throw error;
  } catch (error) {
    row[columnId] = previous;
    showAlert('Update Failed', error.message);
  }
}

onMounted(async () => {
  fetchMatrix();
  try {
    assignedAreaNames.value = await loadAssignedAreaNames();
  } catch (error) {
    console.error('Error loading assigned areas:', error.message);
  }
});
</script>

<template>
  <LoadingBlock v-if="isLoading" />
  <div v-else class="page">
    <PageHead title="Pastoral Formation Grid Matrix" subtitle="Manage qualifications and course milestones instantly across the roster." />

    <div class="row row-wrap">
      <SearchInput v-model="search" placeholder="Search name or ID..." class="grow" />
      <MultiSelect v-model="selectedMemberIds" :options="memberOptions" all-label="All members" noun="member" searchable />
      <select v-model="areaFilter" class="select area" aria-label="Area"><option v-for="option in areaOptions" :key="option">{{ option }}</option></select>
    </div>

    <section class="card matrix-card">
      <div class="matrix">
        <table>
          <thead>
            <tr class="groups">
              <th class="sticky corner" :colspan="isWide ? 2 : 1" />
              <th v-for="(group, index) in GROUPED_HEADERS" :key="`${group.name}-${index}`" :colspan="group.count" class="group" :class="{ alt: index % 2 }"><span class="clamp">{{ group.name }}</span></th>
            </tr>
            <tr>
              <th class="sticky name">Member Name</th>
              <th v-if="isWide" class="sticky id">ID Number</th>
              <th v-for="column in TRAINING_COLUMNS" :key="column.id" class="module" :title="parseTrainingName(column.id)">
                <span class="module-code">{{ column.label }}</span>
                <span class="module-name">{{ parseTrainingName(column.id) || column.label }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in pageRows" :key="row.MemberIDNo">
              <td class="sticky name strong"><span class="clamp block">{{ displayName(row) }}</span></td>
              <td v-if="isWide" class="sticky id muted">{{ row.MemberIDNo }}</td>
              <td v-for="column in TRAINING_COLUMNS" :key="column.id" class="cell">
                <button class="tick" :class="{ on: isChecked(row[column.id]) }" :aria-label="`${column.label}, ${displayName(row)}`" :aria-pressed="isChecked(row[column.id])" @click="toggleCell(row, column.id)">
                  <Check v-if="isChecked(row[column.id])" :size="13" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="!filteredRows.length" class="empty">No tracking profiles matched your search and filters.</p>
      </div>
      <footer class="foot">
        <span class="muted small">{{ filteredRows.length }} members</span>
        <div class="row row-wrap">
          <label class="row small muted">Rows
            <select v-model.number="pageSize" class="select sm"><option v-for="size in PAGE_SIZES" :key="size">{{ size }}</option></select>
          </label>
          <button class="icon-btn" :disabled="page === 1" aria-label="Previous page" @click="page -= 1"><ChevronLeft :size="16" /></button>
          <span class="small">{{ page }} / {{ pageCount }}</span>
          <button class="icon-btn" :disabled="page === pageCount" aria-label="Next page" @click="page += 1"><ChevronRight :size="16" /></button>
        </div>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.area { width: auto; min-width: 170px; }
.matrix-card { overflow: hidden; }
.matrix { overflow: auto; max-height: 62vh; }
table { border-collapse: separate; border-spacing: 0; font-size: 12.5px; }
th, td { border-bottom: 1px solid var(--line); background: var(--surface); }
thead th { position: sticky; top: 0; z-index: 2; }
thead tr:nth-child(2) th { top: 31px; }
.group { height: 31px; padding: 0 8px; background: var(--surface-soft); font-size: 11px; font-weight: 600; text-align: left; max-width: 0; }
.group.alt { background: var(--accent-soft); }
.module { width: 106px; min-width: 106px; padding: 6px; text-align: center; font-weight: 500; vertical-align: top; }
.module-code { display: block; font-weight: 600; font-size: 11.5px; }
.module-name { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 10px; color: var(--muted); }
.sticky { position: sticky; z-index: 3; }
thead .sticky { z-index: 5; }
.corner { left: 0; }
.name { left: 0; width: 190px; min-width: 190px; max-width: 190px; padding: 9px 12px; text-align: left; }
.id { left: 190px; width: 110px; min-width: 110px; padding: 9px 12px; text-align: left; border-right: 1px solid var(--line); }
.block { display: block; }
.cell { text-align: center; padding: 4px; }
.tick { width: 24px; height: 24px; border-radius: 7px; border: 1.5px solid var(--line); background: var(--surface); color: var(--primary-ink); display: inline-flex; align-items: center; justify-content: center; padding: 0; }
.tick:hover { border-color: var(--accent); }
.tick.on { background: var(--primary); border-color: var(--primary); }
.foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 14px; border-top: 1px solid var(--line); flex-wrap: wrap; }
.select.sm { width: auto; padding: 4px 8px; font-size: 12px; }
@media (max-width: 767.98px) {
  .name { width: 150px; min-width: 150px; max-width: 150px; border-right: 1px solid var(--line); }
}
</style>
