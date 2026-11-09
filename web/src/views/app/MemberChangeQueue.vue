<script setup>
import { ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, MessageCircle, X } from 'lucide-vue-next';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import AppModal from '@/components/AppModal.vue';
import LoadingBlock from '@/components/LoadingBlock.vue';
import PageHead from '@/components/PageHead.vue';
import { CHANGE_STATUS, formatChangeValue, requestDate } from '@/lib/changeRequests';
import { exportCsv, showAlert } from '@/lib/data';
import { supabase } from '@/lib/supabase';

const props = defineProps({ onOpenConversation: { type: Function, default: null } });

const FILTERS = ['pending', 'on_going', 'approved', 'rejected', 'all'];
const SELECT = 'id, member_id, requested_by, requested_by_email, changes, previous_values, status, reviewed_by_email, reviewed_at, rejection_reason, created_at, assigned_to_email, conversation_id, members ( Firstname, Lastname )';
const PAGE_SIZES = [10, 20, 30, 50, 100, 200];

const requests = ref([]);
const isLoading = ref(true);
const statusFilter = ref('pending');
const processingId = ref(null);
const processingGroup = ref(null);
const messagingId = ref(null);
const expandedId = ref(null);
const expandedGroup = ref(null);
const rejectTarget = ref(null);
const rejectReason = ref('');
const page = ref(1);
const pageSize = ref(PAGE_SIZES[0]);
let channel;

const memberName = (request) => `${request.members?.Lastname || ''}, ${request.members?.Firstname || ''}`.trim();
const changeCount = (request) => Object.keys(request.changes || {}).length;
const groupKeyOf = (request) => request.requested_by || `__no_requester_${request.id}`;

function initialsFromEmail(email) {
  const parts = (email || '').split('@')[0].split(/[._-]+/).filter(Boolean);
  return parts.length ? (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase() : '?';
}

const filtered = computed(() => requests.value.filter((request) => statusFilter.value === 'all' || request.status === statusFilter.value));

// One group per requester, ordered by each requester's newest request.
const groups = computed(() => {
  const map = new Map();
  filtered.value.forEach((request) => {
    const key = groupKeyOf(request);
    map.set(key, [...(map.get(key) || []), request]);
  });
  return [...map.entries()]
    .map(([key, items]) => {
      const pending = items.filter((item) => item.status === 'pending');
      const onGoing = items.filter((item) => item.status === 'on_going');
      return { key, items, email: items[0].requested_by_email, memberCount: new Set(items.map((item) => item.member_id)).size, actionable: [...pending, ...onGoing], badge: pending.length ? 'pending' : onGoing.length ? 'on_going' : null };
    })
    .sort((a, b) => new Date(b.items[0].created_at) - new Date(a.items[0].created_at));
});
const pageCount = computed(() => Math.max(1, Math.ceil(groups.value.length / pageSize.value)));
const pageGroups = computed(() => groups.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value));
watch([statusFilter, pageSize], () => {
  page.value = 1;
});

function isActionable(request) {
  return request.status === 'pending' || request.status === 'on_going';
}

function isBusy(request) {
  return processingId.value === request.id || messagingId.value === request.id || processingGroup.value === groupKeyOf(request);
}

async function load() {
  try {
    const { data, error } = await supabase.from('member_change_requests').select(SELECT).order('created_at', { ascending: false }).limit(300);
    if (error) throw error;
    requests.value = data || [];
  } catch (error) {
    showAlert('Error Loading Change Requests', error.message);
  } finally {
    isLoading.value = false;
  }
}

function patchRequests(ids, values) {
  requests.value = requests.value.map((request) => (ids.includes(request.id) ? { ...request, ...values } : request));
}

async function currentUser() {
  const { data } = await supabase.auth.getUser();
  return data?.user || null;
}

async function applyChanges(request) {
  const { error } = await supabase.from('members').update(request.changes).eq('MemberIDNo', request.member_id);
  if (error) throw error;
}

async function markApproved(ids) {
  const user = await currentUser();
  const review = { status: 'approved', reviewed_by_email: user?.email || null, reviewed_at: new Date().toISOString() };
  const { error } = await supabase.from('member_change_requests').update({ ...review, reviewed_by: user?.id || null }).in('id', ids);
  if (error) throw error;
  patchRequests(ids, review);
}

async function approve(request) {
  processingId.value = request.id;
  try {
    await applyChanges(request);
    await markApproved([request.id]);
  } catch (error) {
    showAlert('Approval Failed', error.message);
  } finally {
    processingId.value = null;
  }
}

// Oldest first, so the most recent value wins when requests touch one field.
async function approveAll(group) {
  processingGroup.value = group.key;
  try {
    const ordered = [...group.actionable].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    for (const request of ordered) await applyChanges(request);
    await markApproved(ordered.map((request) => request.id));
  } catch (error) {
    showAlert('Bulk Approval Failed', error.message);
  } finally {
    processingGroup.value = null;
  }
}

async function messageRequester(request) {
  if (!request.requested_by) {
    showAlert('Cannot Start Conversation', 'This request has no requester account on file (it may have been deleted).');
    return;
  }
  messagingId.value = request.id;
  try {
    const user = await currentUser();
    const { data: conversationId, error: conversationError } = await supabase.rpc('start_direct_conversation', { other_profile_id: request.requested_by });
    if (conversationError) throw conversationError;
    const assignment = { status: 'on_going', assigned_to_email: user?.email || null, conversation_id: conversationId };
    const { error } = await supabase.from('member_change_requests').update({ ...assignment, assigned_to: user?.id || null }).eq('id', request.id);
    if (error) throw error;
    patchRequests([request.id], assignment);
    props.onOpenConversation?.(conversationId);
  } catch (error) {
    showAlert('Error Starting Conversation', error.message);
  } finally {
    messagingId.value = null;
  }
}

function openReject(request) {
  rejectTarget.value = request;
  rejectReason.value = '';
}

async function confirmReject() {
  const target = rejectTarget.value;
  processingId.value = target.id;
  try {
    const user = await currentUser();
    const review = { status: 'rejected', reviewed_by_email: user?.email || null, reviewed_at: new Date().toISOString(), rejection_reason: rejectReason.value.trim() || null };
    const { error } = await supabase.from('member_change_requests').update({ ...review, reviewed_by: user?.id || null }).eq('id', target.id);
    if (error) throw error;
    patchRequests([target.id], review);
    rejectTarget.value = null;
  } catch (error) {
    showAlert('Rejection Failed', error.message);
  } finally {
    processingId.value = null;
  }
}

function handleExport() {
  exportCsv('member-change-requests', [
    { key: 'time', label: 'Submitted', value: (request) => requestDate(request.created_at) },
    { key: 'member', label: 'Member', value: memberName },
    { key: 'member_id', label: 'Member ID' },
    { key: 'status', label: 'Status' },
    { key: 'requested_by_email', label: 'Requested By', value: (request) => request.requested_by_email || '' },
    { key: 'assigned_to_email', label: 'Assigned To', value: (request) => request.assigned_to_email || '' },
    { key: 'reviewed_by_email', label: 'Reviewed By', value: (request) => request.reviewed_by_email || '' },
    { key: 'changes', label: 'Changes', value: (request) => Object.entries(request.changes || {}).map(([key, value]) => `${key}: ${formatChangeValue(request.previous_values?.[key])} -> ${formatChangeValue(value)}`).join('; ') },
    { key: 'rejection_reason', label: 'Rejection Reason', value: (request) => request.rejection_reason || '' },
  ], filtered.value);
}

onMounted(() => {
  load();
  channel = supabase.channel('member_change_queue_feed').on('postgres_changes', { event: '*', schema: 'public', table: 'member_change_requests' }, load).subscribe();
});
onBeforeUnmount(() => supabase.removeChannel(channel));
</script>

<template>
  <div class="page">
    <PageHead :title="`Change Requests (${filtered.length})`" subtitle="Review Directory edits before they reach the member record.">
      <button class="btn" @click="handleExport"><Download :size="14" />Export</button>
    </PageHead>
    <div class="tabs">
      <button v-for="status in FILTERS" :key="status" class="tab" :class="{ active: statusFilter === status }" @click="statusFilter = status">{{ status === 'all' ? 'All' : CHANGE_STATUS[status].label }}</button>
    </div>

    <section class="card">
      <LoadingBlock v-if="isLoading" />
      <p v-else-if="!groups.length" class="empty">{{ statusFilter === 'pending' ? 'No pending change requests — all caught up.' : 'No matching change requests.' }}</p>
      <article v-for="group in pageGroups" :key="group.key" class="group">
        <div class="group-head" role="button" tabindex="0" :aria-expanded="expandedGroup === group.key" @click="expandedGroup = expandedGroup === group.key ? null : group.key" @keydown.enter="expandedGroup = expandedGroup === group.key ? null : group.key">
          <span class="avatar">{{ initialsFromEmail(group.email) }}</span>
          <div class="grow">
            <p class="row row-wrap"><span class="strong clamp">{{ group.email || 'Unknown Requester' }}</span><span v-if="group.badge" class="pill" :class="CHANGE_STATUS[group.badge].tone">{{ CHANGE_STATUS[group.badge].label }}</span></p>
            <p class="muted small">{{ group.memberCount }} member{{ group.memberCount === 1 ? '' : 's' }} · {{ group.items.length }} request{{ group.items.length === 1 ? '' : 's' }}</p>
          </div>
          <button v-if="group.actionable.length > 1" class="btn btn-primary btn-sm" :disabled="processingGroup === group.key || !!processingId" @click.stop="approveAll(group)">
            {{ processingGroup === group.key ? 'Approving…' : `Approve All (${group.actionable.length})` }}
          </button>
          <component :is="expandedGroup === group.key ? ChevronUp : ChevronDown" :size="17" class="muted" />
        </div>

        <template v-if="expandedGroup === group.key">
          <div v-for="request in group.items" :key="request.id" class="item" :class="{ rejected: request.status === 'rejected' }">
            <div class="item-row" role="button" tabindex="0" @click="expandedId = expandedId === request.id ? null : request.id" @keydown.enter="expandedId = expandedId === request.id ? null : request.id">
              <div class="item-member"><p class="strong clamp">{{ memberName(request) || 'Unknown Member' }}</p><p class="muted small">ID: {{ request.member_id }}</p></div>
              <div class="item-changes"><p class="strong">{{ changeCount(request) }} Field{{ changeCount(request) === 1 ? '' : 's' }}</p><p class="muted small clamp">{{ Object.keys(request.changes || {}).join(', ') || 'No fields changed' }}</p></div>
              <span class="pill" :class="CHANGE_STATUS[request.status]?.tone">{{ CHANGE_STATUS[request.status]?.label || request.status }}</span>
              <span class="small muted item-date">{{ requestDate(request.created_at) }}</span>
              <div v-if="isActionable(request)" class="row item-actions" @click.stop>
                <button class="icon-btn act" aria-label="Message requester" :disabled="isBusy(request)" @click="messageRequester(request)"><MessageCircle :size="15" /></button>
                <button class="icon-btn act reject" aria-label="Reject" :disabled="isBusy(request)" @click="openReject(request)"><X :size="16" /></button>
                <button class="icon-btn act approve" aria-label="Approve" :disabled="isBusy(request)" @click="approve(request)"><Check :size="16" /></button>
              </div>
              <span v-else class="small muted item-actions">by {{ request.reviewed_by_email || 'Unknown' }}</span>
              <component :is="expandedId === request.id ? ChevronUp : ChevronDown" :size="15" class="muted" />
            </div>
            <div v-if="expandedId === request.id" class="diff">
              <p v-if="request.status === 'on_going' && request.assigned_to_email" class="small muted">Being handled by: {{ request.assigned_to_email }}</p>
              <p v-if="!changeCount(request)" class="small muted">No field changes in this request.</p>
              <div v-for="(value, key) in request.changes || {}" :key="key" class="change">
                <span class="strong clamp">{{ key }}</span>
                <span class="text-danger">{{ formatChangeValue(request.previous_values?.[key]) }}</span>
                <ArrowRight :size="12" />
                <span class="text-success">{{ formatChangeValue(value) }}</span>
              </div>
              <p v-if="request.status === 'rejected' && request.rejection_reason" class="small text-danger">Reason: {{ request.rejection_reason }}</p>
            </div>
          </div>
        </template>
      </article>

      <footer v-if="groups.length" class="foot">
        <span class="muted small">{{ groups.length }} requester{{ groups.length === 1 ? '' : 's' }}</span>
        <div class="row">
          <label class="row small muted">Rows <select v-model.number="pageSize" class="select sm"><option v-for="size in PAGE_SIZES" :key="size">{{ size }}</option></select></label>
          <button class="icon-btn" :disabled="page === 1" aria-label="Previous page" @click="page -= 1"><ChevronLeft :size="16" /></button>
          <span class="small">{{ page }} / {{ pageCount }}</span>
          <button class="icon-btn" :disabled="page === pageCount" aria-label="Next page" @click="page += 1"><ChevronRight :size="16" /></button>
        </div>
      </footer>
    </section>

    <AppModal v-if="rejectTarget" title="Reject Change Request" :subtitle="`${memberName(rejectTarget)} (ID: ${rejectTarget.member_id})`" :locked="!!processingId" @close="rejectTarget = null">
      <textarea v-model="rejectReason" class="textarea" placeholder="Optional reason (shown to the requester)" aria-label="Rejection reason" />
      <template #footer>
        <button class="btn" :disabled="!!processingId" @click="rejectTarget = null">Cancel</button>
        <button class="btn btn-danger" :disabled="!!processingId" @click="confirmReject">{{ processingId ? 'Rejecting…' : 'Confirm Reject' }}</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.group { border-top: 1px solid var(--line); }
.group:first-child { border-top: 0; }
.group-head { display: flex; align-items: center; gap: 12px; padding: 12px 18px; cursor: pointer; }
.group-head:hover { background: var(--surface-hover); }
.item { border-top: 1px dashed var(--line); background: var(--surface-hover); }
.item.rejected { box-shadow: inset 3px 0 0 var(--danger); }
.item-row { display: flex; align-items: center; gap: 14px; padding: 10px 18px 10px 62px; cursor: pointer; font-size: 13px; flex-wrap: wrap; }
.item-member { width: 180px; min-width: 0; }
.item-changes { flex: 1; min-width: 140px; }
.item-date { width: 150px; }
.item-actions { width: 126px; }
.act { background: var(--surface-soft); }
.act.reject { color: var(--danger); background: var(--danger-soft); }
.act.approve { color: var(--primary-ink); background: var(--primary); }
.diff { padding: 4px 18px 12px 62px; display: grid; gap: 4px; }
.change { display: grid; grid-template-columns: minmax(90px, 200px) 1fr auto 1fr; gap: 8px; align-items: center; font-size: 12px; }
.foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 14px; border-top: 1px solid var(--line); flex-wrap: wrap; }
.select.sm { width: auto; padding: 4px 8px; font-size: 12px; }
@media (max-width: 767.98px) {
  .item-row, .diff { padding-left: 16px; padding-right: 16px; }
  .item-member, .item-date, .item-actions { width: auto; }
}
</style>
