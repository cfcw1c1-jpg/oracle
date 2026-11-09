<script setup>
import { Download, Pencil, Plus, Trash2 } from 'lucide-vue-next';
import { computed, onMounted, ref } from 'vue';
import AppModal from '@/components/AppModal.vue';
import DataTable from '@/components/DataTable.vue';
import LoadingBlock from '@/components/LoadingBlock.vue';
import MemberForm from '@/components/MemberForm.vue';
import PageHead from '@/components/PageHead.vue';
import SearchInput from '@/components/SearchInput.vue';
import { confirmAction, exportCsv, fetchAllRows, showAlert } from '@/lib/data';
import { buildSuggestions, formFromMember, MEMBER_COLUMNS, memberInitials, memberRoleLabel, payloadFromForm, STATUS_TONE } from '@/lib/members';
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
  { key: 'Gender', label: 'Gender' },
  { key: 'Status', label: 'Status', value: (member) => member.Status || 'Active' },
  { key: 'PastoralService', label: 'Role', value: (member) => member.PastoralService || 'MEMBER' },
  { key: 'AreaName', label: 'Area' },
  { key: 'actions', label: 'Actions', action: true },
];

async function fetchMembers() {
  try {
    members.value = await fetchAllRows('members', `${MEMBER_COLUMNS}, SiteStatus`, { orderBy: ['Lastname', 'MemberIDNo'] });
  } catch (error) {
    showAlert('Error Loading Members', error.message);
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
  form.value = formFromMember(member);
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
    showAlert('Save Failed', error.message);
  } finally {
    isSaving.value = false;
  }
}

async function remove(member) {
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
    { key: 'Gender', label: 'Gender' }, { key: 'Status', label: 'Status' }, { key: 'AreaName', label: 'Area' },
    { key: 'NameOfHouseholdHead', label: 'Household Head' }, { key: 'PastoralService', label: 'Pastoral Service' }, { key: 'SpouseName', label: 'Spouse' },
    { key: 'MobileNo', label: 'Mobile' }, { key: 'Phone', label: 'Phone' }, { key: 'Email', label: 'Email' }, { key: 'SiteStatus', label: 'CFC Global Data Status' },
  ], filtered.value);
}

onMounted(fetchMembers);
</script>

<template>
  <LoadingBlock v-if="isLoading" />
  <div v-else class="page">
    <PageHead title="Manage Members" subtitle="Every member, unfiltered by Area. Add, edit, or remove records directly.">
      <button class="btn" @click="handleExport"><Download :size="14" />Export</button>
      <button class="btn btn-primary" @click="openCreate"><Plus :size="14" />Add Member</button>
    </PageHead>
    <SearchInput v-model="search" placeholder="Search name, ID, Area, or Pastoral Service..." />
    <section class="card">
      <DataTable :columns="columns" :rows="filtered" row-key="MemberIDNo" :initial-sort="{ key: 'name', ascending: true }" :empty-text="search ? 'No members matched your search.' : 'No members found.'">
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
          <p v-if="!row.MobileNo && !row.Phone && !row.Email && !row.SpouseName" class="muted small">No contact info</p>
        </template>
        <template #cell-Gender="{ value }">{{ value || 'N/A' }}</template>
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
.who { min-width: 180px; }
</style>
