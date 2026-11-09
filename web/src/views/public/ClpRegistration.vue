<script setup>
import { CheckCircle2, CircleAlert, CircleX, Fingerprint, Link as LinkIcon, User, Wrench } from 'lucide-vue-next';
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import LoadingBlock from '@/components/LoadingBlock.vue';
import PrivacyConsentGate from '@/components/PrivacyConsentGate.vue';
import PublicShell from '@/components/PublicShell.vue';
import { SERVICE_SUB_TYPES } from '@/lib/clp';
import { supabase } from '@/lib/supabase';

const route = useRoute();
const training = ref(null);
const isLoadingTraining = ref(true);
const memberId = ref('');
const lastname = ref('');
const isFinding = ref(false);
const notFound = ref(false);
const member = ref(null);
const isService = ref(false);
const subType = ref(SERVICE_SUB_TYPES[0]);
const isSubmitting = ref(false);
const submitError = ref('');
const alreadyRegistered = ref(false);
const isDone = ref(false);

async function findMember() {
  const id = memberId.value.trim();
  const name = lastname.value.trim();
  if (!id || !name) return;
  isFinding.value = true;
  notFound.value = false;
  submitError.value = '';
  try {
    const { data, error } = await supabase.rpc('find_member_by_id_and_lastname', { p_member_id: id, p_lastname: name });
    if (error) throw error;
    const found = data?.[0];
    if (!found) {
      notFound.value = true;
      return;
    }
    member.value = found;
    alreadyRegistered.value = false;
    const { data: registered, error: checkError } = await supabase.rpc('check_clp_registration', { p_training_id: training.value.id, p_member_id: found.MemberIDNo });
    if (checkError) throw checkError;
    alreadyRegistered.value = Boolean(registered);
  } catch (error) {
    console.error('Failed to find member:', error.message);
    notFound.value = true;
  } finally {
    isFinding.value = false;
  }
}

async function submit() {
  if (!training.value || !member.value || alreadyRegistered.value) return;
  isSubmitting.value = true;
  submitError.value = '';
  try {
    const { error } = await supabase.from('clp_training_participants').insert([{ MemberIDNo: member.value.MemberIDNo, type: isService.value ? 'service_team' : 'participant', sub_type: isService.value ? subType.value : null, clp_training_id: training.value.id }]);
    if (error) throw error;
    isDone.value = true;
  } catch (error) {
    submitError.value = error.message || 'Something went wrong while saving your registration.';
  } finally {
    isSubmitting.value = false;
  }
}

function clearMember() {
  member.value = null;
  alreadyRegistered.value = false;
}

function registerAnother() {
  memberId.value = '';
  lastname.value = '';
  notFound.value = false;
  clearMember();
  isService.value = false;
  subType.value = SERVICE_SUB_TYPES[0];
  submitError.value = '';
  isDone.value = false;
}

onMounted(async () => {
  const token = route.query.token;
  if (typeof token === 'string' && token) {
    const { data, error } = await supabase.from('clp_trainings').select('id, start_date, end_date, venue').eq('public_token', token).maybeSingle();
    if (error) console.error('Failed to load training batch:', error.message);
    training.value = data || null;
  }
  isLoadingTraining.value = false;
});
</script>

<template>
  <PrivacyConsentGate purpose="register for this CLP training batch">
    <PublicShell subtitle="CLP TRAINING REGISTRATION">
      <section class="card card-pad stack">
        <LoadingBlock v-if="isLoadingTraining" />
        <div v-else-if="!training" class="center">
          <LinkIcon :size="40" class="muted" />
          <h1 class="page-title">Invalid or Expired Link</h1>
          <p class="muted">This registration link isn't recognized. Please use the link shared by your CLP batch coordinator.</p>
        </div>
        <div v-else-if="isDone" class="center">
          <CheckCircle2 :size="48" class="text-success" />
          <h1 class="page-title">You're registered!</h1>
          <p class="muted">{{ member.Lastname }}, {{ member.Firstname }} has been added to {{ training.venue }} ({{ training.start_date }} to {{ training.end_date }}) as {{ isService ? subType : 'a Participant' }}.</p>
          <button class="btn btn-primary" @click="registerAnother">Register Another Member</button>
        </div>
        <template v-else>
          <div class="row banner">
            <Wrench :size="16" />
            <div class="grow"><p class="strong clamp">{{ training.venue }}</p><p class="muted small">{{ training.start_date }} to {{ training.end_date }}</p></div>
          </div>
          <p class="step">Step 1 of 2</p>
          <h2 class="card-title">Enter your Member ID and Last Name</h2>
          <form v-if="!member" class="stack" @submit.prevent="findMember">
            <label class="field"><span class="field-label">Member ID</span><span class="icon-input"><Fingerprint :size="17" /><input v-model="memberId" class="input" placeholder="e.g. PM-00123" autocapitalize="characters" autofocus /></span></label>
            <label class="field"><span class="field-label">Last Name</span><span class="icon-input"><User :size="17" /><input v-model="lastname" class="input" placeholder="e.g. Dela Cruz" /></span></label>
            <button class="btn btn-primary btn-block" :disabled="!memberId.trim() || !lastname.trim() || isFinding">{{ isFinding ? 'Finding…' : 'Find My Record' }}</button>
            <p v-if="notFound" class="small text-danger">No record matches that Member ID and Last Name. Please check both and try again.</p>
          </form>
          <template v-else>
            <div class="row banner">
              <span class="avatar">{{ (member.Firstname?.[0] || '') + (member.Lastname?.[0] || '') }}</span>
              <div class="grow"><p class="strong">{{ member.Lastname }}, {{ member.Firstname }}</p><p class="muted small">Member ID: {{ member.MemberIDNo }}</p></div>
              <button class="icon-btn" aria-label="Choose a different member" @click="clearMember"><CircleX :size="20" /></button>
            </div>
            <p v-if="alreadyRegistered" class="notice warn row"><CircleAlert :size="16" />This member is already registered for this batch.</p>
            <template v-else>
              <p class="step">Step 2 of 2</p>
              <h2 class="card-title">Select your role for this batch</h2>
              <div class="tabs">
                <button class="tab" :class="{ active: !isService }" @click="isService = false">Participant</button>
                <button class="tab" :class="{ active: isService }" @click="isService = true">Service Team</button>
              </div>
              <label v-if="isService" class="field"><span class="field-label">Service Team Assignment Role</span><select v-model="subType" class="select"><option v-for="role in SERVICE_SUB_TYPES" :key="role">{{ role }}</option></select></label>
              <p v-if="submitError" class="small text-danger">{{ submitError }}</p>
              <button class="btn btn-primary btn-block" :disabled="isSubmitting" @click="submit">{{ isSubmitting ? 'Saving…' : 'Complete Registration' }}</button>
            </template>
          </template>
        </template>
      </section>
    </PublicShell>
  </PrivacyConsentGate>
</template>

<style scoped>
.center { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; padding: 20px 0; }
.banner { padding: 10px 12px; background: var(--accent-soft); border-radius: var(--radius-sm); }
.step { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.icon-input { position: relative; display: flex; align-items: center; }
.icon-input svg { position: absolute; left: 11px; color: var(--muted); }
.icon-input .input { padding-left: 36px; }
.warn { background: var(--warning-soft); color: var(--warning); }
</style>
