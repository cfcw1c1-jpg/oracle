<script setup>
import { Globe, Sparkles } from 'lucide-vue-next';
import { computed, ref } from 'vue';
import { showAlert } from '@/lib/data';
import { supabase } from '@/lib/supabase';

const isPredicting = ref(false);
const roster = ref(null);

const rows = computed(() => (roster.value ? [
  ['Team Leader', 'Seasoned Core', roster.value.teamLeader],
  ['Assistant Team Leader', 'Core Deployable', roster.value.assistantTeamLeader],
  ['Supervising Unit Head', 'Required: UH Title', roster.value.supervisingUnitHead],
  ['Team Servant', 'Required: HH Title', roster.value.teamServant],
  ['Prayer Warrior', 'Required: HH Title', roster.value.prayerWarrior],
  ['Music Ministry', 'Talent Track', roster.value.musicMinistry],
] : []));

function buildCandidates(participants) {
  const history = {};
  participants.forEach((participant) => {
    if (!participant.members) return;
    const gender = (participant.members.Gender || '').trim().toLowerCase();
    if (gender === 'female' || gender === 'f') return;

    const id = participant.MemberIDNo;
    const endDate = participant.clp_trainings?.end_date ? String(participant.clp_trainings.end_date) : null;
    if (!history[id]) {
      history[id] = {
        idNo: id,
        name: `${participant.members.Firstname} ${participant.members.Lastname}`.trim(),
        pastoralRole: participant.members.PastoralService ? participant.members.PastoralService.trim().toUpperCase() : 'MEMBER',
        pastRoles: [],
        gender: 'male',
        dateGraduated: endDate || '2026-01-01',
        nameOfHouseholdHead: (participant.members.NameOfHouseholdHead || '').trim(),
      };
    } else if (endDate && (history[id].dateGraduated === '2026-01-01' || endDate < history[id].dateGraduated)) {
      history[id].dateGraduated = endDate;
    }
    const role = participant.type === 'service_team' ? participant.sub_type : participant.type === 'participant' ? 'Graduate/Participant' : null;
    if (role && !history[id].pastRoles.includes(role)) history[id].pastRoles.push(role);
  });
  return Object.values(history);
}

async function generate() {
  isPredicting.value = true;
  roster.value = null;
  try {
    const { data, error } = await supabase.from('clp_training_participants').select('MemberIDNo, type, sub_type, clp_training_id, members!inner ( Firstname, Lastname, PastoralService, Gender, NameOfHouseholdHead ), clp_trainings ( start_date, end_date )');
    if (error) throw error;
    const candidates = buildCandidates(data || []);
    if (!candidates.length) throw new Error('No qualified historical male candidates found to evaluate.');

    const { data: sessionData } = await supabase.auth.getSession();
    const response = await fetch('/api/predict-roster', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionData.session?.access_token}` },
      body: JSON.stringify({ candidates }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error || 'Failed connecting to completion server');
    roster.value = payload.roster;
  } catch (error) {
    showAlert('Engine Allocation Fault', error.message);
  } finally {
    isPredicting.value = false;
  }
}
</script>

<template>
  <div class="page center">
    <div class="globe"><span class="pulse" /><Globe :size="40" class="spin" /></div>
    <h1 class="page-title">Christian Life Program - Oracle</h1>
    <p class="page-sub intro">Evaluates past historical training datasets against structural roles to project optimized leadership rosters.</p>
    <button class="btn btn-primary" :disabled="isPredicting" @click="generate"><Sparkles :size="15" />{{ isPredicting ? 'Generating…' : 'Generate Next Batch Roster' }}</button>

    <section v-if="roster && !isPredicting" class="card roster">
      <header class="card-head"><h2 class="card-title">Forecasted Roster Configuration</h2></header>
      <div v-for="[title, label, candidate] in rows" :key="title" class="line">
        <div><p class="strong">{{ title }}</p><span class="pill">{{ label }}</span></div>
        <div class="who"><p class="strong">{{ candidate?.name || 'No Matching Assignment' }}</p><p v-if="candidate?.idNo" class="muted small">ID: {{ candidate.idNo }}</p></div>
      </div>
      <p class="field-label sep">Assigned Facilitators (Min. 2)</p>
      <div v-for="(facilitator, index) in roster.facilitators" :key="facilitator.idNo" class="line">
        <div><p class="strong">Facilitator Option #{{ index + 1 }}</p><span class="pill">Assigned Cohort</span></div>
        <div class="who"><p class="strong">{{ facilitator.name }}</p><p class="muted small">ID: {{ facilitator.idNo }}</p></div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.center { align-items: center; text-align: center; }
.globe { position: relative; width: 96px; height: 96px; display: flex; align-items: center; justify-content: center; color: var(--primary); }
.pulse { position: absolute; inset: 8px; border-radius: 50%; background: var(--accent-soft); animation: pulse 3s ease-in-out infinite; }
.spin { position: relative; animation: spin 4s linear infinite; }
@keyframes pulse { 50% { transform: scale(1.2); } }
.intro { max-width: 480px; }
.roster { width: 100%; max-width: 640px; text-align: left; }
.line { display: flex; justify-content: space-between; gap: 14px; padding: 11px 20px; border-top: 1px solid var(--line); font-size: 13px; }
.who { text-align: right; }
.sep { display: block; padding: 12px 20px 4px; border-top: 1px solid var(--line); }
</style>
