<script setup>
import { CircleX, Download, Flower2, HandHeart, Pencil, Plus, Shield, UserCheck, UserMinus, Users, X } from 'lucide-vue-next';
import { computed, onMounted, ref } from 'vue';
import AppModal from '@/components/AppModal.vue';
import DataTable from '@/components/DataTable.vue';
import LoadingBlock from '@/components/LoadingBlock.vue';
import MemberForm from '@/components/MemberForm.vue';
import PageHead from '@/components/PageHead.vue';
import SearchInput from '@/components/SearchInput.vue';
import StatCard from '@/components/StatCard.vue';
import { buildAreaOptions, loadAssignedAreaNames, matchesArea } from '@/lib/areas';
import { exportCsv, fetchAllRows, showAlert } from '@/lib/data';
import { parseTrainingName, TRAINING_COLUMNS } from '@/lib/formation';
import { buildSuggestions, formatBirthday, formFromMember, MEMBER_COLUMNS, memberInitials, memberRoleLabel, payloadFromForm, ROLE_OPTION_CODES, STATUS_OPTIONS, STATUS_TONE } from '@/lib/members';
import { supabase } from '@/lib/supabase';

const props = defineProps({ roleName: { type: String, default: null } });

// These roles save edits straight to the record. Chapter Heads and MSGs push
// their saved edits to OGD themselves from OGD Accounts, so they skip the
// approval queue. Other roles' edits go to the Change Requests queue.
const DIRECT_EDIT_ROLES = new Set(['Admin', 'Moderator', 'Chapter Head', 'MSG']);
const OGD_PUSH_ROLES = new Set(['Chapter Head', 'MSG']);
const canApprove = computed(() => DIRECT_EDIT_ROLES.has(props.roleName));
const pushesToOgd = computed(() => OGD_PUSH_ROLES.has(props.roleName));

const members = ref([]);
const isLoading = ref(true);
const search = ref('');
const assignedAreaNames = ref([]);
const filters = ref({ role: 'All', area: 'All', status: 'All' });
const selectedIds = ref(new Set());
const busyId = ref(null);
const editForm = ref(null);
const editOriginal = ref(null);
const isSavingEdit = ref(false);
const assign = ref(null);
const isAssigning = ref(false);

const statusOf = (member) => member.Status || 'Active';
const suggestions = computed(() => buildSuggestions(members.value));
const roleOptions = computed(() => ['All', ...[...new Set(members.value.map((member) => (member.PastoralService || 'MEMBER').trim()))].sort()]);
const areaOptions = computed(() => buildAreaOptions(assignedAreaNames.value, members.value.map((member) => member.AreaName)));

// Members matching the search and every filter except Status, so the status
// cards show the breakdown of what the other filters leave.
const membersBeforeStatus = computed(() => {
  const query = search.value.trim().toLowerCase();
  const { role, area } = filters.value;
  return members.value.filter((member) => {
    const haystack = [member.Firstname, member.Lastname, member.MemberIDNo, member.Email, member.MobileNo, member.Phone, member.SpouseName].filter(Boolean).join(' ').toLowerCase();
    return (!query || haystack.includes(query))
      && (role === 'All' || (member.PastoralService || 'MEMBER').trim() === role)
      && matchesArea(area, member.AreaName);
  });
});

const filteredMembers = computed(() => {
  const { status } = filters.value;
  return status === 'All' ? membersBeforeStatus.value : membersBeforeStatus.value.filter((member) => statusOf(member) === status);
});

const STATUS_CARD_META = {
  All: { label: 'All Members', icon: Users },
  Active: { label: 'Active', icon: UserCheck },
  Inactive: { label: 'Inactive', icon: UserMinus },
  Deceased: { label: 'Deceased', icon: Flower2 },
  SOLD: { label: 'SOLD', icon: Shield },
  HANDMAID: { label: 'Handmaid', icon: HandHeart },
};

const statusCards = computed(() => {
  const counts = new Map();
  for (const member of membersBeforeStatus.value) counts.set(statusOf(member), (counts.get(statusOf(member)) ?? 0) + 1);
  const total = membersBeforeStatus.value.length;
  return ['All', ...STATUS_OPTIONS].map((status) => {
    const count = status === 'All' ? total : (counts.get(status) ?? 0);
    const share = total ? Math.round((count / total) * 100) : 0;
    return { status, ...(STATUS_CARD_META[status] ?? { label: status, icon: Users }), count, hint: status === 'All' ? 'In the current filters' : `${share}% of members` };
  });
});

// Clicking the selected card again goes back to all statuses.
function selectStatus(status) {
  filters.value = { ...filters.value, status: filters.value.status === status ? 'All' : status };
}

const allSelected = computed(() => filteredMembers.value.length > 0 && filteredMembers.value.every((member) => selectedIds.value.has(member.MemberIDNo)));
const hasFilters = computed(() => search.value || Object.values(filters.value).some((value) => value !== 'All'));

const columns = [
  { key: 'select', label: '', action: true, width: '40px' },
  { key: 'name', label: 'Name', value: (member) => `${member.Lastname}, ${member.Firstname}` },
  { key: 'NameOfHouseholdHead', label: 'Household Head' },
  { key: 'contact', label: 'Contact', value: (member) => member.MobileNo || member.Phone || member.Email || '' },
  { key: 'status', label: 'Status', value: statusOf },
  { key: 'role', label: 'Role', value: (member) => memberRoleLabel(member.PastoralService) },
  { key: 'AreaName', label: 'Area' },
  { key: 'edit', label: 'Edit', action: true },
];

// Exports the members on screen (search, filters and status card applied),
// or only the ticked ones when any are selected.
const EXPORT_COLUMNS = [
  { key: 'MemberIDNo', label: 'Member ID' }, { key: 'Lastname', label: 'Last Name' }, { key: 'Firstname', label: 'First Name' },
  { key: 'Status', label: 'Status', value: statusOf }, { key: 'PastoralService', label: 'Role', value: (member) => memberRoleLabel(member.PastoralService) },
  { key: 'AreaName', label: 'Area' }, { key: 'NameOfHouseholdHead', label: 'Household Head' }, { key: 'SpouseName', label: 'Spouse' }, { key: 'Birthday', label: 'Birthday' }, { key: 'WeddingDate', label: 'Church Wedding Date' },
  { key: 'MobileNo', label: 'Mobile' }, { key: 'Phone', label: 'Phone' }, { key: 'Email', label: 'Email' }, { key: 'YearRegistered', label: 'Year Registered' },
];
const exportRows = computed(() => (selectedIds.value.size ? filteredMembers.value.filter((member) => selectedIds.value.has(member.MemberIDNo)) : filteredMembers.value));

function handleExport() {
  if (!exportRows.value.length) return;
  exportCsv(`directory-${new Date().toISOString().slice(0, 10)}`, EXPORT_COLUMNS, exportRows.value);
}

function patchMember(memberId, changes) {
  members.value = members.value.map((member) => (member.MemberIDNo === memberId ? { ...member, ...changes } : member));
}

// Returns true when the change was queued rather than applied.
async function applyOrQueue(memberId, changes, previousValues) {
  if (canApprove.value) {
    const { error } = await supabase.from('members').update(changes).eq('MemberIDNo', memberId);
    if (error) throw error;
    patchMember(memberId, changes);
    return false;
  }
  const { data } = await supabase.auth.getUser();
  const { error } = await supabase.from('member_change_requests').insert([{ member_id: memberId, requested_by: data?.user?.id || null, requested_by_email: data?.user?.email || null, changes, previous_values: previousValues }]);
  if (error) throw error;
  return true;
}

async function changeField(member, field, value, label, event) {
  busyId.value = member.MemberIDNo;
  try {
    const queued = await applyOrQueue(member.MemberIDNo, { [field]: value }, { [field]: member[field] });
    if (!queued && pushesToOgd.value) showAlert('Saved', `The ${label} change is saved. Push it to OGD from OGD Accounts.`);
    if (queued) {
      event.target.value = field === 'Status' ? statusOf(member) : (member[field] || '').trim().toUpperCase();
      showAlert('Submitted for Approval', `This ${label} change has been sent to an Admin/Moderator for review.`);
    }
  } catch (error) {
    event.target.value = field === 'Status' ? statusOf(member) : (member[field] || '').trim().toUpperCase();
    showAlert('Database Exception', `Failed updating ${label.toLowerCase()}: ${error.message}`);
  } finally {
    busyId.value = null;
  }
}

function openEdit(member) {
  editOriginal.value = member;
  editForm.value = formFromMember(member);
}

async function saveEdit() {
  const { error: invalid, payload } = payloadFromForm(editForm.value);
  if (invalid) {
    showAlert(...invalid);
    return;
  }
  const changes = {};
  const previous = {};
  Object.keys(payload).forEach((key) => {
    const before = editOriginal.value[key] ?? null;
    if ((before === '' ? null : before) !== payload[key]) {
      changes[key] = payload[key];
      previous[key] = before;
    }
  });
  if (!Object.keys(changes).length) {
    editForm.value = null;
    return;
  }
  isSavingEdit.value = true;
  try {
    const memberId = editForm.value.MemberIDNo;
    const count = Object.keys(changes).length;
    const queued = await applyOrQueue(memberId, changes, previous);
    editForm.value = null;
    if (queued) showAlert('Submitted for Approval', `${count} field(s) sent to an Admin/Moderator for review.`);
    else if (pushesToOgd.value) showAlert('Saved', `${count} field(s) saved. Push them to OGD from OGD Accounts.`);
  } catch (error) {
    showAlert('Save Failed', error.message);
  } finally {
    isSavingEdit.value = false;
  }
}

function toggleSelected(memberId) {
  const next = new Set(selectedIds.value);
  if (next.has(memberId)) next.delete(memberId);
  else next.add(memberId);
  selectedIds.value = next;
}

function toggleAll() {
  selectedIds.value = allSelected.value ? new Set() : new Set(filteredMembers.value.map((member) => member.MemberIDNo));
}

function openAssign() {
  assign.value = { memberIds: new Set(selectedIds.value), talkIds: new Set(), memberQuery: '', talkQuery: '' };
}

function toggleStaged(set, value) {
  if (set.has(value)) set.delete(value);
  else set.add(value);
}

const memberChecklist = computed(() => {
  const query = assign.value?.memberQuery.trim().toLowerCase();
  const rows = query ? members.value.filter((member) => [member.Firstname, member.Lastname, member.MemberIDNo].some((value) => String(value ?? '').toLowerCase().includes(query))) : members.value;
  return rows.slice(0, 200);
});
const talkChecklist = computed(() => {
  const query = assign.value?.talkQuery.trim().toLowerCase();
  return query ? TRAINING_COLUMNS.filter((talk) => talk.label.toLowerCase().includes(query) || talk.group.toLowerCase().includes(query)) : TRAINING_COLUMNS;
});
const stagedTalks = computed(() => TRAINING_COLUMNS.filter((talk) => assign.value?.talkIds.has(talk.id)));

// A talk already marked Y is left untouched for that member.
async function runAssign() {
  const talkIds = [...assign.value.talkIds];
  const memberIds = [...assign.value.memberIds];
  if (!talkIds.length || !memberIds.length) return;
  isAssigning.value = true;
  try {
    const quoted = talkIds.map((id) => `"${id}"`).join(', ');
    const { data, error: lookupError } = await supabase.from('pfo_members').select(`MemberIDNo, ${quoted}`).in('MemberIDNo', memberIds);
    if (lookupError) throw lookupError;
    const existing = new Map((data || []).map((row) => [row.MemberIDNo, row]));

    const inserts = [];
    const updates = [];
    let newlySet = 0;
    let alreadyMarked = 0;
    memberIds.forEach((memberId) => {
      const row = existing.get(memberId);
      if (!row) {
        inserts.push({ MemberIDNo: memberId, ...Object.fromEntries(talkIds.map((id) => [id, 'Y'])) });
        newlySet += talkIds.length;
        return;
      }
      const missing = talkIds.filter((id) => row[id] !== 'Y' && row[id] !== 'y');
      alreadyMarked += talkIds.length - missing.length;
      newlySet += missing.length;
      if (missing.length) updates.push({ memberId, payload: Object.fromEntries(missing.map((id) => [id, 'Y'])) });
    });

    if (inserts.length) {
      const { error } = await supabase.from('pfo_members').insert(inserts);
      if (error) throw error;
    }
    const results = await Promise.all(updates.map(({ memberId, payload }) => supabase.from('pfo_members').update(payload).eq('MemberIDNo', memberId)));
    const failed = results.find((result) => result.error);
    if (failed) throw failed.error;

    const note = alreadyMarked ? ` ${alreadyMarked} talk record(s) were already marked and left unchanged.` : '';
    showAlert('Success', newlySet ? `Marked ${newlySet} talk record(s) as attended.${note}` : 'Nothing to update — all selected members already have these talks marked.');
    assign.value = null;
    selectedIds.value = new Set();
  } catch (error) {
    showAlert('Assignment Failed', error.message);
  } finally {
    isAssigning.value = false;
  }
}

onMounted(async () => {
  try {
    members.value = await fetchAllRows('members', MEMBER_COLUMNS, { orderBy: ['Lastname', 'MemberIDNo'] });
  } catch (error) {
    showAlert('Error Loading Members', error.message);
  } finally {
    isLoading.value = false;
  }
  try {
    assignedAreaNames.value = await loadAssignedAreaNames();
  } catch (error) {
    console.error('Error loading assigned areas:', error.message);
  }
});
</script>

<template>
  <LoadingBlock v-if="isLoading" variant="page" :rows="8" />
  <div v-else class="page">
    <PageHead title="CFC Members Directory" subtitle="Manage and browse active community profiles, assigned chapters, and household groups.">
      <span v-if="selectedIds.size" class="pill row">{{ selectedIds.size }} selected
        <button class="x" aria-label="Clear selection" @click="selectedIds = new Set()"><CircleX :size="14" /></button>
      </span>
      <button class="btn" :disabled="!exportRows.length" @click="handleExport"><Download :size="14" />Export{{ selectedIds.size ? ` (${exportRows.length})` : '' }}</button>
      <button class="btn btn-primary" @click="openAssign"><Plus :size="14" />Assign to Talks</button>
    </PageHead>

    <section class="grid status-cards" aria-label="Members by status">
      <StatCard
        v-for="card in statusCards"
        :key="card.status"
        :label="card.label"
        :value="card.count.toLocaleString()"
        :hint="card.hint"
        :icon="card.icon"
        :active="filters.status === card.status"
        :aria-pressed="filters.status === card.status"
        @select="selectStatus(card.status)"
      />
    </section>

    <div class="row row-wrap">
      <SearchInput v-model="search" placeholder="Search name or ID..." class="grow" />
      <select v-model="filters.role" class="select filter" aria-label="Role"><option v-for="role in roleOptions" :key="role" :value="role">{{ role === 'All' ? 'Role: All' : memberRoleLabel(role) }}</option></select>
      <select v-model="filters.area" class="select filter" aria-label="Area"><option v-for="area in areaOptions" :key="area" :value="area">{{ area === 'All' ? 'Area: All' : area }}</option></select>
      <select v-model="filters.status" class="select filter" aria-label="Status"><option value="All">Status: All</option><option v-for="status in STATUS_OPTIONS" :key="status">{{ status }}</option></select>
      <label class="check"><input type="checkbox" :checked="allSelected" @change="toggleAll" />Select all</label>
    </div>

    <section class="card">
      <DataTable :columns="columns" :rows="filteredMembers" row-key="MemberIDNo" :initial-sort="{ key: 'name', ascending: true }" :empty-text="hasFilters ? 'No members matched your search and filters.' : 'No members found.'">
        <template #cell-select="{ row }"><input class="tick" type="checkbox" :aria-label="`Select ${row.Firstname} ${row.Lastname}`" :checked="selectedIds.has(row.MemberIDNo)" @change="toggleSelected(row.MemberIDNo)" /></template>
        <template #cell-name="{ row }">
          <div class="row who">
            <span class="avatar">{{ memberInitials(row) }}</span>
            <div class="grow"><p class="strong clamp">{{ row.Lastname }}, {{ row.Firstname }}</p><p class="muted small">ID: {{ row.MemberIDNo }}</p></div>
          </div>
        </template>
        <template #cell-NameOfHouseholdHead="{ value }">{{ value || 'N/A' }}</template>
        <template #cell-contact="{ row }">
          <p v-if="row.MobileNo || row.Phone">{{ row.MobileNo || row.Phone }}</p>
          <p v-if="row.Email" class="muted small">{{ row.Email }}</p>
          <p v-if="row.SpouseName" class="muted small">Spouse: {{ row.SpouseName }}</p>
          <p v-if="row.Birthday" class="muted small">Birthday: {{ formatBirthday(row.Birthday) }}</p>
          <p v-if="row.WeddingDate" class="muted small">Wedding: {{ formatBirthday(row.WeddingDate) }}</p>
          <p v-if="!row.MobileNo && !row.Phone && !row.Email && !row.SpouseName && !row.Birthday && !row.WeddingDate" class="muted small">No contact info</p>
        </template>
        <template #cell-status="{ row }">
          <select class="pill pill-select" :class="STATUS_TONE[statusOf(row)]" :value="statusOf(row)" :disabled="busyId === row.MemberIDNo" aria-label="Status" @change="changeField(row, 'Status', $event.target.value, 'Status', $event)">
            <option v-for="status in STATUS_OPTIONS" :key="status">{{ status }}</option>
          </select>
        </template>
        <template #cell-role="{ row }">
          <select class="pill pill-select" :value="(row.PastoralService || '').trim().toUpperCase()" :disabled="busyId === row.MemberIDNo" aria-label="Role" @change="changeField(row, 'PastoralService', $event.target.value, 'Role', $event)">
            <option v-if="!ROLE_OPTION_CODES.includes((row.PastoralService || '').trim().toUpperCase())" :value="(row.PastoralService || '').trim().toUpperCase()">{{ memberRoleLabel(row.PastoralService) }}</option>
            <option v-for="code in ROLE_OPTION_CODES" :key="code" :value="code">{{ memberRoleLabel(code) }}</option>
          </select>
        </template>
        <template #cell-AreaName="{ value }"><span class="pill accent">{{ value || 'No Area' }}</span></template>
        <template #cell-edit="{ row }"><button class="icon-btn" :aria-label="`Edit ${row.Firstname} ${row.Lastname}`" @click="openEdit(row)"><Pencil :size="16" /></button></template>
      </DataTable>
    </section>

    <AppModal v-if="editForm" title="Edit Member" :width="680" :locked="isSavingEdit" @close="editForm = null">
      <MemberForm :form="editForm" id-locked :areas="suggestions.areas" :households="suggestions.households" />
      <template #footer>
        <button class="btn" :disabled="isSavingEdit" @click="editForm = null">Cancel</button>
        <button class="btn btn-primary" :disabled="isSavingEdit || !editForm.Lastname.trim() || !editForm.Firstname.trim()" @click="saveEdit">{{ isSavingEdit ? 'Saving…' : 'Save Changes' }}</button>
      </template>
    </AppModal>

    <AppModal v-if="assign" title="Assign Talks to Members" :width="620" :locked="isAssigning" @close="assign = null">
      <div class="stack">
        <h3 class="field-label">Members ({{ assign.memberIds.size }})</h3>
        <SearchInput v-model="assign.memberQuery" placeholder="Search members..." />
        <div class="checklist">
          <label v-for="member in memberChecklist" :key="member.MemberIDNo" class="check item">
            <input type="checkbox" :checked="assign.memberIds.has(member.MemberIDNo)" @change="toggleStaged(assign.memberIds, member.MemberIDNo); assign = { ...assign }" />
            <span>{{ member.Lastname }}, {{ member.Firstname }} <span class="muted small">ID: {{ member.MemberIDNo }}</span></span>
          </label>
          <p v-if="!memberChecklist.length" class="muted small">No matching members.</p>
        </div>

        <h3 class="field-label">Talks ({{ assign.talkIds.size }})</h3>
        <div v-if="stagedTalks.length" class="row row-wrap">
          <span v-for="talk in stagedTalks" :key="talk.id" class="pill accent row">{{ talk.label }}
            <button class="x" :aria-label="`Remove ${talk.label}`" @click="toggleStaged(assign.talkIds, talk.id); assign = { ...assign }"><X :size="12" /></button>
          </span>
        </div>
        <SearchInput v-model="assign.talkQuery" placeholder="Search talks by name or group..." />
        <div class="checklist">
          <label v-for="talk in talkChecklist" :key="talk.id" class="check item">
            <input type="checkbox" :checked="assign.talkIds.has(talk.id)" @change="toggleStaged(assign.talkIds, talk.id); assign = { ...assign }" />
            <span><span class="strong">{{ talk.label }}</span> {{ parseTrainingName(talk.id) }} <span class="muted small block">{{ talk.group }}</span></span>
          </label>
          <p v-if="!talkChecklist.length" class="muted small">No matching talks.</p>
        </div>
      </div>
      <template #footer>
        <button class="btn" :disabled="isAssigning" @click="assign = null">Cancel</button>
        <button class="btn btn-primary" :disabled="!assign.memberIds.size || !assign.talkIds.size || isAssigning" @click="runAssign">{{ isAssigning ? 'Assigning…' : 'Assign' }}</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.status-cards { grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; }
.status-cards :deep(.stat) { padding: 14px 16px; cursor: pointer; }
.status-cards :deep(.stat-value) { font-size: 22px; margin-top: 6px; }
@media (max-width: 1100px) { .status-cards { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 560px) { .status-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; } }
.filter { width: auto; max-width: 180px; }
.who { min-width: 180px; }
.tick { width: 16px; height: 16px; accent-color: var(--primary); }
.pill-select { border: 0; appearance: auto; cursor: pointer; max-width: 170px; }
.x { border: 0; background: none; padding: 0; display: inline-flex; color: inherit; }
.checklist { max-height: 200px; overflow-y: auto; border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 4px 8px; }
.item { display: flex; align-items: flex-start; padding: 6px 2px; }
.block { display: block; }
</style>
