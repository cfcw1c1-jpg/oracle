<script setup>
import { Download } from 'lucide-vue-next';
import { computed, onMounted, ref } from 'vue';
import DataTable from '@/components/DataTable.vue';
import LoadingBlock from '@/components/LoadingBlock.vue';
import StatCard from '@/components/StatCard.vue';
import { exportCsv, fetchAllRows, isActiveStatus, showAlert } from '@/lib/data';
import { supabase } from '@/lib/supabase';

const isLoading = ref(true);
const areas = ref([]);
const members = ref([]);
const fixingId = ref(null);

function normalize(text) {
  return (text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function matchesAreaPrefix(memberArea, areaName) {
  const prefix = normalize(areaName);
  return Boolean(prefix) && normalize(memberArea).startsWith(prefix);
}

function levenshtein(a, b) {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = a[i - 1] === b[j - 1] ? previous[j - 1] : 1 + Math.min(previous[j], current[j - 1], previous[j - 1]);
    }
    previous = current;
  }
  return previous[b.length];
}

// The tolerance grows with length so short names still need a close match.
function suggestArea(memberArea) {
  const target = normalize(memberArea);
  let best = null;
  let bestDistance = Infinity;
  areas.value.forEach((area) => {
    const distance = levenshtein(target, normalize(area.name));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = area;
    }
  });
  return bestDistance <= Math.max(2, Math.floor(target.length * 0.35)) ? best : null;
}

const byLastname = (a, b) => (a.Lastname || '').localeCompare(b.Lastname || '');
const activeMembers = computed(() => members.value.filter((member) => isActiveStatus(member.Status)));
const unmatched = computed(() => activeMembers.value
  .filter((member) => (member.AreaName || '').trim() && !areas.value.some((area) => matchesAreaPrefix(member.AreaName, area.name)))
  .map((member) => ({ ...member, suggestion: suggestArea(member.AreaName) }))
  .sort(byLastname));
const noArea = computed(() => activeMembers.value.filter((member) => !(member.AreaName || '').trim()).sort(byLastname));
const emptyAreas = computed(() => areas.value.filter((area) => !activeMembers.value.some((member) => matchesAreaPrefix(member.AreaName, area.name))));

const memberName = (member) => `${member.Lastname}, ${member.Firstname}`;
const unmatchedColumns = [
  { key: 'name', label: 'Member', value: memberName },
  { key: 'MemberIDNo', label: 'Member ID' },
  { key: 'AreaName', label: 'Area as Entered' },
  { key: 'suggestion', label: 'Suggested Area', value: (member) => member.suggestion?.name },
  { key: 'fix', label: 'Action', action: true },
];
const noAreaColumns = [{ key: 'name', label: 'Member', value: memberName }, { key: 'MemberIDNo', label: 'Member ID' }];
const emptyAreaColumns = [{ key: 'name', label: 'Area' }, { key: 'type', label: 'Type' }];

async function load() {
  isLoading.value = true;
  try {
    const [areaResult, memberRows] = await Promise.all([
      supabase.from('areas').select('id, name, type').order('name'),
      fetchAllRows('members', 'MemberIDNo, Lastname, Firstname, AreaName, Status', { orderBy: 'MemberIDNo' }),
    ]);
    if (areaResult.error) throw areaResult.error;
    areas.value = areaResult.data || [];
    members.value = memberRows;
  } catch (error) {
    showAlert('Error Loading Data Health', error.message);
  } finally {
    isLoading.value = false;
  }
}

async function applySuggestion(member) {
  fixingId.value = member.MemberIDNo;
  try {
    const { error } = await supabase.from('members').update({ AreaName: member.suggestion.name }).eq('MemberIDNo', member.MemberIDNo);
    if (error) throw error;
    await load();
  } catch (error) {
    showAlert('Fix Failed', error.message);
  } finally {
    fixingId.value = null;
  }
}

function handleExport() {
  exportCsv('data-health-unmatched-areas', [
    { key: 'MemberIDNo', label: 'Member ID' },
    { key: 'name', label: 'Name', value: memberName },
    { key: 'AreaName', label: 'AreaName (as entered)' },
    { key: 'suggestion', label: 'Suggested Area', value: (member) => member.suggestion?.name || '' },
  ], unmatched.value);
}

onMounted(load);
</script>

<template>
  <LoadingBlock v-if="isLoading" />
  <div v-else class="stack gap">
    <p class="muted">Finds Directory records whose Area doesn't line up with the Areas hierarchy. These members are invisible to any area-restricted account and don't count toward that Area's totals.</p>
    <section class="grid grid-4">
      <StatCard label="Unmatched Area" :value="unmatched.length" />
      <StatCard label="No Area Set" :value="noArea.length" />
      <StatCard label="Areas With No Members" :value="emptyAreas.length" />
    </section>

    <section class="card">
      <header class="card-head">
        <div>
          <h2 class="card-title">Unmatched Area ({{ unmatched.length }})</h2>
          <p class="card-sub">Active members whose Area text doesn't prefix-match any real Area — most often a typo.</p>
        </div>
        <button v-if="unmatched.length" class="btn" @click="handleExport"><Download :size="14" />Export</button>
      </header>
      <DataTable :columns="unmatchedColumns" :rows="unmatched" row-key="MemberIDNo" empty-text="Every active member's Area matches the Areas hierarchy.">
        <template #cell-AreaName="{ row }"><span class="pill danger">{{ row.AreaName }}</span></template>
        <template #cell-suggestion="{ row }">{{ row.suggestion ? `→ ${row.suggestion.name}?` : 'No close match' }}</template>
        <template #cell-fix="{ row }"><button v-if="row.suggestion" class="btn btn-primary btn-sm" :disabled="fixingId === row.MemberIDNo" @click="applySuggestion(row)">{{ fixingId === row.MemberIDNo ? 'Applying…' : 'Apply' }}</button></template>
      </DataTable>
    </section>

    <section class="card">
      <header class="card-head">
        <div>
          <h2 class="card-title">No Area Set ({{ noArea.length }})</h2>
          <p class="card-sub">Active members with a blank Area — always visible everywhere (unrestricted), but not counted under any Area.</p>
        </div>
      </header>
      <DataTable :columns="noAreaColumns" :rows="noArea" row-key="MemberIDNo" empty-text="Every active member has an Area set." />
    </section>

    <section class="card">
      <header class="card-head">
        <div>
          <h2 class="card-title">Areas With No Members ({{ emptyAreas.length }})</h2>
          <p class="card-sub">Areas whose name doesn't prefix-match any active Directory member.</p>
        </div>
      </header>
      <DataTable :columns="emptyAreaColumns" :rows="emptyAreas" empty-text="Every Area has at least one matching member.">
        <template #cell-type="{ value }"><span class="pill">{{ value }}</span></template>
      </DataTable>
    </section>
  </div>
</template>

<style scoped>
.gap { gap: 18px; }
</style>
