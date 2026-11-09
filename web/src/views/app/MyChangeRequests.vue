<script setup>
import { ArrowRight, ChevronDown, ChevronUp } from 'lucide-vue-next';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import DataTable from '@/components/DataTable.vue';
import LoadingBlock from '@/components/LoadingBlock.vue';
import PageHead from '@/components/PageHead.vue';
import { CHANGE_STATUS, formatChangeValue, requestDate } from '@/lib/changeRequests';
import { showAlert } from '@/lib/data';
import { supabase } from '@/lib/supabase';
import { sessionState } from '@/stores/session';

const FILTERS = ['all', 'pending', 'on_going', 'approved', 'rejected'];
const COLUMNS_SELECT = 'id, member_id, changes, previous_values, status, reviewed_by_email, assigned_to_email, rejection_reason, created_at, members ( Firstname, Lastname )';

const requests = ref([]);
const isLoading = ref(true);
const statusFilter = ref('all');
const expandedId = ref(null);
let channel;

const memberName = (request) => `${request.members?.Lastname || ''}, ${request.members?.Firstname || ''}`.trim();
const handledBy = (request) => request.reviewed_by_email || request.assigned_to_email || '—';
const filtered = computed(() => requests.value.filter((request) => statusFilter.value === 'all' || request.status === statusFilter.value));

const columns = [
  { key: 'name', label: 'Name', value: memberName },
  { key: 'changes', label: 'Changes', value: (request) => Object.keys(request.changes || {}).length },
  { key: 'status', label: 'Status', value: (request) => CHANGE_STATUS[request.status]?.label || request.status },
  { key: 'created_at', label: 'Submitted', value: (request) => request.created_at },
  { key: 'handled', label: 'Handled By', value: handledBy },
  { key: 'expand', label: '', action: true },
];

async function load(userId) {
  try {
    const { data, error } = await supabase.from('member_change_requests').select(COLUMNS_SELECT).eq('requested_by', userId).order('created_at', { ascending: false }).limit(300);
    if (error) throw error;
    requests.value = data || [];
  } catch (error) {
    showAlert('Error Loading Your Change Requests', error.message);
  } finally {
    isLoading.value = false;
  }
}

onMounted(() => {
  const userId = sessionState.session?.user?.id;
  if (!userId) return;
  load(userId);
  channel = supabase
    .channel('my_change_requests_feed')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'member_change_requests', filter: `requested_by=eq.${userId}` }, () => load(userId))
    .subscribe();
});
onBeforeUnmount(() => channel && supabase.removeChannel(channel));

function toggle(request) {
  expandedId.value = expandedId.value === request.id ? null : request.id;
}
</script>

<template>
  <div class="page">
    <PageHead :title="`My Change Requests (${filtered.length})`" subtitle="Track your Directory edits while they wait for approval." />
    <div class="tabs">
      <button v-for="status in FILTERS" :key="status" class="tab" :class="{ active: statusFilter === status }" @click="statusFilter = status">{{ status === 'all' ? 'All' : CHANGE_STATUS[status].label }}</button>
    </div>
    <section class="card">
      <LoadingBlock v-if="isLoading" />
      <DataTable v-else :columns="columns" :rows="filtered" :empty-text="statusFilter === 'all' ? 'You haven\'t submitted any Directory edits yet.' : 'No matching requests.'" :expanded-key="expandedId" clickable @row-click="toggle">
        <template #cell-name="{ row }"><span class="strong">{{ memberName(row) || 'Unknown Member' }}</span><br /><span class="muted small">ID: {{ row.member_id }}</span></template>
        <template #cell-changes="{ row }"><span class="strong">{{ Object.keys(row.changes || {}).length }} Field{{ Object.keys(row.changes || {}).length === 1 ? '' : 's' }}</span><br /><span class="muted small">{{ Object.keys(row.changes || {}).join(', ') || 'No fields changed' }}</span></template>
        <template #cell-status="{ row }"><span class="pill" :class="CHANGE_STATUS[row.status]?.tone">{{ CHANGE_STATUS[row.status]?.label || row.status }}</span></template>
        <template #cell-created_at="{ row }"><span class="nowrap">{{ requestDate(row.created_at) }}</span></template>
        <template #cell-expand="{ row }"><component :is="expandedId === row.id ? ChevronUp : ChevronDown" :size="15" class="muted" /></template>
        <template #expanded="{ row }">
          <p v-if="!Object.keys(row.changes || {}).length" class="muted small">No field-level changes recorded.</p>
          <div v-for="(newValue, key) in row.changes || {}" :key="key" class="change">
            <span class="strong clamp">{{ key }}</span>
            <span class="text-danger">{{ formatChangeValue(row.previous_values?.[key]) }}</span>
            <ArrowRight :size="12" />
            <span class="text-success">{{ formatChangeValue(newValue) }}</span>
          </div>
          <p v-if="row.status === 'rejected' && row.rejection_reason" class="small text-danger reason">Reason: {{ row.rejection_reason }}</p>
        </template>
      </DataTable>
    </section>
  </div>
</template>

<style scoped>
.change { display: grid; grid-template-columns: minmax(90px, 200px) 1fr auto 1fr; gap: 8px; align-items: center; font-size: 12px; padding: 2px 0; }
.reason { margin-top: 8px; }
</style>
