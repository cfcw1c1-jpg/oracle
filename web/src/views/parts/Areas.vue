<script setup>
import { Award, CircleX, Download, Layers, Home, Pencil, Plus, Orbit, SlidersHorizontal, Trash2, User, UserPlus } from 'lucide-vue-next';
import { computed, onMounted, ref, watch } from 'vue';
import AppModal from '@/components/AppModal.vue';
import LoadingBlock from '@/components/LoadingBlock.vue';
import SearchInput from '@/components/SearchInput.vue';
import { confirmAction, exportCsv, fetchAllRows, isActiveStatus, searchTerm, showAlert } from '@/lib/data';
import { supabase } from '@/lib/supabase';

const AREA_TYPES = ['Sector', 'Cluster', 'Chapter'];
const TYPE_ICONS = { Sector: Orbit, Cluster: Layers, Chapter: Home };

const isLoading = ref(true);
const areas = ref([]);
const allMembers = ref([]);
const selectedAreaId = ref(null);
const isManageOpen = ref(false);
const isFormOpen = ref(false);
const formMode = ref('add');
const form = ref({ name: '', type: 'Sector', parent_id: null });
const isSaving = ref(false);
const headQuery = ref('');
const headResults = ref([]);

function matchesPrefix(memberArea, areaName) {
  const prefix = (areaName || '').trim().toLowerCase();
  return Boolean(prefix) && (memberArea || '').trim().toLowerCase().startsWith(prefix);
}

function membersUnder(areaName) {
  return allMembers.value.filter((member) => isActiveStatus(member.Status) && matchesPrefix(member.AreaName, areaName)).sort((a, b) => (a.Lastname || '').localeCompare(b.Lastname || ''));
}

function headName(area) {
  return area.members ? `${area.members.Firstname} ${area.members.Lastname}` : null;
}

const tree = computed(() => {
  const byParent = new Map();
  areas.value.forEach((area) => {
    const key = area.parent_id || 'root';
    byParent.set(key, [...(byParent.get(key) || []), area]);
  });
  function walk(parent, depth) {
    return [...(byParent.get(parent) || [])].sort((a, b) => a.name.localeCompare(b.name)).flatMap((area) => [{ ...area, depth, memberCount: membersUnder(area.name).length }, ...walk(area.id, depth + 1)]);
  }
  return walk('root', 0);
});

const selectedArea = computed(() => areas.value.find((area) => area.id === selectedAreaId.value) || null);
const areaMembers = computed(() => (selectedArea.value ? membersUnder(selectedArea.value.name) : []));
const chapterHeadCandidates = computed(() => (selectedArea.value?.type === 'Chapter'
  ? areaMembers.value.filter((member) => (member.PastoralService || '').trim().toUpperCase() === 'CH' && member.MemberIDNo !== selectedArea.value.head_member_id)
  : []));

// An area can't move under itself or under one of its own descendants.
const parentOptions = computed(() => {
  if (formMode.value !== 'edit' || !selectedArea.value) return areas.value;
  const excluded = new Set([selectedArea.value.id]);
  const stack = [selectedArea.value.id];
  while (stack.length) {
    const current = stack.pop();
    areas.value.filter((area) => area.parent_id === current && !excluded.has(area.id)).forEach((area) => {
      excluded.add(area.id);
      stack.push(area.id);
    });
  }
  return areas.value.filter((area) => !excluded.has(area.id));
});

async function load() {
  isLoading.value = true;
  try {
    const [areaResult, memberRows] = await Promise.all([
      supabase.from('areas').select('id, name, type, parent_id, head_member_id, members ( Firstname, Lastname )').order('name'),
      fetchAllRows('members', 'MemberIDNo, Firstname, Lastname, AreaName, Status, PastoralService', { orderBy: 'MemberIDNo' }),
    ]);
    if (areaResult.error) throw areaResult.error;
    areas.value = areaResult.data || [];
    allMembers.value = memberRows;
  } catch (error) {
    showAlert('Error Loading Areas', error.message);
  } finally {
    isLoading.value = false;
  }
}

watch(selectedAreaId, () => {
  headQuery.value = '';
});

watch(headQuery, async (query) => {
  const term = searchTerm(query);
  if (term.length < 2) {
    headResults.value = [];
    return;
  }
  const { data, error } = await supabase.from('members').select('MemberIDNo, Firstname, Lastname').or(`Firstname.ilike.%${term}%,Lastname.ilike.%${term}%`).limit(5);
  if (error) console.error('Error searching members:', error.message);
  else headResults.value = (data || []).filter((member) => member.MemberIDNo !== selectedArea.value?.head_member_id);
});

function openAdd() {
  formMode.value = 'add';
  form.value = { name: '', type: 'Sector', parent_id: null };
  isFormOpen.value = true;
}

function openEdit(area) {
  selectedAreaId.value = area.id;
  formMode.value = 'edit';
  form.value = { name: area.name, type: area.type, parent_id: area.parent_id };
  isFormOpen.value = true;
}

function openManage(area) {
  selectedAreaId.value = area.id;
  isManageOpen.value = true;
}

async function saveArea() {
  if (!form.value.name.trim()) {
    showAlert('Validation Error', 'Please enter an area name.');
    return;
  }
  isSaving.value = true;
  try {
    const payload = { ...form.value, name: form.value.name.trim() };
    const { error } = formMode.value === 'edit'
      ? await supabase.from('areas').update(payload).eq('id', selectedAreaId.value)
      : await supabase.from('areas').insert([payload]);
    if (error) throw error;
    isFormOpen.value = false;
    await load();
  } catch (error) {
    showAlert(formMode.value === 'edit' ? 'Error Updating Area' : 'Error Creating Area', error.message);
  } finally {
    isSaving.value = false;
  }
}

async function deleteArea(area) {
  const hasChildren = areas.value.some((item) => item.parent_id === area.id);
  if (!confirmAction('Delete Area', hasChildren ? `"${area.name}" has sub-areas nested under it. Deleting it will delete all of those too. Continue?` : `Delete "${area.name}"?`)) return;
  try {
    const { error } = await supabase.from('areas').delete().eq('id', area.id);
    if (error) throw error;
    if (selectedAreaId.value === area.id) selectedAreaId.value = null;
    await load();
  } catch (error) {
    showAlert('Error Deleting Area', error.message);
  }
}

async function setHead(memberId) {
  try {
    const { error } = await supabase.from('areas').update({ head_member_id: memberId }).eq('id', selectedAreaId.value);
    if (error) throw error;
    headQuery.value = '';
    await load();
  } catch (error) {
    showAlert(memberId ? 'Error Assigning Head' : 'Error Removing Head', error.message);
  }
}

function handleExport() {
  exportCsv('areas', [
    { key: 'name', label: 'Area' },
    { key: 'type', label: 'Type' },
    { key: 'parent', label: 'Parent', value: (area) => areas.value.find((item) => item.id === area.parent_id)?.name || '' },
    { key: 'head', label: 'Head', value: (area) => headName(area) || '' },
    { key: 'memberCount', label: 'Members' },
  ], tree.value);
}

onMounted(load);
</script>

<template>
  <section class="card">
    <header class="card-head">
      <div>
        <h2 class="card-title">{{ areas.length }} Area{{ areas.length === 1 ? '' : 's' }}</h2>
        <p class="card-sub">Build the Sector / Cluster / Chapter hierarchy and assign heads and members.</p>
      </div>
      <div class="row">
        <button class="btn" @click="handleExport"><Download :size="14" />Export</button>
        <button class="btn btn-primary" @click="openAdd"><Plus :size="14" />Add Area</button>
      </div>
    </header>
    <LoadingBlock v-if="isLoading" />
    <p v-else-if="!tree.length" class="empty">No areas yet. Add a Sector to get started.</p>
    <ul v-else class="tree">
      <li v-for="area in tree" :key="area.id" class="tree-row" :style="{ '--depth': area.depth }">
        <button class="tree-main" @click="openManage(area)">
          <span v-if="area.depth" class="hook">↳</span>
          <span class="icon-chip"><component :is="TYPE_ICONS[area.type]" :size="16" /></span>
          <span class="strong clamp">{{ area.name }}</span>
          <span class="pill accent">{{ area.type }}</span>
        </button>
        <div class="row row-wrap tree-meta">
          <span class="pill">{{ headName(area) || 'No head' }}</span>
          <span class="pill">{{ area.memberCount }} member{{ area.memberCount === 1 ? '' : 's' }}</span>
          <button class="link-btn" @click="openManage(area)"><SlidersHorizontal :size="13" />Manage</button>
          <button class="link-btn" @click="openEdit(area)"><Pencil :size="13" />Edit</button>
          <button class="icon-btn" :aria-label="`Delete ${area.name}`" @click="deleteArea(area)"><Trash2 :size="15" /></button>
        </div>
      </li>
    </ul>

    <AppModal v-if="isManageOpen && selectedArea" :title="`${selectedArea.name} — ${selectedArea.type}`" :width="560" @close="isManageOpen = false">
      <div class="stack">
        <h3 class="field-label">Head of Area</h3>
        <div v-if="selectedArea.members" class="row option">
          <span class="icon-chip"><User :size="15" /></span>
          <span class="grow strong">{{ selectedArea.members.Firstname }} {{ selectedArea.members.Lastname }}</span>
          <button class="icon-btn" aria-label="Remove head" @click="setHead(null)"><CircleX :size="17" /></button>
        </div>
        <p v-else class="muted small">No head assigned yet.</p>

        <template v-if="selectedArea.type === 'Chapter'">
          <p class="muted small">Tagged "Chapter Head" under this Area:</p>
          <p v-if="!chapterHeadCandidates.length" class="muted small">None yet — set a member's Pastoral Service to "CH" from Manage Members, or search below.</p>
          <button v-for="member in chapterHeadCandidates" :key="member.MemberIDNo" class="option option-btn" @click="setHead(member.MemberIDNo)"><Award :size="15" />{{ member.Lastname }}, {{ member.Firstname }}</button>
        </template>

        <SearchInput v-model="headQuery" :placeholder="selectedArea.type === 'Chapter' ? 'Search any other member...' : 'Search member to assign as head...'" />
        <button v-for="member in headResults" :key="member.MemberIDNo" class="option option-btn" @click="setHead(member.MemberIDNo)"><UserPlus :size="15" />{{ member.Firstname }} {{ member.Lastname }}</button>

        <h3 class="field-label section">Members Under This Area ({{ areaMembers.length }})</h3>
        <p class="muted small">Matched automatically from the Directory by Area name. To move a member in or out, edit their Area from Manage Members.</p>
        <div v-for="member in areaMembers.slice(0, 50)" :key="member.MemberIDNo" class="option">
          <p class="strong">{{ member.Lastname }}, {{ member.Firstname }}</p>
          <p class="muted small">{{ member.AreaName }}</p>
        </div>
        <p v-if="areaMembers.length > 50" class="muted small">+{{ areaMembers.length - 50 }} more — see Manage Members for the full list.</p>
        <p v-if="!areaMembers.length" class="muted small">No members in the Directory match this Area yet.</p>
      </div>
    </AppModal>

    <AppModal v-if="isFormOpen" :title="formMode === 'edit' ? 'Edit Area' : 'Add Area'" @close="isFormOpen = false">
      <div class="stack">
        <input v-model="form.name" class="input" placeholder="Area name (e.g. West 1)" aria-label="Area name" />
        <span class="field-label">Type</span>
        <div class="tabs"><button v-for="type in AREA_TYPES" :key="type" class="tab" :class="{ active: form.type === type }" @click="form.type = type">{{ type }}</button></div>
        <label class="field"><span class="field-label">Parent Area (optional)</span>
          <select v-model="form.parent_id" class="select">
            <option :value="null">No parent (top-level)</option>
            <option v-for="area in parentOptions" :key="area.id" :value="area.id">{{ area.name }} ({{ area.type }})</option>
          </select>
        </label>
      </div>
      <template #footer>
        <button class="btn" @click="isFormOpen = false">Cancel</button>
        <button class="btn btn-primary" :disabled="isSaving" @click="saveArea">{{ isSaving ? 'Saving…' : formMode === 'edit' ? 'Save' : 'Create' }}</button>
      </template>
    </AppModal>
  </section>
</template>

<style scoped>
.tree { list-style: none; margin: 0; padding: 0; }
.tree-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 20px; padding-left: calc(20px + var(--depth) * 28px); border-top: 1px solid var(--line); flex-wrap: wrap; }
.tree-main { display: flex; align-items: center; gap: 10px; border: 0; background: none; padding: 0; min-width: 0; font-size: 13.5px; }
.hook { color: var(--muted); }
.tree-meta { gap: 8px; }
.option { padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--radius-sm); font-size: 13px; }
.option-btn { display: flex; align-items: center; gap: 9px; background: none; width: 100%; text-align: left; }
.option-btn:hover { background: var(--surface-hover); }
.section { margin-top: 8px; }
@media (max-width: 767.98px) { .tree-row { padding-left: calc(14px + var(--depth) * 14px); padding-right: 14px; } }
</style>
