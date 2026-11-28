<script setup>
import { Download, Pencil, Plus, Trash2 } from 'lucide-vue-next';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import AppModal from '@/components/AppModal.vue';
import DataTable from '@/components/DataTable.vue';
import LoadingBlock from '@/components/LoadingBlock.vue';
import MemberForm from '@/components/MemberForm.vue';
import PageHead from '@/components/PageHead.vue';
import SearchInput from '@/components/SearchInput.vue';
import { confirmAction, exportCsv, fetchAllRows, showAlert } from '@/lib/data';
import { isNetworkError, isOnline } from '@/lib/offline';
import { applyWaitingMemberChanges, membersSavedOffline, queueMemberInsert, queueMemberUpdate, saveMembersOffline } from '@/lib/offlineMembers';
import { buildSuggestions, formatBirthday, formFromMember, MEMBER_COLUMNS, memberInitials, memberRoleLabel, payloadFromForm, STATUS_TONE } from '@/lib/members';
import { supabase } from '@/lib/supabase';

const members = ref([]);
const isLoading = ref(true);
const search = ref('');
const form = ref(null);
const mode = ref('create');
const isSaving = ref(false);
const deletingId = ref(null);

const suggestions = computed(() => buildSuggestions(members.value));

const filtered = computed(() => {
  const query = search.value.trim().toLowerCase();
  if (!query) return members.value;
  return members.value.filter((member) => [member.Firstname, member.Lastname, member.MemberIDNo, member.AreaName, member.Email, member.MobileNo, member.Phone, member.SpouseName, memberRoleLabel(member.PastoralService || 'MEMBER')].filter(Boolean).join(' ').toLowerCase().includes(query));
});

const columns = [
  { key: 'name', label: 'Name', value: (member) => `${member.Lastname}, ${member.Firstname}` },
  { key: 'NameOfHouseholdHead', label: 'Household Head' },
  { key: 'contact', label: 'Contact', value: (member) => member.MobileNo || member.Phone || member.Email || '' },
  { key: 'Status', label: 'Status', value: (member) => member.Status || 'Active' },
  { key: 'PastoralService', label: 'Role', value: (member) => member.PastoralService || 'MEMBER' },
  { key: 'AreaName', label: 'Area' },
  { key: 'actions', label: 'Actions', action: true },
];

// True when the list came from this device because there was no internet.
const showingSavedList = ref(false);
// The member as it was when the edit form opened, to spot conflicts later.
const editOriginal = ref(null);

async function fetchMembers() {
  try {
    const rows = await fetchAllRows('members', `${MEMBER_COLUMNS}, SiteStatus`, { orderBy: ['Lastname', 'MemberIDNo'] });
    members.value = applyWaitingMemberChanges(rows);
    showingSavedList.value = false;
    saveMembersOffline('manage', rows);
  } catch (error) {
    const saved = isNetworkError(error) ? await membersSavedOffline('manage') : null;
    if (saved) {
      members.value = applyWaitingMemberChanges(saved);
      showingSavedList.value = true;
    } else showAlert('Error Loading Members', isNetworkError(error) ? 'You are offline, and this list was not saved on this device yet. Open it once with internet to use it offline.' : error.message);
  } finally {
    isLoading.value = false;
  }
}

function openCreate() {
  mode.value = 'create';
  form.value = formFromMember();
}

function openEdit(member) {
  mode.value = 'edit';
  editOriginal.value = member;
  form.value = formFromMember(member);
}

const OFFLINE_SAVED = 'Saved on this device. It syncs to Oracle when the connection returns; if someone else changed the same member meanwhile, you will be asked which to keep.';

// Without internet the add or edit waits on this device (lib/offlineMembers.js).
async function saveOffline(memberId, payload) {
  const name = `${payload.Lastname}, ${payload.Firstname}`;
  if (mode.value === 'create') {
    if (members.value.some((member) => member.MemberIDNo === memberId)) {
      showAlert('Member Already Exists', `A member with ID "${memberId}" is already in the Directory.`);
      return;
    }
    await queueMemberInsert({ memberId, name, row: payload });
    members.value = [...members.value, { MemberIDNo: memberId, ...payload, waitingSync: true }];
  } else {
    const original = editOriginal.value ?? {};
    const changes = {};
    const previous = {};
    for (const [key, value] of Object.entries(payload)) {
      const before = original[key] === '' ? null : original[key] ?? null;
      if (String(before ?? '') !== String(value ?? '')) {
        changes[key] = value;
        previous[key] = before;
      }
    }
    if (Object.keys(changes).length) {
      await queueMemberUpdate({ memberId, name, changes, previous, mode: 'direct' });
      members.value = members.value.map((member) => (member.MemberIDNo === memberId ? { ...member, ...changes, waitingSync: true } : member));
    }
  }
  form.value = null;
  showAlert('Saved Offline', OFFLINE_SAVED);
}

async function save() {
  const memberId = form.value.MemberIDNo.trim();
  if (!memberId) {
    showAlert('Missing Information', 'Member ID, Last Name, and First Name are required.');
    return;
  }
  const { error: invalid, payload } = payloadFromForm(form.value);
  if (invalid) {
    showAlert(...invalid);
    return;
  }
  if (!isOnline()) {
    await saveOffline(memberId, payload);
    return;
  }
  isSaving.value = true;
  try {
    if (mode.value === 'create') {
      const { data: existing, error: lookupError } = await supabase.from('members').select('MemberIDNo').eq('MemberIDNo', memberId).maybeSingle();
      if (lookupError) throw lookupError;
      if (existing) {
        showAlert('Member Already Exists', `A member with ID "${memberId}" is already in the Directory.`);
        return;
      }
      const { error } = await supabase.from('members').insert([{ MemberIDNo: memberId, ...payload }]);
      if (error) throw error;
      showAlert('Member Added', `${payload.Lastname}, ${payload.Firstname} (ID: ${memberId}) was added.`);
    } else {
      const { error } = await supabase.from('members').update(payload).eq('MemberIDNo', memberId);
      if (error) throw error;
      showAlert('Member Updated', `${payload.Lastname}, ${payload.Firstname} was updated.`);
    }
    form.value = null;
    fetchMembers();
  } catch (error) {
    if (isNetworkError(error)) await saveOffline(memberId, payload);
    else showAlert('Save Failed', error.message);
  } finally {
    isSaving.value = false;
  }
}

async function remove(member) {
  if (!isOnline()) {
    showAlert('Needs Internet', 'Deleting a member needs an internet connection.');
    return;
  }
  if (!confirmAction('Delete Member', `Remove ${member.Lastname}, ${member.Firstname} (ID: ${member.MemberIDNo}) permanently? This also removes their PFO training record. This cannot be undone.`)) return;
  deletingId.value = member.MemberIDNo;
  try {
    const { error: pfoError } = await supabase.from('pfo_members').delete().eq('MemberIDNo', member.MemberIDNo);
    if (pfoError) throw pfoError;
    const { error } = await supabase.from('members').delete().eq('MemberIDNo', member.MemberIDNo);
    if (error) throw error;
    members.value = members.value.filter((item) => item.MemberIDNo !== member.MemberIDNo);
  } catch (error) {
    showAlert('Delete Failed', error.message);
  } finally {
    deletingId.value = null;
  }
}

function handleExport() {
  exportCsv('members', [
    { key: 'MemberIDNo', label: 'Member ID' }, { key: 'Lastname', label: 'Last Name' }, { key: 'Firstname', label: 'First Name' },
    { key: 'Status', label: 'Status' }, { key: 'AreaName', label: 'Area' },
    { key: 'NameOfHouseholdHead', label: 'Household Head' }, { key: 'PastoralService', label: 'Pastoral Service' }, { key: 'SpouseName', label: 'Spouse' }, { key: 'Birthday', label: 'Birthday' }, { key: 'WeddingDate', label: 'Church Wedding Date' },
    { key: 'MobileNo', label: 'Mobile' }, { key: 'Phone', label: 'Phone' }, { key: 'Email', label: 'Email' }, { key: 'SiteStatus', label: 'CFC Global Data Status' },
  ], filtered.value);
}

function onOutboxSynced(event) {
  if (event.detail?.kinds?.some((kind) => kind.startsWith('member-'))) fetchMembers();
}
onMounted(() => {
  fetchMembers();
  window.addEventListener('oracle-outbox-synced', onOutboxSynced);
  window.addEventListener('online', fetchMembers);
});
onBeforeUnmount(() => {
  window.removeEventListener('oracle-outbox-synced', onOutboxSynced);
  window.removeEventListener('online', fetchMembers);
});
</script>

<template>
  <LoadingBlock v-if="isLoading" variant="page" :rows="8" />
  <div v-else class="page">
    <PageHead title="Manage Members" subtitle="Every member, unfiltered by Area. Add, edit, or remove records directly.">
      <button class="btn" @click="handleExport"><Download :size="14" />Export</button>
      <button class="btn btn-primary" @click="openCreate"><Plus :size="14" />Add Member</button>
    </PageHead>
    <p v-if="showingSavedList" class="offline-note" role="status"><strong>You're offline.</strong> Showing the list saved on this device. Adds and edits are saved here and sync when the connection returns; deleting needs internet.</p>
    <SearchInput v-model="search" placeholder="Search name, ID, Area, or Pastoral Service..." />
    <section class="card">
      <DataTable :columns="columns" :rows="filtered" row-key="MemberIDNo" :initial-sort="{ key: 'name', ascending: true }" :empty-text="search ? 'No members matched your search.' : 'No members found.'">
        <template #cell-name="{ row }">
          <div class="row who">
            <span class="avatar">{{ memberInitials(row) }}</span>
            <div class="grow"><p class="strong clamp">{{ row.Lastname }}, {{ row.Firstname }}</p><p class="muted small">ID: {{ row.MemberIDNo }}<span v-if="row.waitingSync" class="pill warning waiting">Waiting to sync</span></p></div>
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
        <template #cell-Status="{ row }"><span class="pill" :class="STATUS_TONE[row.Status || 'Active']">{{ row.Status || 'Active' }}</span></template>
        <template #cell-PastoralService="{ value }"><span class="pill">{{ value }}</span></template>
        <template #cell-AreaName="{ value }"><span class="pill accent">{{ value || 'No Area' }}</span></template>
        <template #cell-actions="{ row }">
          <span v-if="deletingId === row.MemberIDNo" class="spinner sm" />
          <div v-else class="row">
            <button class="icon-btn" :aria-label="`Edit ${row.Firstname} ${row.Lastname}`" @click="openEdit(row)"><Pencil :size="16" /></button>
            <button class="icon-btn" :aria-label="`Delete ${row.Firstname} ${row.Lastname}`" @click="remove(row)"><Trash2 :size="16" /></button>
          </div>
        </template>
      </DataTable>
    </section>

    <AppModal v-if="form" :title="mode === 'create' ? 'Add New Member' : 'Edit Member'" :width="680" :locked="isSaving" @close="form = null">
      <MemberForm :form="form" :id-locked="mode === 'edit'" :areas="suggestions.areas" :households="suggestions.households" />
      <template #footer>
        <button class="btn" :disabled="isSaving" @click="form = null">Cancel</button>
        <button class="btn btn-primary" :disabled="isSaving || !form.MemberIDNo.trim() || !form.Lastname.trim() || !form.Firstname.trim()" @click="save">{{ isSaving ? 'Saving…' : mode === 'create' ? 'Add Member' : 'Save Changes' }}</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.offline-note { margin: 0 0 14px; padding: 10px 14px; border-radius: var(--radius-md, 10px); background: color-mix(in srgb, #f59e0b 16%, transparent); font-size: 13px; }
.waiting { margin-left: 6px; font-size: 10px; }
.who { min-width: 180px; }
</style>
