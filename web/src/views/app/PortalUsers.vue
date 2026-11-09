<script setup>
import { CircleX, Download, KeyRound, RefreshCw, UserPlus } from 'lucide-vue-next';
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import AppModal from '@/components/AppModal.vue';
import DataTable from '@/components/DataTable.vue';
import LoadingBlock from '@/components/LoadingBlock.vue';
import PageHead from '@/components/PageHead.vue';
import PasswordField from '@/components/PasswordField.vue';
import { exportCsv, showAlert } from '@/lib/data';
import { formatPlatform, subscribeToPresence } from '@/lib/presence';
import { supabase } from '@/lib/supabase';

const props = defineProps({ onAccessChanged: { type: Function, default: null } });

const isLoading = ref(true);
const profiles = ref([]);
const roles = ref([]);
const areas = ref([]);
const areasByProfile = ref({});
const onlineByProfile = ref({});
const lastSignIn = ref({});
const roleTarget = ref(null);
const areaTarget = ref(null);
const isSaving = ref(false);
const isAddOpen = ref(false);
const isCreating = ref(false);
const newUser = reactive({ email: '', fullName: '', password: '', roleId: null });
let stopPresence;

function randomIndex(limit) {
  return crypto.getRandomValues(new Uint32Array(1))[0] % limit;
}

// At least one of each character class, shuffled so their positions vary.
function generatePassword() {
  const pools = ['abcdefghijkmnopqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '!@#$%&*'];
  const pick = (pool) => pool[randomIndex(pool.length)];
  const chars = pools.map(pick);
  while (chars.length < 14) chars.push(pick(pools.join('')));
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swap = randomIndex(index + 1);
    [chars[index], chars[swap]] = [chars[swap], chars[index]];
  }
  return chars.join('');
}

function formatLastLogin(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const areaTree = computed(() => {
  const byParent = new Map();
  areas.value.forEach((area) => {
    const key = area.parent_id || 'root';
    byParent.set(key, [...(byParent.get(key) || []), area]);
  });
  function walk(parent, depth) {
    return [...(byParent.get(parent) || [])].sort((a, b) => a.name.localeCompare(b.name)).flatMap((area) => [{ ...area, depth }, ...walk(area.id, depth + 1)]);
  }
  return walk('root', 0);
});

// Granting a Sector cascades to everything beneath it, so only the rows whose
// parent isn't also assigned are shown as what was actually granted.
function areaLabel(profile) {
  const assigned = areasByProfile.value[profile.id] || [];
  const ids = new Set(assigned.map((area) => area.areaId));
  const top = assigned.filter((item) => {
    const parent = areas.value.find((area) => area.id === item.areaId)?.parent_id;
    return !parent || !ids.has(parent);
  });
  if (!top.length) return 'All Areas';
  return top.length === 1 ? top[0].name : 'Multiple Areas Assigned';
}

function statusOf(profile) {
  if (onlineByProfile.value[profile.id]) return { label: 'ONLINE', tone: 'success' };
  return profile.roles ? { label: 'OFFLINE', tone: '' } : { label: 'UNASSIGNED', tone: 'warning' };
}

function lastLoginOf(profile) {
  return onlineByProfile.value[profile.id] ? 'Online now' : formatLastLogin(lastSignIn.value[profile.id]);
}

const columns = [
  { key: 'name', label: 'Account', value: (profile) => profile.full_name || profile.email || profile.id },
  { key: 'role', label: 'Role', value: (profile) => profile.roles?.name || 'Unassigned' },
  { key: 'status', label: 'Status', value: (profile) => statusOf(profile).label },
  { key: 'areas', label: 'Areas', value: areaLabel },
  { key: 'lastLogin', label: 'Last Login', value: (profile) => lastSignIn.value[profile.id] || '' },
  { key: 'actions', label: 'Actions', action: true },
];
const onlineCount = computed(() => Object.keys(onlineByProfile.value).length);
const targetAssignedIds = computed(() => new Set((areasByProfile.value[areaTarget.value?.id] || []).map((area) => area.areaId)));

async function loadAll() {
  try {
    const [profileResult, roleResult, areaResult, userAreaResult, signInResult] = await Promise.all([
      supabase.from('profiles').select('id, email, full_name, avatar_url, role_id, roles ( name )').order('email'),
      supabase.from('roles').select('id, name, description').order('name'),
      supabase.from('areas').select('id, name, type, parent_id').order('name'),
      supabase.from('user_areas').select('profile_id, area_id, areas ( name, type )'),
      supabase.rpc('get_portal_users_last_sign_in'),
    ]);
    [profileResult, roleResult, areaResult, userAreaResult].forEach((result) => {
      if (result.error) throw result.error;
    });
    if (signInResult.error) console.warn('Error loading last sign-in times:', signInResult.error.message);

    const grouped = {};
    (userAreaResult.data || []).forEach((row) => {
      (grouped[row.profile_id] ||= []).push({ areaId: row.area_id, name: row.areas?.name, type: row.areas?.type });
    });
    profiles.value = profileResult.data || [];
    roles.value = roleResult.data || [];
    areas.value = areaResult.data || [];
    areasByProfile.value = grouped;
    lastSignIn.value = Object.fromEntries((signInResult.data || []).map((row) => [row.profile_id, row.last_sign_in_at]));
  } catch (error) {
    showAlert('Error Loading Portal Users', error.message);
  } finally {
    isLoading.value = false;
  }
}

async function assignRole(roleId) {
  isSaving.value = true;
  try {
    const { error } = await supabase.from('profiles').update({ role_id: roleId }).eq('id', roleTarget.value.id);
    if (error) throw error;
    roleTarget.value = null;
    await loadAll();
    props.onAccessChanged?.();
  } catch (error) {
    showAlert('Error Assigning Role', error.message);
  } finally {
    isSaving.value = false;
  }
}

function descendantIds(areaId) {
  return areas.value.filter((area) => area.parent_id === areaId).flatMap((child) => [child.id, ...descendantIds(child.id)]);
}

async function toggleArea(areaId) {
  const profileId = areaTarget.value.id;
  const assigned = targetAssignedIds.value;
  const ids = [areaId, ...descendantIds(areaId)];
  try {
    const { error } = assigned.has(areaId)
      ? await supabase.from('user_areas').delete().eq('profile_id', profileId).in('area_id', ids)
      : await supabase.from('user_areas').insert(ids.filter((id) => !assigned.has(id)).map((area_id) => ({ profile_id: profileId, area_id })));
    if (error) throw error;
    await loadAll();
  } catch (error) {
    showAlert('Error Updating Area Access', error.message);
  }
}

function openAdd() {
  Object.assign(newUser, { email: '', fullName: '', password: generatePassword(), roleId: null });
  isAddOpen.value = true;
}

async function createUser() {
  const email = newUser.email.trim();
  if (!email) {
    showAlert('Missing Email', 'Enter an email address for the new account.');
    return;
  }
  if (newUser.password.length < 6) {
    showAlert('Weak Password', 'Password must be at least 6 characters.');
    return;
  }
  isCreating.value = true;
  try {
    const { data, error } = await supabase.functions.invoke('create-portal-user', { body: { email, password: newUser.password, full_name: newUser.fullName.trim() } });
    if (error) {
      const body = await error.context?.json?.().catch(() => null);
      throw new Error(body?.error || error.message);
    }
    if (data?.error) throw new Error(data.error);
    if (newUser.roleId) {
      const { error: roleError } = await supabase.from('profiles').update({ role_id: newUser.roleId }).eq('id', data.id);
      if (roleError) throw roleError;
    }
    isAddOpen.value = false;
    await loadAll();
    props.onAccessChanged?.();
    showAlert('Account Created', `${email} can now sign in with the password you set. Share it with them directly — it won't be shown again here. Assign Areas from the table if needed.`);
  } catch (error) {
    showAlert('Error Creating Account', error.message);
  } finally {
    isCreating.value = false;
  }
}

function handleExport() {
  exportCsv('portal-users', [
    { key: 'name', label: 'Name', value: (profile) => profile.full_name || '' },
    { key: 'email', label: 'Email', value: (profile) => profile.email || '' },
    { key: 'role', label: 'Role', value: (profile) => profile.roles?.name || 'Unassigned' },
    { key: 'areas', label: 'Areas', value: (profile) => (areasByProfile.value[profile.id] || []).map((area) => area.name).join('; ') || 'All Areas' },
    { key: 'lastLogin', label: 'Last Login', value: lastLoginOf },
  ], profiles.value);
}

onMounted(() => {
  loadAll();
  stopPresence = subscribeToPresence((entries) => {
    onlineByProfile.value = Object.fromEntries(entries.map((entry) => [entry.profile_id, entry]));
  });
});
onBeforeUnmount(() => stopPresence?.());
</script>

<template>
  <div class="page">
    <PageHead title="Portal Users" subtitle="Every account that has signed in, its role, and the areas it can view.">
      <span v-if="onlineCount" class="pill success">{{ onlineCount }} online now</span>
      <button class="btn" @click="handleExport"><Download :size="14" />Export</button>
      <button class="btn btn-primary" @click="openAdd"><UserPlus :size="14" />Add User</button>
    </PageHead>

    <section class="card">
      <LoadingBlock v-if="isLoading" />
      <DataTable v-else :columns="columns" :rows="profiles" empty-text="No portal accounts yet.">
        <template #cell-name="{ row }">
          <div class="row user">
            <img v-if="row.avatar_url" :src="row.avatar_url" class="avatar" alt="" />
            <span v-else class="avatar">{{ (row.full_name || row.email || '?').slice(0, 2).toUpperCase() }}</span>
            <div class="grow">
              <p class="strong clamp">{{ row.full_name || row.email || row.id }}</p>
              <p class="muted small clamp">{{ row.email }}</p>
            </div>
          </div>
        </template>
        <template #cell-status="{ row }">
          <span class="pill" :class="statusOf(row).tone">{{ statusOf(row).label }}</span>
          <p v-if="onlineByProfile[row.id]" class="small text-success">{{ formatPlatform(onlineByProfile[row.id].platform) }}</p>
        </template>
        <template #cell-lastLogin="{ row }"><span class="nowrap" :class="{ 'text-success': onlineByProfile[row.id] }">{{ lastLoginOf(row) }}</span></template>
        <template #cell-actions="{ row }">
          <div class="row">
            <button class="btn btn-sm" @click="roleTarget = row">Role</button>
            <button class="btn btn-sm" @click="areaTarget = row">Areas</button>
          </div>
        </template>
      </DataTable>
    </section>

    <AppModal v-if="roleTarget" title="Assign Role" :subtitle="roleTarget.full_name || roleTarget.email" @close="roleTarget = null">
      <div class="stack">
        <button class="option" :disabled="isSaving" @click="assignRole(null)"><CircleX :size="16" />Unassigned (no page access)</button>
        <button v-for="role in roles" :key="role.id" class="option" :disabled="isSaving" @click="assignRole(role.id)">
          <KeyRound :size="16" />
          <span><span class="strong">{{ role.name }}</span><span v-if="role.description" class="muted small block">{{ role.description }}</span></span>
        </button>
      </div>
    </AppModal>

    <AppModal v-if="areaTarget" title="Assign Areas" :subtitle="areaTarget.full_name || areaTarget.email" @close="areaTarget = null">
      <p class="muted small hint">Checked areas (and everything nested under them) are the only members this account will see in the Directory. Leave none checked for unrestricted access.</p>
      <p v-if="!areaTree.length" class="muted small">No areas created yet.</p>
      <label v-for="area in areaTree" :key="area.id" class="check area-row" :style="{ marginLeft: `${area.depth * 16}px` }">
        <input type="checkbox" :checked="targetAssignedIds.has(area.id)" @change="toggleArea(area.id)" />
        <span>{{ area.name }} <span class="muted small">({{ area.type }})</span></span>
      </label>
    </AppModal>

    <AppModal v-if="isAddOpen" title="Add User" subtitle="Creates a real sign-in account directly — share the password with them yourself, it is not emailed." :locked="isCreating" @close="isAddOpen = false">
      <div class="stack">
        <label class="field"><span class="field-label">Email *</span><input v-model="newUser.email" class="input" type="email" placeholder="name@example.com" autocapitalize="none" :disabled="isCreating" /></label>
        <label class="field"><span class="field-label">Full Name</span><input v-model="newUser.fullName" class="input" placeholder="Optional" :disabled="isCreating" /></label>
        <div class="row pw-row">
          <PasswordField v-model="newUser.password" label="Password *" autocomplete="new-password" class="grow" />
          <button type="button" class="icon-btn" aria-label="Generate another password" :disabled="isCreating" @click="newUser.password = generatePassword()"><RefreshCw :size="16" /></button>
        </div>
        <p class="muted small">At least 6 characters. A strong one is pre-filled — use refresh for another.</p>
        <label class="field"><span class="field-label">Role (optional)</span>
          <select v-model="newUser.roleId" class="select" :disabled="isCreating">
            <option :value="null">Unassigned (no page access)</option>
            <option v-for="role in roles" :key="role.id" :value="role.id">{{ role.name }}</option>
          </select>
        </label>
      </div>
      <template #footer>
        <button class="btn" :disabled="isCreating" @click="isAddOpen = false">Cancel</button>
        <button class="btn btn-primary" :disabled="isCreating" @click="createUser">{{ isCreating ? 'Creating…' : 'Create' }}</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.user { min-width: 200px; text-align: left; }
.option { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: none; text-align: left; font-size: 13px; }
.option:hover:not(:disabled) { background: var(--surface-hover); }
.block { display: block; }
.hint { margin-bottom: 10px; }
.area-row { display: flex; padding: 6px 0; }
.pw-row { align-items: flex-end; }
</style>
