<script setup>
import { ChevronDown, ChevronRight, ChevronUp, Download, Info, RefreshCw, Save, Trash2 } from 'lucide-vue-next';
import { computed, onMounted, ref, watch } from 'vue';
import AppModal from '@/components/AppModal.vue';
import LoadingBlock from '@/components/LoadingBlock.vue';
import MultiSelect from '@/components/MultiSelect.vue';
import PageHead from '@/components/PageHead.vue';
import { buildAreaOptions, loadAssignedAreaNames, matchesArea } from '@/lib/areas';
import { confirmAction, downloadBlob, exportCsv, fetchAllRows, isActiveStatus, showAlert } from '@/lib/data';
import { buildStageInsight, computeTrackStat, FORMATION_STAGES, getRoleLabel, normalizeRole, PFO_TRAINING_SELECT, trackPendingMembers, trackRolesLabel } from '@/lib/formation';
import { supabase } from '@/lib/supabase';

const SNAPSHOT_COLUMNS = 'id, created_at, created_by_email, note, area_filter, role_filter, total_members, track_results';

const isLoading = ref(true);
const membersRows = ref([]);
const pfoRows = ref([]);
const assignedAreaNames = ref([]);
const areaFilter = ref('All');
const selectedRoles = ref([]);
const snapshots = ref([]);
const snapshotsLoading = ref(true);
const snapshotNote = ref('');
const isSavingSnapshot = ref(false);
const expandedId = ref(null);
const deletingId = ref(null);

function formatStamp(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const areaOptions = computed(() => buildAreaOptions(assignedAreaNames.value, membersRows.value.map((member) => member.AreaName)));
const roleOptions = computed(() => [...new Set(membersRows.value.map((member) => normalizeRole(member.PastoralService)))].sort().map((code) => ({ value: code, label: getRoleLabel(code) })));

function matchesRole(code) {
  return selectedRoles.value.length === 0 || selectedRoles.value.includes(normalizeRole(code));
}

const activeMembers = computed(() => membersRows.value.filter((member) => isActiveStatus(member.Status) && matchesArea(areaFilter.value, member.AreaName) && matchesRole(member.PastoralService)));
const totalActive = computed(() => activeMembers.value.length);
const activePfoRows = computed(() => pfoRows.value.filter((row) => isActiveStatus(row.members?.Status) && matchesArea(areaFilter.value, row.members?.AreaName) && matchesRole(row.members?.PastoralService)));
const denominatorLabel = computed(() => (selectedRoles.value.length ? `Total Active Members (${selectedRoles.value.map(getRoleLabel).join(', ')})` : 'Total Active Members'));

const stageResults = computed(() => FORMATION_STAGES.map((stage) => {
  const trackResults = stage.tracks.map((track) => ({ ...track, ...computeTrackStat(track, activePfoRows.value, activeMembers.value) }));
  return { ...stage, trackResults, insight: buildStageInsight(trackResults.filter((track) => track.tracked).map((track) => track.percent)) };
}));

// A trend only means something against a snapshot taken under the same filters.
const comparableSnapshot = computed(() => {
  const current = [...selectedRoles.value].sort();
  return snapshots.value.find((snapshot) => {
    const roles = [...(snapshot.role_filter || [])].sort();
    return snapshot.area_filter === areaFilter.value && roles.length === current.length && roles.every((role, index) => role === current[index]);
  }) || null;
});

function deltaFor(track) {
  if (!track.tracked) return null;
  const entry = (comparableSnapshot.value?.track_results || []).find((item) => item.code === track.code);
  return entry?.tracked ? track.percent - entry.percent : null;
}

function deltaLabel(delta) {
  return `${delta > 0.05 ? '▲' : delta < -0.05 ? '▼' : '—'} ${Math.abs(delta).toFixed(1)}%`;
}

// ---------- Leaders Track: who has not finished a training yet ----------
const pendingTrack = ref(null);
const pendingSearch = ref('');
const pendingMembers = computed(() => (pendingTrack.value ? trackPendingMembers(pendingTrack.value, activeMembers.value, activePfoRows.value) : []));
const shownPending = computed(() => {
  const query = pendingSearch.value.trim().toLowerCase();
  if (!query) return pendingMembers.value;
  return pendingMembers.value.filter((member) => [member.Lastname, member.Firstname, member.MemberIDNo, member.AreaName, getRoleLabel(normalizeRole(member.PastoralService))].filter(Boolean).join(' ').toLowerCase().includes(query));
});
const memberName = (member) => [member.Lastname, member.Firstname].filter(Boolean).join(', ') || member.MemberIDNo;

function openPending(track) {
  pendingSearch.value = '';
  pendingTrack.value = track;
}

function exportPending() {
  const track = pendingTrack.value;
  exportCsv(`${track.code.toLowerCase()}-not-yet-finished-${new Date().toISOString().slice(0, 10)}`, [
    { key: 'MemberIDNo', label: 'Member ID' }, { key: 'Lastname', label: 'Last Name' }, { key: 'Firstname', label: 'First Name' },
    { key: 'PastoralService', label: 'Role', value: (member) => getRoleLabel(normalizeRole(member.PastoralService)) },
    { key: 'AreaName', label: 'Area' }, { key: 'talksDone', label: `${track.code} Talks Done`, value: (member) => `${member.talksDone} of ${member.talkCount}` },
  ], shownPending.value);
}

async function generateStats() {
  isLoading.value = true;
  try {
    const [members, pfo] = await Promise.all([
      fetchAllRows('members', 'MemberIDNo, Lastname, Firstname, PastoralService, Status, AreaName', { orderBy: 'MemberIDNo' }),
      fetchAllRows('pfo_members', `${PFO_TRAINING_SELECT}, members (PastoralService, Status, AreaName)`, { orderBy: 'MemberIDNo' }),
    ]);
    membersRows.value = members;
    pfoRows.value = pfo;
  } catch (error) {
    showAlert('Error Generating Statistics', error.message);
  } finally {
    isLoading.value = false;
  }
}

async function loadSnapshots() {
  snapshotsLoading.value = true;
  try {
    const { data, error } = await supabase.from('formation_stats_snapshots').select(SNAPSHOT_COLUMNS).eq('area_filter', areaFilter.value).order('created_at', { ascending: false }).limit(30);
    if (error) throw error;
    snapshots.value = data || [];
  } catch (error) {
    console.error('Error loading formation history:', error.message);
  } finally {
    snapshotsLoading.value = false;
  }
}

async function saveSnapshot() {
  isSavingSnapshot.value = true;
  try {
    const { data } = await supabase.auth.getUser();
    const { error } = await supabase.from('formation_stats_snapshots').insert([{
      created_by: data?.user?.id || null,
      created_by_email: data?.user?.email || null,
      note: snapshotNote.value.trim() || null,
      area_filter: areaFilter.value,
      role_filter: selectedRoles.value,
      total_members: totalActive.value,
      track_results: stageResults.value.flatMap((stage) => stage.trackResults.map((track) => ({
        stageKey: stage.key, stageLabel: stage.label, code: track.code, name: track.name, tracked: track.tracked,
        completedCount: track.tracked ? track.completedCount : null, total: track.tracked ? track.total : null, percent: track.tracked ? track.percent : null,
      }))),
    }]);
    if (error) throw error;
    snapshotNote.value = '';
    await loadSnapshots();
  } catch (error) {
    showAlert('Save Failed', error.message);
  } finally {
    isSavingSnapshot.value = false;
  }
}

async function deleteSnapshot(snapshot) {
  if (!confirmAction('Delete Snapshot', `Remove the snapshot saved ${formatStamp(snapshot.created_at)}${snapshot.note ? ` ("${snapshot.note}")` : ''}? This cannot be undone.`)) return;
  deletingId.value = snapshot.id;
  try {
    const { error } = await supabase.from('formation_stats_snapshots').delete().eq('id', snapshot.id);
    if (error) throw error;
    snapshots.value = snapshots.value.filter((item) => item.id !== snapshot.id);
    if (expandedId.value === snapshot.id) expandedId.value = null;
  } catch (error) {
    showAlert('Delete Failed', error.message);
  } finally {
    deletingId.value = null;
  }
}

function exportReport() {
  const lines = [`${denominatorLabel.value}: ${totalActive.value}`, ''];
  stageResults.value.forEach((stage) => {
    lines.push(`${stage.marker} ${stage.label}:`, '');
    stage.trackResults.forEach((track, index) => {
      const prefix = `${index + 1}. ${track.name} (${track.code})`;
      lines.push(track.tracked ? `${prefix}: ${track.completedCount} / ${track.total} → ${track.percent.toFixed(1)}%` : `${prefix}: Not tracked in current data`);
    });
    lines.push('', `Insight: ${stage.insight}`, '');
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  downloadBlob(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }), `cfc-pfo-formation-stats-${stamp}.txt`);
}

onMounted(async () => {
  generateStats();
  try {
    assignedAreaNames.value = await loadAssignedAreaNames();
  } catch (error) {
    console.error('Error loading assigned areas:', error.message);
  }
});
watch(areaFilter, loadSnapshots, { immediate: true });
</script>

<template>
  <LoadingBlock v-if="isLoading" variant="page" :rows="5" />
  <div v-else class="page">
    <PageHead title="PFO Formation Statistics" subtitle="Auto-computed completion rates across every formation stage, based on the current member roster.">
      <button class="btn" @click="generateStats"><RefreshCw :size="14" />Refresh</button>
      <button class="btn btn-primary" @click="exportReport"><Download :size="14" />Export Report</button>
    </PageHead>

    <section class="card card-pad summary">
      <div>
        <p class="muted small">{{ denominatorLabel }}</p>
        <p class="summary-value">{{ totalActive }}</p>
      </div>
      <div class="row row-wrap filters">
        <label class="field"><span class="field-label">Area</span>
          <select v-model="areaFilter" class="select"><option v-for="option in areaOptions" :key="option">{{ option }}</option></select>
        </label>
        <div class="field"><span class="field-label">Roles</span>
          <MultiSelect v-model="selectedRoles" :options="roleOptions" all-label="All Roles" noun="role" />
        </div>
      </div>
    </section>

    <p class="muted small">
      {{ comparableSnapshot ? `Comparing against the snapshot saved ${formatStamp(comparableSnapshot.created_at)} (same Area/Roles filters).` : 'No comparable snapshot yet for these filters — save one below to start tracking trends over time.' }}
    </p>

    <section class="grid grid-2">
      <article v-for="stage in stageResults" :key="stage.key" class="card card-pad stack" :style="{ '--stage': stage.color }">
        <h2 class="card-title row"><span class="stage-dot" />{{ stage.label }}</h2>
        <component
          :is="stage.key === 'leadersTrack' && track.tracked ? 'button' : 'div'"
          v-for="track in stage.trackResults"
          :key="track.code"
          class="track"
          :class="{ 'track-link': stage.key === 'leadersTrack' && track.tracked }"
          :aria-label="stage.key === 'leadersTrack' && track.tracked ? `Show members who have not finished ${track.name}` : undefined"
          @click="stage.key === 'leadersTrack' && track.tracked && openPending(track)"
        >
          <div class="grow">
            <p class="strong">{{ track.name }}</p>
            <p class="muted small">{{ track.code }}<template v-if="track.roles"> · {{ trackRolesLabel(track) }} only</template></p>
          </div>
          <div v-if="track.tracked" class="track-stat">
            <span class="muted small">{{ track.completedCount }} / {{ track.total }}</span>
            <strong class="track-pct">{{ track.percent.toFixed(1) }}%</strong>
            <span v-if="deltaFor(track) !== null" class="small" :class="deltaFor(track) > 0.05 ? 'text-success' : deltaFor(track) < -0.05 ? 'text-danger' : 'muted'">{{ deltaLabel(deltaFor(track)) }}</span>
          </div>
          <span v-else class="pill">Not Tracked</span>
          <ChevronRight v-if="stage.key === 'leadersTrack' && track.tracked" :size="16" class="muted track-chevron" />
        </component>
        <p class="insight"><Info :size="14" />{{ stage.insight }}</p>
      </article>
    </section>

    <section class="card card-pad stack">
      <div>
        <h2 class="card-title">Snapshot History — Area: {{ areaFilter }}</h2>
        <p class="card-sub">Save the numbers above as a dated record. History only shows snapshots saved under the Area selected above.</p>
      </div>
      <div class="row row-wrap">
        <input v-model="snapshotNote" class="input grow note" placeholder='Optional note (e.g. "End of Q1")' />
        <button class="btn btn-primary" :disabled="isSavingSnapshot" @click="saveSnapshot"><Save :size="14" />{{ isSavingSnapshot ? 'Saving…' : 'Save Snapshot' }}</button>
      </div>
      <LoadingBlock v-if="snapshotsLoading" />
      <p v-else-if="!snapshots.length" class="empty">No snapshots saved yet for the "{{ areaFilter }}" area.</p>
      <div v-for="snapshot in snapshots" v-else :key="snapshot.id" class="snap">
        <div class="row">
          <button class="snap-toggle grow" :aria-expanded="expandedId === snapshot.id" @click="expandedId = expandedId === snapshot.id ? null : snapshot.id">
            <span class="grow">
              <span class="strong snap-date">{{ formatStamp(snapshot.created_at) }}</span>
              <span class="muted small snap-meta">{{ snapshot.total_members }} members · Roles: {{ snapshot.role_filter?.length ? snapshot.role_filter.join(', ') : 'All' }}{{ snapshot.note ? ` · "${snapshot.note}"` : '' }}</span>
            </span>
            <component :is="expandedId === snapshot.id ? ChevronUp : ChevronDown" :size="16" />
          </button>
          <button class="icon-btn" :disabled="deletingId === snapshot.id" aria-label="Delete snapshot" @click="deleteSnapshot(snapshot)"><Trash2 :size="16" /></button>
        </div>
        <ul v-if="expandedId === snapshot.id" class="snap-detail">
          <li v-for="track in snapshot.track_results || []" :key="track.code">
            <span class="clamp grow">{{ track.name }} ({{ track.code }})</span>
            <span class="muted nowrap">{{ track.tracked ? `${track.completedCount} / ${track.total ?? snapshot.total_members} · ${track.percent.toFixed(1)}%` : 'Not tracked' }}</span>
          </li>
        </ul>
      </div>
    </section>

    <AppModal
      v-if="pendingTrack"
      :title="`Not yet finished: ${pendingTrack.name}`"
      :subtitle="`${pendingMembers.length} of ${pendingTrack.total} ${pendingTrack.roles ? trackRolesLabel(pendingTrack) : 'members'} · Area: ${areaFilter}`"
      :width="620"
      @close="pendingTrack = null"
    >
      <div class="stack">
        <div class="pending-tools">
          <input v-model="pendingSearch" class="input" type="search" placeholder="Search name, ID, area or role" aria-label="Search members" />
          <button class="btn" :disabled="!shownPending.length" @click="exportPending"><Download :size="14" />Export CSV</button>
        </div>
        <p v-if="!pendingMembers.length" class="muted small">Everyone in scope has finished {{ pendingTrack.code }}.</p>
        <p v-else-if="!shownPending.length" class="muted small">No one matches "{{ pendingSearch }}".</p>
        <ul v-else class="pending-list">
          <li v-for="member in shownPending" :key="member.MemberIDNo" class="pending-item">
            <div class="grow">
              <p class="strong clamp">{{ memberName(member) }}</p>
              <p class="muted small">{{ getRoleLabel(normalizeRole(member.PastoralService)) }} · {{ member.AreaName || 'No area' }} · {{ member.MemberIDNo }}</p>
            </div>
            <div class="pending-count">
              <span class="pill" :class="member.talksDone ? 'warning' : 'danger'">{{ member.talksDone ? 'In progress' : 'Not started' }}</span>
              <p class="muted tiny">{{ member.talksDone }} of {{ member.talkCount }} talks</p>
            </div>
          </li>
        </ul>
      </div>
    </AppModal>
  </div>
</template>

<style scoped>
.summary { display: flex; align-items: center; justify-content: space-between; gap: 18px; flex-wrap: wrap; }
.summary-value { font-size: 30px; font-weight: var(--fw-medium); letter-spacing: -0.02em; }
.filters { align-items: flex-start; }
.filters .select { min-width: 190px; }
.stage-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--accent); }
.track { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
.track-link { border: 0; border-bottom: 1px solid var(--line); background: none; text-align: left; color: inherit; font: inherit; font-size: 13px; cursor: pointer; border-radius: 8px; padding-inline: 6px; margin-inline: -6px; width: calc(100% + 12px); transition: background 0.15s; }
.track-link:hover { background: var(--surface-hover); }
.track-link:hover .track-chevron { transform: translateX(2px); }
.track-chevron { flex: none; transition: transform 0.15s; }
.pending-tools { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.pending-tools .input { flex: 1; min-width: 160px; }
.pending-list { list-style: none; margin: 0; padding: 0; max-height: min(60vh, 520px); overflow-y: auto; border: 1px solid var(--line); border-radius: var(--radius-md); }
.pending-item { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-bottom: 1px solid var(--line); font-size: 13px; }
.pending-item:last-child { border-bottom: 0; }
.pending-count { flex: none; text-align: right; }
.pending-count .tiny { font-size: 11px; margin-top: 3px; }
.track-stat { display: flex; flex-direction: column; align-items: flex-end; flex: none; }
.track-pct { font-size: 14px; }
.insight { display: flex; gap: 7px; align-items: flex-start; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--accent-soft); color: var(--link); font-size: 12.5px; }
.insight svg { flex: none; margin-top: 2px; }
.note { min-width: 200px; }
.snap { border-top: 1px solid var(--line); padding-top: 8px; }
.snap-toggle { display: flex; align-items: center; gap: 8px; border: 0; background: none; padding: 2px; text-align: left; }
.snap-date, .snap-meta { display: block; }
.snap-detail { list-style: none; margin: 6px 0 4px; padding: 0; display: grid; gap: 5px; font-size: 12.5px; }
.snap-detail li { display: flex; gap: 12px; }
@media (max-width: 767.98px) {
  .stage-dot { background: var(--stage); }
  .track-pct { color: var(--stage); }
}
</style>
