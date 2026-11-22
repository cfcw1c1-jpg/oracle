<script setup>
import { CalendarDays, CheckCircle2, Fingerprint, Link as LinkIcon, MapPin, User } from 'lucide-vue-next';
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import LoadingBlock from '@/components/LoadingBlock.vue';
import PrivacyConsentGate from '@/components/PrivacyConsentGate.vue';
import PublicShell from '@/components/PublicShell.vue';

// The public attendance link for one activity. A member enters their Member
// ID and last name; /api/activity-attendance checks them against Oracle's
// members list and adds them to the activity's attendees.

const route = useRoute();
const token = typeof route.query.token === 'string' ? route.query.token : '';
const activity = ref(null);
const isLoading = ref(true);
const memberId = ref('');
const lastName = ref('');
const isSubmitting = ref(false);
const error = ref('');
const done = ref(null);

function formatWhen(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

async function submit() {
  if (!memberId.value.trim() || !lastName.value.trim()) return;
  isSubmitting.value = true;
  error.value = '';
  try {
    const response = await fetch('/api/activity-attendance', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, memberId: memberId.value.trim(), lastName: lastName.value.trim() }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) throw new Error(payload?.error || 'Something went wrong. Please try again.');
    done.value = payload;
    activity.value = payload.activity;
  } catch (failure) {
    error.value = failure.message;
  } finally {
    isSubmitting.value = false;
  }
}

function another() {
  memberId.value = '';
  lastName.value = '';
  error.value = '';
  done.value = null;
}

onMounted(async () => {
  if (token) {
    const response = await fetch(`/api/activity-attendance?token=${encodeURIComponent(token)}`).catch(() => null);
    const payload = response?.ok ? await response.json().catch(() => null) : null;
    activity.value = payload?.activity ?? null;
  }
  isLoading.value = false;
});
</script>

<template>
  <PrivacyConsentGate purpose="record your attendance for this activity">
    <PublicShell subtitle="ACTIVITY ATTENDANCE">
      <section class="card card-pad stack">
        <LoadingBlock v-if="isLoading" variant="text" :rows="3" />
        <div v-else-if="!activity" class="center">
          <LinkIcon :size="40" class="muted" />
          <h1 class="page-title">Invalid Link</h1>
          <p class="muted">This attendance link isn't recognized. Please use the link shared by your activity's team leader.</p>
        </div>
        <template v-else>
          <div class="banner stack">
            <p class="strong title">{{ activity.name }}</p>
            <p v-if="activity.activityType" class="muted small">{{ activity.activityType }}<template v-if="activity.areaName || activity.chapter"> · {{ activity.areaName || activity.chapter }}</template></p>
            <p class="row small"><CalendarDays :size="14" />{{ formatWhen(activity.startsAt) }}<template v-if="activity.endsAt"> – {{ formatWhen(activity.endsAt) }}</template></p>
            <p v-if="activity.venue" class="row small"><MapPin :size="14" />{{ activity.venue }}</p>
          </div>
          <div v-if="done" class="center">
            <CheckCircle2 :size="48" class="text-success" />
            <h1 class="page-title">{{ done.alreadyRecorded ? 'Already recorded' : 'Attendance recorded' }}</h1>
            <p class="muted">{{ done.name }} {{ done.alreadyRecorded ? 'was already on' : 'has been added to' }} the attendance for {{ activity.name }}.</p>
            <button class="btn btn-primary" @click="another">Record another member</button>
          </div>
          <form v-else class="stack" @submit.prevent="submit">
            <h2 class="card-title">Enter your Member ID and Last Name</h2>
            <label class="field"><span class="field-label">Member ID</span><span class="icon-input"><Fingerprint :size="17" /><input v-model="memberId" class="input" placeholder="e.g. PM-2021-337029" autocapitalize="characters" autofocus /></span></label>
            <label class="field"><span class="field-label">Last Name</span><span class="icon-input"><User :size="17" /><input v-model="lastName" class="input" placeholder="e.g. Dela Cruz" /></span></label>
            <button class="btn btn-primary btn-block" :disabled="!memberId.trim() || !lastName.trim() || isSubmitting">{{ isSubmitting ? 'Recording…' : 'Record My Attendance' }}</button>
            <p v-if="error" class="small text-danger">{{ error }}</p>
          </form>
        </template>
      </section>
    </PublicShell>
  </PrivacyConsentGate>
</template>

<style scoped>
.center { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; padding: 20px 0; }
.banner { padding: 12px 14px; background: var(--accent-soft); border-radius: var(--radius-sm); gap: 4px; }
.banner p { margin: 0; }
.title { font-size: 16px; }
.row { display: flex; align-items: center; gap: 6px; }
.icon-input { position: relative; display: flex; align-items: center; }
.icon-input svg { position: absolute; left: 11px; color: var(--muted); }
.icon-input .input { padding-left: 36px; }
</style>
