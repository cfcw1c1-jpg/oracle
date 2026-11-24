<script setup>
import { CircleCheck, CircleAlert } from 'lucide-vue-next';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { FAILURE_MESSAGES, fetchOgdChapters, runOgdTestLogin } from '@/lib/ogdApi';
import { sessionState } from '@/stores/session';

// Shown right after an MSG or Chapter Head signs in. Every chapter with both
// its Members Portal login and its Gmail saved is signed in to OGD; a user with none of
// them configured goes straight into the app.
//
// The server answers each sign-in in one response, so the bar follows the
// usual timing of each step and only reaches 100% when OGD has answered.
const STAGES = [
  { at: 0, label: 'Opening the Members Portal' },
  { at: 5000, label: 'Entering the Members Portal login' },
  { at: 12000, label: 'Waiting for the OTP email' },
  { at: 35000, label: 'Opening One Global Data' },
];
// Elapsed time at which the estimate is about two-thirds of the way.
const EXPECTED_MS = 30000;
const AUTO_CONTINUE_MS = 1200;

const phase = ref('checking');
const runs = ref([]);
const now = ref(Date.now());
let ticker = null;
let continueTimer = null;
let isMounted = true;

function finish() {
  sessionState.ogdSignInPending = false;
}

function estimate(run) {
  if (run.result) return 100;
  const elapsed = now.value - run.startedAt;
  return Math.min(95, Math.round(95 * (1 - Math.exp(-elapsed / EXPECTED_MS))));
}

function stageLabel(run) {
  if (run.result === 'connected') return 'Signed in to OGD';
  if (run.result === 'skipped') return run.message;
  if (run.result === 'failed') return run.message;
  const elapsed = now.value - run.startedAt;
  return [...STAGES].reverse().find((stage) => elapsed >= stage.at).label;
}

const overall = computed(() => (runs.value.length ? Math.round(runs.value.reduce((sum, run) => sum + estimate(run), 0) / runs.value.length) : 0));
const hasFailure = computed(() => runs.value.some((run) => run.result === 'failed'));

function settle(areaId, result, message = '') {
  runs.value = runs.value.map((run) => (run.areaId === areaId ? { ...run, result, message } : run));
}

async function signIn(run) {
  try {
    const result = await runOgdTestLogin({ scope: 'accounts', areaId: run.areaId });
    if (result.status === 'connected') settle(run.areaId, 'connected');
    else settle(run.areaId, 'failed', FAILURE_MESSAGES[result.failureCode] ?? result.statusDetail ?? 'OGD sign-in failed.');
  } catch (error) {
    // 429: this chapter was signed in moments ago, so it needs no new attempt.
    if (error.status === 429) settle(run.areaId, 'skipped', 'Signed in to OGD moments ago');
    else settle(run.areaId, 'failed', error.message);
  }
}

async function start() {
  let chapters;
  try {
    chapters = await fetchOgdChapters('accounts');
  } catch {
    finish();
    return;
  }
  const configured = chapters.filter((chapter) => chapter.ownConfigured && chapter.otherConfigured);
  if (!configured.length) {
    finish();
    return;
  }

  const startedAt = Date.now();
  runs.value = configured.map((chapter) => ({ areaId: chapter.areaId, chapter: chapter.chapter, startedAt, result: null, message: '' }));
  phase.value = 'signing-in';
  ticker = setInterval(() => {
    now.value = Date.now();
  }, 250);

  await Promise.all(runs.value.map(signIn));
  if (!isMounted) return;
  clearInterval(ticker);
  now.value = Date.now();
  phase.value = 'done';
  if (!hasFailure.value) continueTimer = setTimeout(finish, AUTO_CONTINUE_MS);
}

onMounted(start);
onBeforeUnmount(() => {
  isMounted = false;
  clearInterval(ticker);
  clearTimeout(continueTimer);
});
</script>

<template>
  <main class="ogd-signin">
    <div class="ogd-card" role="status" aria-live="polite">
      <span class="ogd-mark"><img src="/oracle-logo.png" alt="" /></span>

      <template v-if="phase === 'checking'">
        <h1 class="ogd-title">Signing you in</h1>
        <p class="ogd-sub">Checking your chapters' OGD accounts…</p>
        <div class="ogd-track indeterminate"><span class="ogd-fill" /></div>
      </template>

      <template v-else>
        <h1 class="ogd-title">{{ phase === 'done' ? (hasFailure ? 'OGD sign-in finished' : 'Signed in to OGD') : 'Signing in to OGD' }}</h1>
        <p class="ogd-sub">
          {{ phase === 'done' ? (hasFailure ? 'Some chapters could not sign in. You can try again from OGD Accounts.' : 'Opening Oracle…') : 'This usually takes under a minute while the Members Portal emails its code.' }}
        </p>

        <div class="ogd-overall">
          <div class="ogd-track" role="progressbar" aria-label="OGD sign-in progress" :aria-valuenow="overall" aria-valuemin="0" aria-valuemax="100">
            <span class="ogd-fill" :class="{ shimmer: phase !== 'done' }" :style="{ width: `${overall}%` }" />
          </div>
          <span class="ogd-percent">{{ overall }}%</span>
        </div>

        <ul class="ogd-runs">
          <li v-for="run in runs" :key="run.areaId" class="ogd-run">
            <span class="ogd-icon">
              <CircleCheck v-if="run.result === 'connected' || run.result === 'skipped'" :size="18" class="text-success" />
              <CircleAlert v-else-if="run.result === 'failed'" :size="18" class="text-danger" />
              <span v-else class="spinner sm" />
            </span>
            <span class="ogd-run-text">
              <strong>{{ run.chapter }}</strong>
              <span :class="run.result === 'failed' ? 'text-danger' : 'muted'">{{ stageLabel(run) }}</span>
            </span>
          </li>
        </ul>
      </template>

      <button v-if="phase === 'done' && hasFailure" class="btn btn-primary btn-block" @click="finish">Continue to Oracle</button>
      <button v-else-if="phase !== 'done'" class="ogd-skip" @click="finish">Skip and continue</button>
    </div>
  </main>
</template>

<style>
.ogd-signin { min-height: 100%; display: flex; align-items: center; justify-content: center; padding: 24px 16px; background: var(--bg); }
.ogd-card { width: 100%; max-width: 440px; display: flex; flex-direction: column; align-items: center; gap: 14px; background: var(--surface); border: 1px solid var(--line); border-radius: 22px; box-shadow: var(--shadow-card); padding: 36px 28px; text-align: center; }
.ogd-mark { width: 64px; height: 64px; border-radius: 18px; background: var(--primary); display: flex; align-items: center; justify-content: center; }
.ogd-mark img { width: 36px; height: 32px; object-fit: contain; }
.ogd-title { font-size: 22px; font-weight: var(--fw-heading); }
.ogd-sub { font-size: 13px; color: var(--muted); max-width: 340px; }
.ogd-overall { width: 100%; display: flex; align-items: center; gap: 10px; margin-top: 4px; }
.ogd-track { position: relative; flex: 1; width: 100%; height: 8px; border-radius: 999px; background: var(--line); overflow: hidden; }
.ogd-fill { position: absolute; inset: 0 auto 0 0; width: 0; border-radius: inherit; background: var(--primary); transition: width 0.4s ease-out; overflow: hidden; }
.ogd-fill.shimmer::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.45), transparent); transform: translateX(-100%); animation: ogd-shimmer 1.4s ease-in-out infinite; }
.ogd-track.indeterminate .ogd-fill { width: 35%; animation: ogd-slide 1.2s ease-in-out infinite; }
.ogd-percent { min-width: 40px; text-align: right; font-size: 13px; font-weight: var(--fw-heading); font-variant-numeric: tabular-nums; }
.ogd-runs { width: 100%; list-style: none; padding: 0; margin: 4px 0 0; display: flex; flex-direction: column; gap: 8px; text-align: left; }
.ogd-run { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--radius-sm); }
.ogd-icon { width: 20px; display: flex; justify-content: center; flex: none; }
.ogd-run-text { display: flex; flex-direction: column; min-width: 0; font-size: 13px; }
.ogd-run-text strong { font-weight: var(--fw-heading); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ogd-skip { border: 0; background: none; padding: 0; font-size: 13px; color: var(--muted); text-decoration: underline; }
@keyframes ogd-shimmer { to { transform: translateX(100%); } }
@keyframes ogd-slide { from { transform: translateX(-100%); } to { transform: translateX(290%); } }
@media (prefers-reduced-motion: reduce) {
  .ogd-fill, .ogd-fill.shimmer::after, .ogd-track.indeterminate .ogd-fill { animation: none; transition: none; }
}
</style>
