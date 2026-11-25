<script setup>
import { Check, CircleCheck, Copy, ExternalLink, Link, MapPin, Plus, RefreshCw, Trash2, X } from 'lucide-vue-next';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import AppModal from '@/components/AppModal.vue';
import DataTable from '@/components/DataTable.vue';
import LoadingBlock from '@/components/LoadingBlock.vue';
import PageHead from '@/components/PageHead.vue';
import StatCard from '@/components/StatCard.vue';
import { SERVICE_SUB_TYPES } from '@/lib/clp';
import { confirmAction, formatDateTime, searchTerm, showAlert } from '@/lib/data';
import { FAILURE_MESSAGES, fetchClpSyncStatus, syncClps } from '@/lib/ogdApi';
import { supabase } from '@/lib/supabase';

const isLoading = ref(false);
const trainings = ref([]);
const selected = ref(null);
const participants = ref([]);
const areas = ref([]);
const assignedAreaIds = ref([]);
const areaFilter = ref('All');
const trainingForm = ref(null);
const enlist = ref(null);
const searchResults = ref([]);
const isSearching = ref(false);
const linkCopied = ref(false);
const searchBox = ref(null);

// ---------- OGD (Evangelization page) ----------
const clpChapters = ref([]);
const syncChapterId = ref(null);
const isSyncing = ref(false);
const syncResult = ref(null);
const ogdDetails = ref(null);
const readyChapters = computed(() => clpChapters.value.filter((chapter) => chapter.isReady));
const syncChapter = computed(() => clpChapters.value.find((chapter) => chapter.areaId === syncChapterId.value) ?? null);
const isFromOgd = (training) => Boolean(training?.ogd_key);
// Header lines other than the date and venue, which the batch already shows.
const ogdHeads = computed(() => Object.entries(ogdDetails.value?.header ?? {}).filter(([label]) => !/^(date|venue)$/i.test(label)));
const ogdStatistics = computed(() => Object.entries(ogdDetails.value?.statistics ?? {}));

const activeCount = computed(() => participants.value.filter((item) => item.type === 'participant').length);
const serviceCount = computed(() => participants.value.filter((item) => item.type === 'service_team').length);

function withDescendants(rootIds) {
  const ids = new Set(rootIds);
  const stack = [...rootIds];
  while (stack.length) {
    const current = stack.pop();
    areas.value.filter((area) => area.parent_id === current && !ids.has(area.id)).forEach((area) => {
      ids.add(area.id);
      stack.push(area.id);
    });
  }
  return ids;
}

const selectableAreas = computed(() => {
  if (!assignedAreaIds.value.length) return areas.value;
  const ids = withDescendants(assignedAreaIds.value);
  return areas.value.filter((area) => ids.has(area.id));
});
const filterAreas = computed(() => (assignedAreaIds.value.length ? areas.value.filter((area) => assignedAreaIds.value.includes(area.id)) : areas.value));
const filteredTrainings = computed(() => (areaFilter.value === 'All' ? trainings.value : trainings.value.filter((training) => training.area_id === areaFilter.value)));

const publicLink = computed(() => (selected.value ? `${window.location.origin}/clp-registration?token=${selected.value.public_token}` : ''));

const memberLabel = (item) => (item.members ? `${item.members.Lastname}, ${item.members.Firstname}` : `ID: ${item.MemberIDNo}`);
const typeLabel = (item) => (item.type === 'service_team' ? 'Service Team' : 'Participant');
const columns = [
  { key: 'name', label: 'Member', value: memberLabel },
  { key: 'type', label: 'Category', value: typeLabel },
  { key: 'sub_type', label: 'Assignment' },
  { key: 'actions', label: 'Actions', action: true },
];

const emptyText = computed(() => {
  if (selected.value) return 'No members registered under this batch yet.';
  return filteredTrainings.value.length ? 'Please select or create a training batch above.' : 'No data found for this Area.';
});

async function fetchTrainings() {
  isLoading.value = true;
  try {
    const { data, error } = await supabase.from('clp_trainings').select('id, start_date, end_date, venue, public_token, area_id, source, ogd_key, program_type, is_published, target_pax, ogd_area_name, ogd_url, synced_at, areas ( id, name, type )').order('start_date', { ascending: false });
    if (error) throw error;
    trainings.value = data || [];
  } catch (error) {
    showAlert('Error Fetching Trainings', error.message);
  } finally {
    isLoading.value = false;
  }
}

async function fetchParticipants(trainingId) {
  const { data, error } = await supabase.from('clp_training_participants').select('id, MemberIDNo, type, sub_type, members (Firstname, Lastname)').eq('clp_training_id', trainingId);
  if (error) console.error('Error fetching participants:', error.message);
  else participants.value = data || [];
}

async function loadAreas() {
  try {
    const [areaResult, authResult] = await Promise.all([supabase.from('areas').select('id, name, type, parent_id').order('name'), supabase.auth.getUser()]);
    if (areaResult.error) throw areaResult.error;
    areas.value = areaResult.data || [];
    const user = authResult.data?.user;
    if (user) {
      const { data, error } = await supabase.from('user_areas').select('area_id').eq('profile_id', user.id);
      if (error) throw error;
      assignedAreaIds.value = (data || []).map((row) => row.area_id);
    }
  } catch (error) {
    console.error('Error loading areas:', error.message);
  }
}

async function fetchOgdDetails(training) {
  ogdDetails.value = null;
  if (!isFromOgd(training)) return;
  const { data, error } = await supabase.from('clp_ogd_details').select('header, service_team, participants, session_columns, sessions, graduates, statistics, synced_at').eq('clp_training_id', training.id).maybeSingle();
  if (error) console.error('Error fetching OGD details:', error.message);
  else if (selected.value?.id === training.id) ogdDetails.value = data;
}

watch(selected, (training) => {
  if (training) fetchParticipants(training.id);
  else participants.value = [];
  fetchOgdDetails(training);
});

async function loadSyncStatus() {
  try {
    clpChapters.value = await fetchClpSyncStatus();
    if (!readyChapters.value.some((chapter) => chapter.areaId === syncChapterId.value)) syncChapterId.value = readyChapters.value[0]?.areaId ?? null;
  } catch (error) {
    // Accounts without OGD access to any chapter simply get no Sync button.
    if (error.status !== 403) console.error('Error loading CLP sync status:', error.message);
  }
}

// Signs the chapter in to OGD and reads every CLP on its Evangelization page.
async function runSync() {
  if (!syncChapterId.value || isSyncing.value) return;
  isSyncing.value = true;
  syncResult.value = null;
  try {
    const result = await syncClps(syncChapterId.value);
    syncResult.value = result.ok
      ? { tone: 'success', text: `Read ${result.found} CLP${result.found === 1 ? '' : 's'} from OGD (${result.created} new, ${result.updated} updated).${result.isPartial ? ' Not everything fit in one run: sync again for the rest.' : ''}` }
      : { tone: 'error', text: FAILURE_MESSAGES[result.failureCode] || result.statusDetail || 'The sync from OGD failed.' };
    const selectedId = selected.value?.id;
    await fetchTrainings();
    selected.value = trainings.value.find((training) => training.id === selectedId) ?? selected.value;
  } catch (error) {
    syncResult.value = { tone: 'error', text: error.message };
  } finally {
    isSyncing.value = false;
    loadSyncStatus();
  }
}

watch([filteredTrainings], ([list]) => {
  if (!list.some((training) => training.id === selected.value?.id)) selected.value = list[0] || null;
});

function openNewBatch() {
  trainingForm.value = { start: '', end: '', venue: '', areaId: selectableAreas.value.length === 1 ? selectableAreas.value[0].id : null };
}

async function addTraining() {
  const { start, end, venue, areaId } = trainingForm.value;
  if (!start || !end || !venue) {
    showAlert('Validation Error', 'Please fill in all training fields.');
    return;
  }
  if (!areaId) {
    showAlert('Validation Error', 'Please select an Area for this training batch.');
    return;
  }
  isLoading.value = true;
  try {
    const { data, error } = await supabase.from('clp_trainings').insert([{ start_date: start, end_date: end, venue, area_id: areaId }]).select('id');
    if (error) throw error;
    showAlert('Success', 'CLP Training Batch created successfully!');
    trainingForm.value = null;
    await fetchTrainings();
    if (data?.[0]) selected.value = trainings.value.find((training) => training.id === data[0].id) || selected.value;
  } catch (error) {
    showAlert('Insertion Failed', error.message);
  } finally {
    isLoading.value = false;
  }
}

async function deleteTraining(training) {
  if (!confirmAction('Delete Training Batch', `Are you sure you want to delete "${training.venue}" (${training.start_date} to ${training.end_date})? This will also remove all enrolled member records from this batch. This cannot be undone.`)) return;
  isLoading.value = true;
  try {
    const { error: participantError } = await supabase.from('clp_training_participants').delete().eq('clp_training_id', training.id);
    if (participantError) throw participantError;
    const { error } = await supabase.from('clp_trainings').delete().eq('id', training.id);
    if (error) throw error;
    showAlert('Deleted', 'Training batch removed successfully.');
    await fetchTrainings();
  } catch (error) {
    showAlert('Delete Failed', error.message);
  } finally {
    isLoading.value = false;
  }
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(publicLink.value);
    linkCopied.value = true;
    setTimeout(() => {
      linkCopied.value = false;
    }, 2000);
  } catch {
    showAlert('Copy Failed', `Please copy the link manually:\n\n${publicLink.value}`);
  }
}

function focusSearch() {
  nextTick(() => searchBox.value?.focus());
}

function openEnlist() {
  enlist.value = { query: '', staged: [], isService: false, subType: SERVICE_SUB_TYPES[0] };
  focusSearch();
}

let searchToken = 0;
watch(() => enlist.value?.query, async (query) => {
  const term = searchTerm(query);
  if (term.length < 2) {
    searchResults.value = [];
    return;
  }
  const token = ++searchToken;
  isSearching.value = true;
  const { data, error } = await supabase.from('members').select('MemberIDNo, Firstname, Lastname').or(`Firstname.ilike.%${term}%,Lastname.ilike.%${term}%`).limit(5);
  if (token !== searchToken) return;
  isSearching.value = false;
  if (error) console.error('Error looking up members:', error.message);
  else searchResults.value = (data || []).filter((member) => !enlist.value?.staged.some((item) => item.MemberIDNo === member.MemberIDNo));
});

function stageMember(member) {
  enlist.value.staged.push(member);
  enlist.value.query = '';
  searchResults.value = [];
  focusSearch();
}

async function enrollMembers() {
  const { staged, isService, subType } = enlist.value;
  if (!staged.length || !selected.value) return;
  isLoading.value = true;
  try {
    const { error } = await supabase.from('clp_training_participants').insert(staged.map((member) => ({
      MemberIDNo: member.MemberIDNo,
      type: isService ? 'service_team' : 'participant',
      sub_type: isService ? subType : null,
      clp_training_id: selected.value.id,
    })));
    if (error) throw error;
    showAlert('Success', `Registered ${staged.length} members to batch.`);
    enlist.value = null;
    fetchParticipants(selected.value.id);
  } catch (error) {
    showAlert('Registration Failed', error.message);
  } finally {
    isLoading.value = false;
  }
}

async function removeParticipant(item) {
  if (!confirmAction('Remove Participant', 'Are you sure you want to remove this member from the training?')) return;
  const { error } = await supabase.from('clp_training_participants').delete().eq('MemberIDNo', item.MemberIDNo).eq('clp_training_id', selected.value.id);
  if (error) showAlert('Error', error.message);
  else fetchParticipants(selected.value.id);
}

onMounted(() => {
  fetchTrainings();
  loadAreas();
  loadSyncStatus();
});
</script>

<template>
  <div class="page">
    <PageHead title="CLP Training Maintenance" subtitle="Configure active training venues, event intervals, and registries.">
      <select v-if="filterAreas.length" v-model="areaFilter" class="select area" aria-label="Area">
        <option value="All">Area: All</option>
        <option v-for="area in filterAreas" :key="area.id" :value="area.id">{{ area.name }} ({{ area.type }})</option>
      </select>
      <select v-if="readyChapters.length > 1" v-model="syncChapterId" class="select area" aria-label="Chapter to sync from OGD" :disabled="isSyncing">
        <option v-for="chapter in readyChapters" :key="chapter.areaId" :value="chapter.areaId">{{ chapter.chapter }}</option>
      </select>
      <button v-if="readyChapters.length" class="btn" :disabled="isSyncing" @click="runSync"><RefreshCw :size="14" :class="{ spin: isSyncing }" />{{ isSyncing ? 'Syncing from OGD…' : 'Sync from OGD' }}</button>
      <button class="btn btn-primary" @click="openNewBatch"><Plus :size="14" />Add New Batch</button>
    </PageHead>

    <p v-if="isSyncing" class="notice">Signing in to OGD and reading every CLP on the Evangelization page with its details. This can take a few minutes; keep this page open.</p>
    <p v-else-if="syncResult" class="notice" :class="syncResult.tone">{{ syncResult.text }}</p>
    <p v-if="syncChapter?.sync && !isSyncing" class="muted small">
      {{ syncChapter.chapter }}: last read from OGD {{ formatDateTime(syncChapter.sync.syncedAt) }}<template v-if="syncChapter.sync.status === 'failed'"> (failed: {{ FAILURE_MESSAGES[syncChapter.sync.failureCode] || 'see details' }})</template>.
      <span v-if="syncChapter.sync.statusDetail" class="sync-detail">{{ syncChapter.sync.statusDetail }}</span>
    </p>
    <p v-else-if="clpChapters.length && !readyChapters.length" class="muted small">To read CLPs from OGD, save your chapter's Members Portal and Gmail logins under OGD Accounts.</p>

    <section class="card card-pad">
      <h2 class="field-label label-gap">Select Active Training Batch</h2>
      <p v-if="!filteredTrainings.length" class="muted">No data found for this Area.</p>
      <div v-else class="batches">
        <div v-for="training in filteredTrainings" :key="training.id" class="batch" :class="{ on: selected?.id === training.id }" role="button" tabindex="0" @click="selected = training" @keydown.enter="selected = training">
          <button class="batch-del" :aria-label="`Delete ${training.venue}`" @click.stop="deleteTraining(training)"><Trash2 :size="13" /></button>
          <p class="row batch-venue"><MapPin :size="12" /><span class="strong clamp">{{ training.venue }}</span></p>
          <p class="muted small">{{ training.start_date }} to {{ training.end_date }}</p>
          <p class="muted small clamp">{{ training.areas?.name || 'No Area' }}<span v-if="training.program_type"> · {{ training.program_type }}</span></p>
          <span v-if="isFromOgd(training)" class="pill info batch-tag">OGD</span>
        </div>
      </div>
    </section>

    <template v-if="selected">
      <section class="grid grid-4">
        <StatCard label="Current Venue" :value="selected.venue" />
        <StatCard label="Area" :value="selected.areas?.name || 'No Area'" />
        <StatCard label="Active Participants" :value="activeCount" />
        <StatCard label="Service Team" :value="serviceCount" />
      </section>
      <template v-if="isFromOgd(selected)">
        <section class="grid grid-4">
          <StatCard label="OGD Service Team" :value="ogdDetails?.service_team.length ?? '—'" />
          <StatCard label="OGD Participants" :value="ogdDetails?.participants.length ?? '—'" />
          <StatCard label="Sessions Held" :value="ogdDetails?.sessions.length ?? '—'" />
          <StatCard label="Graduates" :value="ogdDetails?.graduates.length ?? '—'" />
        </section>

        <section class="card card-pad stack">
          <header class="row row-wrap ogd-head">
            <h2 class="card-title grow">From OGD</h2>
            <span v-if="selected.program_type" class="pill accent">{{ selected.program_type }}</span>
            <span class="pill" :class="selected.is_published ? 'success' : ''">{{ selected.is_published ? 'Published' : 'Not published' }}</span>
            <span v-if="selected.target_pax !== null" class="pill">Target {{ selected.target_pax }} pax</span>
            <a v-if="selected.ogd_url" class="btn btn-sm" :href="selected.ogd_url" target="_blank" rel="noopener"><ExternalLink :size="13" />Open in OGD</a>
          </header>
          <div class="detail-grid">
            <div><span class="muted tiny">Venue</span><p>{{ selected.venue }}</p></div>
            <div><span class="muted tiny">Dates</span><p>{{ selected.start_date }} to {{ selected.end_date }}</p></div>
            <div v-if="selected.ogd_area_name"><span class="muted tiny">OGD Area</span><p>{{ selected.ogd_area_name }}</p></div>
            <div v-for="[label, value] in ogdHeads" :key="label"><span class="muted tiny">{{ label }}</span><p>{{ value }}</p></div>
            <div v-for="[label, value] in ogdStatistics" :key="`s-${label}`"><span class="muted tiny">{{ label }}</span><p>{{ value }}</p></div>
            <div v-if="selected.synced_at"><span class="muted tiny">Read from OGD</span><p>{{ formatDateTime(selected.synced_at) }}</p></div>
          </div>
          <p v-if="!ogdDetails" class="muted small">The details of this CLP were not read yet. Sync from OGD again to fetch its service team, participants and sessions.</p>
        </section>

        <template v-if="ogdDetails">
          <section class="card card-pad stack">
            <h2 class="card-title">Service Team ({{ ogdDetails.service_team.length }})</h2>
            <div v-if="ogdDetails.service_team.length" class="table-scroll">
              <table class="mini">
                <thead><tr><th>#</th><th>Role</th><th>Name</th><th>Gender</th></tr></thead>
                <tbody>
                  <tr v-for="(person, index) in ogdDetails.service_team" :key="`st-${index}`">
                    <td>{{ index + 1 }}</td><td>{{ person.role }}</td>
                    <td class="strong">{{ person.name }}<span v-if="person.memberId" class="muted small"> · {{ person.memberId }}</span></td>
                    <td>{{ person.gender || '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="muted small">No service team listed in OGD.</p>
          </section>

          <section class="card card-pad stack">
            <h2 class="card-title">Participants ({{ ogdDetails.participants.length }})</h2>
            <div v-if="ogdDetails.participants.length" class="table-scroll">
              <table class="mini">
                <thead>
                  <tr><th>#</th><th>Name</th><th>Nickname</th><th>Age</th><th>Gender</th><th v-for="(column, index) in ogdDetails.session_columns" :key="`sc-${index}`" class="center">{{ column }}</th></tr>
                </thead>
                <tbody>
                  <tr v-for="(person, index) in ogdDetails.participants" :key="`p-${index}`">
                    <td>{{ index + 1 }}</td>
                    <td class="strong">{{ person.name }}</td>
                    <td>{{ person.nickname || '—' }}</td>
                    <td>{{ person.age ?? '—' }}</td>
                    <td>{{ person.gender || '—' }}</td>
                    <td v-for="(column, sessionIndex) in ogdDetails.session_columns" :key="`pa-${index}-${sessionIndex}`" class="center">
                      <CircleCheck v-if="person.attendance?.[sessionIndex]" :size="16" class="attended" :aria-label="`Attended ${column}`" />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="muted small">No participants listed in OGD.</p>
          </section>

          <section class="card card-pad stack">
            <h2 class="card-title">Attendance (Sessions)</h2>
            <div v-if="ogdDetails.sessions.length" class="table-scroll">
              <table class="mini">
                <thead><tr><th>Date</th><th>Talk</th><th>Speaker</th><th class="right"># of Pax</th></tr></thead>
                <tbody>
                  <tr v-for="(session, index) in ogdDetails.sessions" :key="`se-${index}`">
                    <td class="nowrap">{{ session.date }}</td><td class="strong">{{ index + 1 }}. {{ session.talk }}</td><td>{{ session.speaker || '—' }}</td><td class="right">{{ session.pax }} pax</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="muted small">No sessions recorded in OGD yet.</p>
          </section>

          <section class="card card-pad stack">
            <h2 class="card-title">Graduates (Integrated to CFC)</h2>
            <div v-if="ogdDetails.graduates.length" class="table-scroll">
              <table class="mini">
                <thead><tr><th>ID No.</th><th>Name</th><th>Gender</th><th>Household Head</th></tr></thead>
                <tbody>
                  <tr v-for="(person, index) in ogdDetails.graduates" :key="`g-${index}`">
                    <td class="nowrap">{{ person.memberId || '—' }}</td><td class="strong">{{ person.name }}</td><td>{{ person.gender || '—' }}</td><td>{{ person.householdHead || '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="muted small">No graduates yet.</p>
          </section>
        </template>
      </template>

      <section class="card card-pad row link-card">
        <span class="icon-chip"><Link :size="15" /></span>
        <div class="grow">
          <p class="field-label">Public Registration Link</p>
          <p class="muted small clamp">{{ publicLink }}</p>
        </div>
        <button class="btn btn-primary btn-sm" @click="copyLink"><component :is="linkCopied ? Check : Copy" :size="13" />{{ linkCopied ? 'Copied' : 'Copy' }}</button>
      </section>
    </template>

    <section class="card">
      <header class="card-head">
        <h2 class="card-title">Enrolled Roster Directory</h2>
        <button v-if="selected" class="btn btn-primary btn-sm" @click="openEnlist"><Plus :size="13" />Enlist Members</button>
      </header>
      <LoadingBlock v-if="isLoading" />
      <DataTable v-else :columns="columns" :rows="participants" :empty-text="emptyText">
        <template #cell-name="{ row }"><span class="strong">{{ memberLabel(row) }}</span><br /><span class="muted small">ID: {{ row.MemberIDNo }}</span></template>
        <template #cell-type="{ row }"><span class="pill" :class="row.type === 'service_team' ? 'accent' : 'info'">{{ typeLabel(row) }}</span></template>
        <template #cell-actions="{ row }"><button class="icon-btn" aria-label="Remove participant" @click="removeParticipant(row)"><Trash2 :size="15" /></button></template>
      </DataTable>
    </section>

    <AppModal v-if="trainingForm" title="New CLP Training Batch" @close="trainingForm = null">
      <div class="stack">
        <label class="field"><span class="field-label">Start Date</span><input v-model="trainingForm.start" class="input" type="date" /></label>
        <label class="field"><span class="field-label">End Date</span><input v-model="trainingForm.end" class="input" type="date" /></label>
        <label class="field"><span class="field-label">Venue Destination</span><input v-model="trainingForm.venue" class="input" placeholder="e.g., Chapter Hall Room B" /></label>
        <label class="field"><span class="field-label">Area</span>
          <select v-model="trainingForm.areaId" class="select">
            <option :value="null" disabled>{{ selectableAreas.length ? 'Select an Area' : 'No areas available. Create one under Settings > Areas first.' }}</option>
            <option v-for="area in selectableAreas" :key="area.id" :value="area.id">{{ area.name }} ({{ area.type }})</option>
          </select>
        </label>
      </div>
      <template #footer>
        <button class="btn" @click="trainingForm = null">Cancel</button>
        <button class="btn btn-primary" :disabled="isLoading" @click="addTraining">Save Batch</button>
      </template>
    </AppModal>

    <AppModal v-if="enlist" title="Enlist Members to Batch" :width="540" @close="enlist = null">
      <div class="stack">
        <template v-if="enlist.staged.length">
          <span class="field-label">Selected Queue ({{ enlist.staged.length }})</span>
          <div class="row row-wrap">
            <span v-for="member in enlist.staged" :key="member.MemberIDNo" class="pill accent row">{{ member.Firstname }} {{ member.Lastname }}
              <button class="x" :aria-label="`Remove ${member.Firstname}`" @click="enlist.staged = enlist.staged.filter((item) => item.MemberIDNo !== member.MemberIDNo)"><X :size="13" /></button>
            </span>
          </div>
        </template>
        <label class="field"><span class="field-label">Search Member Name</span><input ref="searchBox" v-model="enlist.query" class="input" placeholder="Type name to find and append members..." /></label>
        <span v-if="isSearching" class="spinner sm" />
        <button v-for="member in searchResults" :key="member.MemberIDNo" class="result" @click="stageMember(member)"><span class="strong">{{ member.Lastname }}, {{ member.Firstname }}</span><span class="muted small">ID: {{ member.MemberIDNo }}</span></button>
        <p v-if="enlist.query.trim().length >= 2 && !searchResults.length && !isSearching" class="muted small">No additional matching members found.</p>

        <span class="field-label">Registration Category</span>
        <div class="tabs">
          <button class="tab" :class="{ active: !enlist.isService }" @click="enlist.isService = false">Participant</button>
          <button class="tab" :class="{ active: enlist.isService }" @click="enlist.isService = true">Service Team</button>
        </div>
        <label v-if="enlist.isService" class="field"><span class="field-label">Service Team Assignment Role</span>
          <select v-model="enlist.subType" class="select"><option v-for="role in SERVICE_SUB_TYPES" :key="role">{{ role }}</option></select>
        </label>
      </div>
      <template #footer>
        <button class="btn" @click="enlist = null">Cancel</button>
        <button class="btn btn-primary" :disabled="!enlist.staged.length || isLoading" @click="enrollMembers">Enroll Members</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.area { width: auto; min-width: 180px; }
.label-gap { display: block; margin-bottom: 10px; }
.batches { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 4px; }
.batch { position: relative; flex: none; width: 220px; padding: 12px; border: 1px solid var(--line); border-radius: var(--radius-md); cursor: pointer; }
.batch:hover { border-color: var(--accent); }
.batch.on { border-color: var(--primary); background: var(--accent-soft); }
.batch-venue { padding-right: 20px; gap: 5px; font-size: 13px; }
.batch-del { position: absolute; top: 8px; right: 8px; border: 0; background: none; color: var(--danger); padding: 2px; display: flex; }
.link-card { gap: 12px; }
.batch-tag { position: absolute; right: 30px; top: 8px; }
.ogd-head { gap: 8px; }
.detail-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px 16px; }
.detail-grid p { margin: 2px 0 0; font-size: 13px; }
.tiny { font-size: 11px; }
.table-scroll { overflow-x: auto; }
.mini { width: 100%; border-collapse: collapse; font-size: 13px; }
.mini th, .mini td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
.mini th { font-size: 12px; color: var(--muted); font-weight: 600; }
.mini .center { text-align: center; }
.mini .right { text-align: right; }
.attended { color: var(--success); }
.sync-detail { display: block; margin-top: 2px; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.x { border: 0; background: none; padding: 0; display: inline-flex; color: inherit; }
.result { display: flex; justify-content: space-between; gap: 10px; padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: none; text-align: left; font-size: 13px; }
.result:hover { background: var(--surface-hover); }
</style>
