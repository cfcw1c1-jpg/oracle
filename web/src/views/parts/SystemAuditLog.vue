<script setup>
import { ChevronDown, ChevronUp, Download } from 'lucide-vue-next';
import { computed, ref } from 'vue';
import DataTable from '@/components/DataTable.vue';
import DiffPanel from '@/components/DiffPanel.vue';
import LoadingBlock from '@/components/LoadingBlock.vue';
import SearchInput from '@/components/SearchInput.vue';
import { ACTION_TONE, computeDiff, describeChanges, formatLogTime, useAuditLog } from '@/lib/audit';
import { exportCsv } from '@/lib/data';

const TABLE_LABELS = {
  members: 'Members', pfo_members: 'PFO Records', clp_trainings: 'CLP Trainings', clp_training_participants: 'CLP Participants',
  areas: 'Areas', area_members: 'Area Members', roles: 'Roles', pages: 'Pages', role_pages: 'Role Page Access',
  profiles: 'Portal Users', user_areas: 'User Area Assignments',
};
const ACTIONS = ['All', 'INSERT', 'UPDATE', 'DELETE', 'PAGE_VIEW'];

const { logs, isLoading } = useAuditLog({ channelName: 'audit_log_feed', errorTitle: 'Error Loading Audit Log' });
const tableFilter = ref('All');
const actionFilter = ref('All');
const search = ref('');
const expandedId = ref(null);

function tableLabel(log) {
  if (log.table_name?.startsWith('page:')) return log.new_data?.page || log.table_name.slice(5);
  return TABLE_LABELS[log.table_name] || log.table_name;
}

const columns = [
  { key: 'changed_at', label: 'Time', value: (log) => log.changed_at },
  { key: 'table', label: 'Table', value: tableLabel },
  { key: 'action', label: 'Action' },
  { key: 'actor', label: 'Actor', value: (log) => log.actor_email || 'System' },
  { key: 'record', label: 'Record', value: (log) => log.record_id },
  { key: 'expand', label: '', action: true },
];

const filtered = computed(() => {
  const query = search.value.trim().toLowerCase();
  return logs.value.filter((log) => (tableFilter.value === 'All' || log.table_name === tableFilter.value)
    && (actionFilter.value === 'All' || log.action === actionFilter.value)
    && (!query || (log.actor_email || '').toLowerCase().includes(query) || (log.record_id || '').toLowerCase().includes(query)));
});

function handleExport() {
  exportCsv('system-audit-log', [
    { key: 'time', label: 'Time', value: (log) => formatLogTime(log.changed_at) },
    { key: 'table', label: 'Table', value: tableLabel },
    { key: 'action', label: 'Action' },
    { key: 'actor', label: 'Actor', value: (log) => log.actor_email || 'System' },
    { key: 'record', label: 'Record ID', value: (log) => log.record_id || '' },
    { key: 'changes', label: 'Changes', value: (log) => (log.action === 'PAGE_VIEW' ? `page: ${tableLabel(log)}` : describeChanges(log)) },
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
        <p class="card-sub">Live record of every insert, update, and delete across the app's data.</p>
      </div>
      <button class="btn" @click="handleExport"><Download :size="14" />Export</button>
    </header>
    <div class="row row-wrap controls">
      <SearchInput v-model="search" placeholder="Search by actor or record ID..." class="grow" />
      <select v-model="tableFilter" class="select table-select" aria-label="Table">
        <option value="All">All Tables</option>
        <option v-for="(label, key) in TABLE_LABELS" :key="key" :value="key">{{ label }}</option>
      </select>
      <div class="tabs"><button v-for="action in ACTIONS" :key="action" class="tab" :class="{ active: actionFilter === action }" @click="actionFilter = action">{{ action }}</button></div>
    </div>
    <LoadingBlock v-if="isLoading" />
    <DataTable v-else :columns="columns" :rows="filtered" empty-text="No matching audit events yet." :expanded-key="expandedId" clickable @row-click="toggle">
      <template #cell-changed_at="{ row }"><span class="nowrap">{{ formatLogTime(row.changed_at) }}</span></template>
      <template #cell-action="{ row }"><span class="pill" :class="ACTION_TONE[row.action]">{{ row.action }}</span></template>
      <template #cell-record="{ row }"><code class="small">{{ row.record_id || '—' }}</code></template>
      <template #cell-expand="{ row }"><component :is="expandedId === row.id ? ChevronUp : ChevronDown" :size="14" class="muted" /></template>
      <template #expanded="{ row }">
        <p v-if="row.action === 'PAGE_VIEW'" class="muted small">Opened the "{{ tableLabel(row) }}" page.</p>
        <DiffPanel v-else :diff="computeDiff(row)" />
      </template>
    </DataTable>
  </section>
</template>

<style scoped>
.controls { padding: 0 20px 12px; }
.table-select { width: auto; min-width: 170px; }
</style>
