<script setup>
import { Download, KeyRound, Plus, Trash2 } from 'lucide-vue-next';
import { computed, onMounted, ref, watch } from 'vue';
import AppModal from '@/components/AppModal.vue';
import LoadingBlock from '@/components/LoadingBlock.vue';
import { confirmAction, exportCsv, showAlert } from '@/lib/data';
import { supabase } from '@/lib/supabase';

const props = defineProps({ onAccessChanged: { type: Function, default: null } });

const isLoading = ref(true);
const roles = ref([]);
const pages = ref([]);
const selectedRoleId = ref(null);
const grantedKeys = ref(new Set());
const isLoadingGrants = ref(false);
const isAddOpen = ref(false);
const newName = ref('');
const newDescription = ref('');
const isSaving = ref(false);

const selectedRole = computed(() => roles.value.find((role) => role.id === selectedRoleId.value) || null);

async function loadAll() {
  isLoading.value = true;
  try {
    const [rolesResult, pagesResult] = await Promise.all([
      supabase.from('roles').select('id, name, description').order('name'),
      supabase.from('pages').select('key, label, sort_order').order('sort_order'),
    ]);
    if (rolesResult.error) throw rolesResult.error;
    if (pagesResult.error) throw pagesResult.error;
    roles.value = rolesResult.data || [];
    pages.value = pagesResult.data || [];
    selectedRoleId.value = selectedRoleId.value ?? roles.value[0]?.id ?? null;
  } catch (error) {
    showAlert('Error Loading Roles', error.message);
  } finally {
    isLoading.value = false;
  }
}

async function loadGrants(roleId) {
  if (roleId == null) {
    grantedKeys.value = new Set();
    return;
  }
  isLoadingGrants.value = true;
  try {
    const { data, error } = await supabase.from('role_pages').select('page_key').eq('role_id', roleId);
    if (error) throw error;
    grantedKeys.value = new Set((data || []).map((row) => row.page_key));
  } catch (error) {
    showAlert('Error Loading Page Access', error.message);
  } finally {
    isLoadingGrants.value = false;
  }
}
watch(selectedRoleId, loadGrants);

async function togglePage(pageKey) {
  const role = selectedRole.value;
  if (!role) return;
  const isGranted = grantedKeys.value.has(pageKey);
  try {
    const { error } = isGranted
      ? await supabase.from('role_pages').delete().eq('role_id', role.id).eq('page_key', pageKey)
      : await supabase.from('role_pages').insert([{ role_id: role.id, page_key: pageKey }]);
    if (error) throw error;
    const next = new Set(grantedKeys.value);
    if (isGranted) next.delete(pageKey);
    else next.add(pageKey);
    grantedKeys.value = next;
    props.onAccessChanged?.();
  } catch (error) {
    showAlert('Error Updating Page Access', error.message);
  }
}

async function addRole() {
  if (!newName.value.trim()) {
    showAlert('Validation Error', 'Please enter a role name.');
    return;
  }
  isSaving.value = true;
  try {
    const { data, error } = await supabase.from('roles').insert([{ name: newName.value.trim(), description: newDescription.value.trim() || null }]).select('id');
    if (error) throw error;
    isAddOpen.value = false;
    newName.value = '';
    newDescription.value = '';
    await loadAll();
    if (data?.[0]) selectedRoleId.value = data[0].id;
  } catch (error) {
    showAlert('Error Creating Role', error.message);
  } finally {
    isSaving.value = false;
  }
}

async function deleteRole(role) {
  if (role.name === 'Admin') {
    showAlert('Not Allowed', 'The Admin role cannot be deleted.');
    return;
  }
  if (!confirmAction('Delete Role', `Delete "${role.name}"? Portal users with this role will become Unassigned.`)) return;
  try {
    const { error } = await supabase.from('roles').delete().eq('id', role.id);
    if (error) throw error;
    if (selectedRoleId.value === role.id) selectedRoleId.value = null;
    await loadAll();
    props.onAccessChanged?.();
  } catch (error) {
    showAlert('Error Deleting Role', error.message);
  }
}

function exportRoles() {
  exportCsv('roles', [{ key: 'name', label: 'Role' }, { key: 'description', label: 'Description', value: (role) => role.description || '' }], roles.value);
}

function exportAccess() {
  exportCsv(`page-access-${selectedRole.value.name}`, [{ key: 'label', label: 'Page' }, { key: 'status', label: 'Status', value: (page) => (grantedKeys.value.has(page.key) ? 'Granted' : 'Not Granted') }], pages.value);
}

onMounted(loadAll);
</script>

<template>
  <div class="grid grid-2">
    <section class="card">
      <header class="card-head">
        <h2 class="card-title">{{ roles.length }} Role{{ roles.length === 1 ? '' : 's' }}</h2>
        <div class="row">
          <button class="btn btn-sm" @click="exportRoles"><Download :size="13" />Export</button>
          <button class="btn btn-sm" @click="isAddOpen = true"><Plus :size="13" />Add Role</button>
        </div>
      </header>
      <LoadingBlock v-if="isLoading" />
      <p v-else-if="!roles.length" class="empty">No roles yet.</p>
      <div v-else class="list">
        <div v-for="role in roles" :key="role.id" class="list-row" :class="{ selected: role.id === selectedRoleId }">
          <button class="list-main" @click="selectedRoleId = role.id">
            <span class="icon-chip"><KeyRound :size="15" /></span>
            <span class="grow">
              <span class="strong block">{{ role.name }}</span>
              <span v-if="role.description" class="muted small block">{{ role.description }}</span>
            </span>
          </button>
          <button v-if="role.name !== 'Admin'" class="icon-btn" :aria-label="`Delete ${role.name}`" @click="deleteRole(role)"><Trash2 :size="15" /></button>
        </div>
      </div>
    </section>

    <section class="card">
      <header class="card-head">
        <h2 class="card-title">{{ selectedRole ? `Page Access — ${selectedRole.name}` : 'Page Access' }}</h2>
        <button v-if="selectedRole" class="btn btn-sm" @click="exportAccess"><Download :size="13" />Export</button>
      </header>
      <LoadingBlock v-if="isLoadingGrants" />
      <p v-else-if="!selectedRole" class="empty">Select or add a role to configure its page access.</p>
      <div v-else class="list">
        <label v-for="page in pages" :key="page.key" class="list-row grant">
          <input type="checkbox" :checked="grantedKeys.has(page.key)" @change="togglePage(page.key)" />
          <span class="grow strong">{{ page.label }}</span>
          <span class="pill" :class="{ success: grantedKeys.has(page.key) }">{{ grantedKeys.has(page.key) ? 'Granted' : 'Not Granted' }}</span>
        </label>
      </div>
    </section>

    <AppModal v-if="isAddOpen" title="Add Role" @close="isAddOpen = false">
      <div class="stack">
        <input v-model="newName" class="input" placeholder="Role name (e.g. Area Head)" aria-label="Role name" />
        <input v-model="newDescription" class="input" placeholder="Description (optional)" aria-label="Description" />
      </div>
      <template #footer>
        <button class="btn" @click="isAddOpen = false">Cancel</button>
        <button class="btn btn-primary" :disabled="isSaving" @click="addRole">{{ isSaving ? 'Creating…' : 'Create' }}</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.list { max-height: 60vh; overflow-y: auto; }
.list-row { display: flex; align-items: center; gap: 10px; padding: 10px 20px; border-top: 1px solid var(--line); font-size: 13px; }
.list-row.selected { background: var(--accent-soft); }
.list-main { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; border: 0; background: none; padding: 0; text-align: left; }
.grant { cursor: pointer; }
.grant:hover { background: var(--surface-hover); }
.grant input { width: 17px; height: 17px; accent-color: var(--primary); }
.block { display: block; }
</style>
