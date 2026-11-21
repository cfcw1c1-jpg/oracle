<script setup>
import { Activity, BookOpen, CalendarDays, ChevronRight, GraduationCap, RefreshCw, Users } from 'lucide-vue-next';
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import DonutChart from '@/components/DonutChart.vue';
import LoadingBlock from '@/components/LoadingBlock.vue';
import ServicesGrid from '@/components/ServicesGrid.vue';
import StatCard from '@/components/StatCard.vue';
import { fetchAllRows, isActiveStatus } from '@/lib/data';
import { computeTrackStat, FORMATION_STAGES, getRoleLabel, normalizeRole, PFO_TRAINING_SELECT, scopedTracks } from '@/lib/formation';
import { supabase } from '@/lib/supabase';
import { sessionState } from '@/stores/session';

defineProps({ roleName: { type: String, default: null } });

const PASTORAL_ROLE_ORDER = ['CL', 'UL', 'UH', 'HH', 'CH', 'FMHHL', 'HHL', 'FMHH'];
const PASTORAL_COLORS = { CL: '#2a78d6', UL: '#eb6834', UH: '#1baf7a', HH: '#eda100', CH: '#e87ba4', FMHHL: '#008300', HHL: '#4a3aa7', FMHH: '#e34948', MEMBER: '#94a3b8' };
const EVANGELIZO_BASE = 'https://feed.evangelizo.org/v2/reader.php';

const router = useRouter();
const isLoading = ref(true);
const now = ref(new Date());
const members = ref([]);
const pfoRows = ref([]);
const clpTrainings = ref([]);
const gospel = reactive({ loading: true, error: null, liturgicalDay: '', citation: '', text: '', attribution: '', sourceUrl: '' });

const user = computed(() => sessionState.session?.user);
const email = computed(() => user.value?.email || 'Portal Administrator');

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function formatShortDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const timeOfDay = computed(() => {
  const hour = now.value.getHours();
  return hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
});
const weekday = computed(() => now.value.toLocaleDateString('en-US', { weekday: 'long' }));
const dateTimeLabel = computed(() => now.value.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }));

const activeMembers = computed(() => members.value.filter((member) => isActiveStatus(member.Status)));
const totalMembers = computed(() => activeMembers.value.length);
const activePfoRows = computed(() => pfoRows.value.filter((row) => isActiveStatus(row.members?.Status)));

function donutCenter(segments) {
  const total = segments.reduce((sum, segment) => sum + segment.count, 0);
  if (!total) return { centerValue: '—', centerLabel: 'NO DATA' };
  const dominant = segments.reduce((a, b) => (b.count > a.count ? b : a));
  return { centerValue: `${Math.round((dominant.count / total) * 100)}%`, centerLabel: dominant.label.toUpperCase() };
}

// Every member by status; a blank status counts as Active, as in the Directory.
const STATUS_COLORS = { Active: '#16a34a', Inactive: '#94a3b8', Deceased: '#475569', SOLD: '#d97706', HANDMAID: '#7c3aed' };
const statusSegments = computed(() => {
  const counts = new Map();
  members.value.forEach((member) => {
    const status = member.Status || 'Active';
    counts.set(status, (counts.get(status) ?? 0) + 1);
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count, color: STATUS_COLORS[label] ?? '#e2e8f0' }));
});

const pastoralSegments = computed(() => {
  const counts = Object.fromEntries([...PASTORAL_ROLE_ORDER, 'MEMBER'].map((code) => [code, 0]));
  activeMembers.value.forEach((member) => {
    const role = normalizeRole(member.PastoralService);
    counts[role in counts ? role : 'MEMBER'] += 1;
  });
  return Object.keys(counts)
    .map((code) => ({ label: getRoleLabel(code), count: counts[code], color: PASTORAL_COLORS[code] }))
    .filter((segment) => segment.count > 0)
    .sort((a, b) => a.label.localeCompare(b.label));
});

function trackedPercents(stage) {
  return scopedTracks(stage).map((track) => computeTrackStat(track, activePfoRows.value, activeMembers.value)).filter((stat) => stat.tracked).map((stat) => stat.percent);
}
const stageProgress = computed(() => FORMATION_STAGES.map((stage) => ({ ...stage, avgPercent: average(trackedPercents(stage)) })));
const overallPfoAvg = computed(() => average(FORMATION_STAGES.flatMap(trackedPercents)));

const trainingList = computed(() => {
  const today = now.value.toISOString().slice(0, 10);
  const upcoming = clpTrainings.value.filter((training) => training.start_date && training.start_date >= today).sort((a, b) => a.start_date.localeCompare(b.start_date));
  return upcoming.length ? { rows: upcoming.slice(0, 4), upcoming: true } : { rows: clpTrainings.value.slice(0, 4), upcoming: false };
});

async function loadDashboard() {
  isLoading.value = true;
  try {
    const [memberRows, pfoData, clpResult] = await Promise.all([
      fetchAllRows('members', 'Status, PastoralService, MemberIDNo, YearRegistered', { orderBy: 'MemberIDNo' }),
      fetchAllRows('pfo_members', `${PFO_TRAINING_SELECT}, members (Status, PastoralService, YearRegistered)`, { orderBy: 'MemberIDNo' }),
      supabase.from('clp_trainings').select('id, start_date, end_date, venue').order('start_date', { ascending: false }),
    ]);
    if (clpResult.error) throw clpResult.error;
    members.value = memberRows;
    pfoRows.value = pfoData;
    clpTrainings.value = clpResult.data || [];
  } catch (error) {
    console.error('Error loading dashboard:', error.message);
  } finally {
    isLoading.value = false;
  }
}

function cleanFeedText(raw) {
  return (raw || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function parseGospel(raw) {
  const lines = cleanFeedText(raw).split('\n').map((line) => line.trim());
  const end = lines.findIndex((line) => /^copyright/i.test(line));
  return { body: (end === -1 ? lines : lines.slice(0, end)).filter(Boolean).join(' '), attribution: end === -1 ? '' : lines[end] };
}

async function fetchFeed(dateText, type, content) {
  const params = new URLSearchParams({ date: dateText, type, lang: 'AM' });
  if (content) params.set('content', content);
  const response = await fetch(`${EVANGELIZO_BASE}?${params}`);
  if (!response.ok) throw new Error(`Evangelizo request failed (${response.status})`);
  return response.text();
}

// English reading straight from Evangelizo, used when the Tagalog one fails.
async function loadEnglishGospel(dateText) {
  const [liturgic, citation, reading] = await Promise.all([fetchFeed(dateText, 'liturgic_t'), fetchFeed(dateText, 'reading_st', 'GSP'), fetchFeed(dateText, 'reading', 'GSP')]);
  const { body, attribution } = parseGospel(reading);
  return { liturgicalDay: cleanFeedText(liturgic).trim(), citation: cleanFeedText(citation).replace(/\s+/g, ' ').trim(), text: body, attribution, sourceUrl: '' };
}

// Tagalog (Magandang Balita Biblia) through /api/gospel; English if that fails.
async function loadGospel() {
  const today = new Date();
  const dateText = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  try {
    let reading;
    try {
      const response = await fetch(`/api/gospel?date=${dateText}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.text) throw new Error(body.error || `Gospel request failed (${response.status})`);
      reading = body;
    } catch (error) {
      console.warn('Tagalog Gospel unavailable, showing English:', error.message);
      reading = await loadEnglishGospel(dateText);
    }
    Object.assign(gospel, { loading: false, ...reading });
  } catch (error) {
    console.error('Error loading Gospel of the Day:', error.message);
    Object.assign(gospel, { loading: false, error: "Unable to load today's Gospel reading." });
  }
}

let clockTimer;
onMounted(() => {
  loadDashboard();
  loadGospel();
  clockTimer = setInterval(() => {
    now.value = new Date();
  }, 60000);
});
onBeforeUnmount(() => clearInterval(clockTimer));
</script>

<template>
  <LoadingBlock v-if="isLoading" variant="page" :rows="4" />
  <div v-else class="page">
    <section class="hero">
      <div class="grow">
        <span class="hero-date"><CalendarDays :size="12" />{{ dateTimeLabel }}</span>
        <h1 class="hero-title">Good {{ timeOfDay }}!</h1>
        <p class="hero-sub">Welcome back — signed in as {{ email }}. Have a great {{ weekday }}!</p>
      </div>
      <button class="icon-btn hero-refresh" aria-label="Refresh" @click="loadDashboard"><RefreshCw :size="17" /></button>
      <span class="hero-mark"><img src="/oracle-logo.png" alt="" /></span>
    </section>

    <ServicesGrid />

    <article class="card gospel-card" aria-labelledby="gospel-title">
      <header class="gospel-head">
        <span class="gospel-icon"><BookOpen :size="18" /></span>
        <div class="grow">
          <h2 id="gospel-title" class="card-title">Gospel of the Day</h2>
          <p v-if="!gospel.loading && !gospel.error && gospel.liturgicalDay" class="muted small">{{ gospel.liturgicalDay }}</p>
        </div>
        <span v-if="!gospel.loading && !gospel.error && gospel.citation" class="pill accent gospel-cite">{{ gospel.citation }}</span>
      </header>
      <LoadingBlock v-if="gospel.loading" variant="text" :rows="4" />
      <p v-else-if="gospel.error" class="muted small">{{ gospel.error }}</p>
      <template v-else>
        <p class="gospel">{{ gospel.text }}</p>
        <p v-if="gospel.attribution" class="muted tiny">
          {{ gospel.attribution }}
          <a v-if="gospel.sourceUrl" :href="gospel.sourceUrl" target="_blank" rel="noopener">Mula sa Bible Gateway</a>
        </p>
      </template>
    </article>


    <section class="grid dash-stats">
      <StatCard label="Total Active Members" :value="totalMembers" :icon="Users" />
      <StatCard label="CLP Training Batches" :value="clpTrainings.length" :icon="GraduationCap" />
      <StatCard label="PFO Avg. Completion" :value="`${overallPfoAvg.toFixed(1)}%`" :icon="Activity" />
    </section>

    <section class="grid grid-2">
      <article class="card card-pad">
        <h2 class="card-title mb">Member Status Overview</h2>
        <DonutChart :segments="statusSegments" v-bind="donutCenter(statusSegments)" />
      </article>

      <article class="card card-pad stack">
        <h2 class="card-title">Formation Stage Progress</h2>
        <div v-for="stage in stageProgress" :key="stage.key" class="progress" :style="{ '--stage': stage.color }">
          <div class="row row-between"><span>{{ stage.label }}</span><strong class="progress-num">{{ stage.avgPercent.toFixed(0) }}%</strong></div>
          <div class="bar"><span class="bar-fill" :style="{ width: `${Math.min(stage.avgPercent, 100)}%` }" /></div>
        </div>
        <button class="btn btn-primary view-report" @click="router.push('/pfoStats')">View Full Report <ChevronRight :size="14" /></button>
      </article>

      <article class="card card-pad">
        <h2 class="card-title mb">Pastoral Service Breakdown</h2>
        <DonutChart :segments="pastoralSegments" v-bind="donutCenter(pastoralSegments)" />
        <p v-if="!pastoralSegments.length" class="muted small">No active members yet.</p>
      </article>

      <article class="card card-pad stack">
        <h2 class="card-title">{{ trainingList.upcoming ? 'Upcoming CLP Trainings' : 'Previous CLP Trainings' }}</h2>
        <p v-if="!trainingList.rows.length" class="muted small">No training batches scheduled yet.</p>
        <div v-for="training in trainingList.rows" :key="training.id" class="agenda">
          <span class="agenda-dot" />
          <div class="grow">
            <p class="strong clamp">{{ training.venue }}</p>
            <p class="muted small">{{ formatShortDate(training.start_date) }} – {{ formatShortDate(training.end_date) }}</p>
          </div>
        </div>
      </article>
    </section>
  </div>
</template>

<style scoped>
.hero { display: flex; align-items: center; gap: 14px; background: var(--accent-soft); border-radius: var(--radius-lg); padding: 24px; }
.hero-date { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--ink-2); }
.hero-title { font-size: 24px; font-weight: var(--fw-medium); letter-spacing: -0.02em; margin-top: 8px; }
.hero-sub { color: var(--ink-2); font-size: 13px; margin-top: 3px; }
.hero-mark { width: 52px; height: 52px; border-radius: 14px; background: var(--primary); flex: none; display: flex; align-items: center; justify-content: center; }
.hero-mark img { width: 31px; height: 27px; object-fit: contain; }
.dash-stats { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.mb { margin-bottom: 14px; }
.progress { font-size: 13px; color: var(--ink-2); }
.progress-num { color: var(--ink); }
.bar { height: 7px; border-radius: 4px; background: var(--surface-soft); margin-top: 6px; overflow: hidden; }
.bar-fill { display: block; height: 100%; border-radius: 4px; background: var(--accent); }
.view-report { align-self: flex-start; margin-top: 4px; }
.gospel-card { padding: 20px 22px; display: flex; flex-direction: column; gap: 12px; border-left: 4px solid var(--primary); }
.gospel-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.gospel-icon { width: 38px; height: 38px; border-radius: 12px; flex: none; display: grid; place-items: center; background: var(--accent-soft); color: var(--primary); }
.gospel-cite { white-space: normal; text-align: center; }
.gospel { font-size: 14px; line-height: 1.7; color: var(--ink-2); white-space: pre-line; }
.agenda { display: flex; align-items: flex-start; gap: 11px; }
.agenda-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); margin-top: 6px; flex: none; }

/* Phones keep the navy hero and coloured stage bars. */
@media (max-width: 767.98px) {
  .hero { background: linear-gradient(135deg, #002060, #001540); color: #fff; }
  .hero-date, .hero-sub { color: rgba(255, 255, 255, 0.82); }
  .hero-refresh { color: #fff; }
  .hero-mark { background: rgba(255, 255, 255, 0.12); }
  .gospel-card { padding: 16px; }
  .gospel-cite { order: 3; }
  .dash-stats { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .bar-fill { background: var(--stage); }
  .progress-num { color: var(--stage); }
  .dash-stats :deep(.stat) { padding: 12px; }
  .dash-stats :deep(.stat-value) { font-size: 20px; }
  /* Three narrow cards: the icon goes above the label so the label has the full width. */
  .dash-stats :deep(.stat > .row) { flex-direction: column-reverse; align-items: flex-start; gap: 8px; }
  .dash-stats :deep(.stat-label) { font-size: 11.5px; line-height: 1.3; }
  .dash-stats :deep(.icon-chip) { width: 28px; height: 28px; border-radius: 9px; }
}
</style>
