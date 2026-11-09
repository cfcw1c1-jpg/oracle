<script setup>
import { ArrowLeft, CheckCircle2, Fingerprint, User, Wrench } from 'lucide-vue-next';
import { computed, ref } from 'vue';
import PrivacyConsentGate from '@/components/PrivacyConsentGate.vue';
import PublicShell from '@/components/PublicShell.vue';
import { parseTrainingName, TRAINING_COLUMNS } from '@/lib/formation';
import { supabase } from '@/lib/supabase';

const MODULE_GROUPS = [...new Set(TRAINING_COLUMNS.map((column) => column.group))].filter((group) => group !== 'Structural Status');

const memberId = ref('');
const lastname = ref('');
const isLookingUp = ref(false);
const notFound = ref(false);
const member = ref(null);
const historyError = ref('');
const pfoRow = ref(null);
const clpRows = ref([]);

const isDone = (column) => pfoRow.value?.[column.id] === 'Y' || pfoRow.value?.[column.id] === 'y';
const completed = computed(() => (pfoRow.value ? TRAINING_COLUMNS.filter(isDone) : []));
const grouped = computed(() => completed.value.reduce((groups, column) => ({ ...groups, [column.group]: [...(groups[column.group] || []), column] }), {}));
const moduleCompletion = computed(() => MODULE_GROUPS.map((group) => {
  const columns = TRAINING_COLUMNS.filter((column) => column.group === group);
  const done = columns.filter(isDone).length;
  return { group, done, total: columns.length, percent: columns.length ? Math.round((done / columns.length) * 100) : 0 };
}));

async function logSearch(entry) {
  const { error } = await supabase.from('training_lookup_logs').insert([entry]);
  if (error) console.warn('Failed to record search log:', error.message);
}

async function lookup() {
  const id = memberId.value.trim();
  const name = lastname.value.trim();
  if (!id || !name) return;
  isLookingUp.value = true;
  notFound.value = false;
  historyError.value = '';
  try {
    const { data, error } = await supabase.rpc('lookup_own_training_record', { p_member_id: id, p_lastname: name });
    if (error) throw error;
    logSearch({ event_type: 'search', query: `${id} / ${name}`, results_count: data ? 1 : 0 });
    if (!data) {
      notFound.value = true;
      return;
    }
    logSearch({ event_type: 'view_member', member_id_no: data.MemberIDNo?.toString(), member_name: `${data.Lastname}, ${data.Firstname}` });
    member.value = { MemberIDNo: data.MemberIDNo, Firstname: data.Firstname, Lastname: data.Lastname };
    pfoRow.value = data.pfo || null;
    clpRows.value = data.clp || [];
  } catch (error) {
    console.error('Lookup failed:', error.message);
    historyError.value = 'Something went wrong while loading training history. Please try again.';
  } finally {
    isLookingUp.value = false;
  }
}

function reset() {
  member.value = null;
  pfoRow.value = null;
  clpRows.value = [];
  historyError.value = '';
  notFound.value = false;
  memberId.value = '';
  lastname.value = '';
}
</script>

<template>
  <PrivacyConsentGate purpose="view your training record">
    <PublicShell subtitle="TRAINING RECORDS LOOKUP">
      <form v-if="!member" class="card card-pad stack" @submit.prevent="lookup">
        <p class="strong">Enter your Member ID and Last Name to view your record</p>
        <label class="field"><span class="field-label">Member ID</span><span class="icon-input"><Fingerprint :size="17" /><input v-model="memberId" class="input" placeholder="e.g. PM-00123" autocapitalize="characters" autofocus /></span></label>
        <label class="field"><span class="field-label">Last Name</span><span class="icon-input"><User :size="17" /><input v-model="lastname" class="input" placeholder="e.g. Dela Cruz" /></span></label>
        <button class="btn btn-primary btn-block" :disabled="!memberId.trim() || !lastname.trim() || isLookingUp">{{ isLookingUp ? 'Looking up…' : 'View My Record' }}</button>
        <p v-if="notFound" class="small text-danger">No record matches that Member ID and Last Name. Please check both and try again.</p>
        <p v-if="historyError" class="small text-danger">{{ historyError }}</p>
      </form>

      <section v-else class="card card-pad stack">
        <button class="link-btn" @click="reset"><ArrowLeft :size="15" />Search another member</button>
        <div class="row">
          <span class="avatar lg">{{ (member.Firstname?.[0] || '') + (member.Lastname?.[0] || '') }}</span>
          <div><p class="strong">{{ member.Lastname }}, {{ member.Firstname }}</p><p class="muted small">Member ID: {{ member.MemberIDNo }}</p></div>
        </div>

        <h2 class="card-title">Completion by Module</h2>
        <div v-for="module in moduleCompletion" :key="module.group" class="module">
          <div class="row row-between small"><span class="clamp">{{ module.group }}</span><span class="nowrap">{{ module.percent }}% ({{ module.done }}/{{ module.total }})</span></div>
          <div class="bar"><span class="fill" :class="{ full: module.percent === 100 }" :style="{ width: `${module.percent}%` }" /></div>
        </div>

        <h2 class="card-title">PFO Trainings Completed ({{ completed.length }})</h2>
        <p v-if="!completed.length" class="muted small">No PFO trainings on record yet.</p>
        <div v-for="(columns, group) in grouped" :key="group">
          <p class="field-label">{{ group }}</p>
          <p v-for="column in columns" :key="column.id" class="row small done"><CheckCircle2 :size="15" />{{ parseTrainingName(column.id) || column.label }}</p>
        </div>

        <h2 class="card-title">CLP Trainings Attended ({{ clpRows.length }})</h2>
        <p v-if="!clpRows.length" class="muted small">No CLP training batches on record yet.</p>
        <div v-for="row in clpRows" :key="row.id" class="row clp">
          <Wrench :size="15" />
          <div class="grow"><p class="strong small">{{ row.venue || 'Unknown venue' }}</p><p class="muted small">{{ row.start_date }} to {{ row.end_date }}</p></div>
          <span class="pill">{{ row.type === 'service_team' ? row.sub_type || 'Service Team' : 'Participant' }}</span>
        </div>
      </section>
    </PublicShell>
  </PrivacyConsentGate>
</template>

<style scoped>
.icon-input { position: relative; display: flex; align-items: center; }
.icon-input svg { position: absolute; left: 11px; color: var(--muted); }
.icon-input .input { padding-left: 36px; }
.avatar.lg { width: 48px; height: 48px; font-size: 15px; }
.bar { height: 6px; border-radius: 3px; background: var(--surface-soft); margin-top: 4px; overflow: hidden; }
.fill { display: block; height: 100%; background: var(--accent); }
.fill.full { background: var(--success); }
.done { padding: 3px 0; gap: 7px; }
.done svg { color: var(--success); flex: none; }
.clp { padding: 8px 0; border-top: 1px solid var(--line); }
</style>
