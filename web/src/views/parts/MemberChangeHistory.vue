<script setup>
import { ChevronDown, ChevronUp, Download } from 'lucide-vue-next';
import { computed, ref } from 'vue';
import DataTable from '@/components/DataTable.vue';
import DiffPanel from '@/components/DiffPanel.vue';
import LoadingBlock from '@/components/LoadingBlock.vue';
import SearchInput from '@/components/SearchInput.vue';
import { ACTION_TONE, computeDiff, describeChanges, formatLogTime, useAuditLog } from '@/lib/audit';
import { exportCsv } from '@/lib/data';

const ACTIONS = ['All', 'INSERT', 'UPDATE', 'DELETE'];

const { logs, isLoading } = useAuditLog({ channelName: 'member_change_history_feed', tableName: 'members', errorTitle: 'Error Loading Member Change History' });
const actionFilter = ref('All');
const search = ref('');
const expandedId = ref(null);

// Each snapshot carries the name, so a since-deleted member still shows it.
function memberName(log) {
  const record = log.new_data || log.old_data;
  if (!record) return log.record_id || 'Unknown Member';
  const name = `${record.Lastname || ''}, ${record.Firstname || ''}`.trim();
  return name === ',' ? log.record_id || 'Unknown Member' : name;
}

const columns = [
  { key: 'changed_at', label: 'Time', value: (log) => log.changed_at },
  { key: 'member', label: 'Member', value: memberName },
  { key: 'action', label: 'Action' },
  { key: 'actor', label: 'Changed By', value: (log) => log.actor_email || 'System' },
  { key: 'expand', label: '', action: true },
];

const filtered = computed(() => {
  const query = search.value.trim().toLowerCase();
  return logs.value.filter((log) => (actionFilter.value === 'All' || log.action === actionFilter.value)
    && (!query || [log.actor_email, log.record_id, memberName(log)].some((value) => (value || '').toLowerCase().includes(query))));
});

function handleExport() {
  exportCsv('member-change-history', [
    { key: 'time', label: 'Time', value: (log) => formatLogTime(log.changed_at) },
    { key: 'member', label: 'Member', value: memberName },
    { key: 'memberId', label: 'Member ID', value: (log) => log.record_id || '' },
    { key: 'action', label: 'Action' },
    { key: 'actor', label: 'Actor', value: (log) => log.actor_email || 'System' },
    { key: 'changes', label: 'Changes', value: describeChanges },
  ], filtered.value);
}

function toggle(log) {
  expandedId.value = expandedId.value === log.id ? null : log.id;
}
</script>

<template>
  <section class="card">
    <header class="card-head">
      <div>
        <h2 class="card-title">{{ filtered.length }} Event{{ filtered.length === 1 ? '' : 's' }}</h2>
        <p class="card-sub">Every add, edit, and delete ever made to a member record, with before/after values.</p>
      </div>
      <button class="btn" @click="handleExport"><Download :size="14" />Export</button>
    </header>
    <div class="row row-wrap controls">
      <SearchInput v-model="search" placeholder="Search by member, ID, or actor..." class="grow" />
      <div class="tabs"><button v-for="action in ACTIONS" :key="action" class="tab" :class="{ active: actionFilter === action }" @click="actionFilter = action">{{ action }}</button></div>
    </div>
    <LoadingBlock v-if="isLoading" />
    <DataTable v-else :columns="columns" :rows="filtered" empty-text="No member changes recorded yet." :expanded-key="expandedId" clickable @row-click="toggle">
      <template #cell-changed_at="{ row }"><span class="nowrap">{{ formatLogTime(row.changed_at) }}</span></template>
      <template #cell-member="{ row }"><span class="strong">{{ memberName(row) }}</span><br /><code class="small muted">{{ row.record_id || '—' }}</code></template>
      <template #cell-action="{ row }"><span class="pill" :class="ACTION_TONE[row.action]">{{ row.action }}</span></template>
      <template #cell-expand="{ row }"><component :is="expandedId === row.id ? ChevronUp : ChevronDown" :size="14" class="muted" /></template>
      <template #expanded="{ row }"><DiffPanel :diff="computeDiff(row)" /></template>
    </DataTable>
  </section>
</template>

<style scoped>
.controls { padding: 0 20px 12px; }
</style>
