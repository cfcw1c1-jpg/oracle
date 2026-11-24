<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { FAILURE_MESSAGES, fetchOgdChapters, keepOgdSessionsAlive } from '@/lib/ogdApi';
import { sessionState } from '@/stores/session';

// Header lights for the caller's chapters: green (blinking) when the last OGD
// sign-in worked, red when it did not or the login is missing. Gmail is only
// proven by the Members Portal's emailed code, so it turns red when the saved Gmail is
// missing or the last sign-in could not read it.
const emit = defineEmits(['open']);
const REFRESH_MS = 60 * 1000;
// OGD ends idle sessions, so the saved one is touched this often while Oracle
// is open (hidden tabs included). Syncs then reuse it with no login or OTP.
const KEEP_ALIVE_MS = 4 * 60 * 1000;
const GMAIL_FAILURES = new Set(['gmail_bad_password', 'gmail_connection_error', 'otp_not_found']);

const chapters = ref(null);
let timer = null;
let keepAliveTimer = null;

async function keepAlive() {
  if (sessionState.ogdSignInPending) return;
  try {
    await keepOgdSessionsAlive();
  } catch {
    // The next tick tries again.
  }
}

async function load() {
  if (document.visibilityState === 'hidden') return;
  try {
    chapters.value = await fetchOgdChapters('accounts');
  } catch {
    // Keeps the last known lights; the next refresh tries again.
  }
}

// Chapters with anything saved; if none has, every chapter shows as not set up.
const relevant = computed(() => {
  const list = chapters.value ?? [];
  const configured = list.filter((chapter) => chapter.ownConfigured || chapter.otherConfigured);
  return configured.length ? configured : list;
});

function gmailProblem(chapter) {
  if (!chapter.otherConfigured) return 'No Gmail saved';
  if (chapter.status === 'failed' && GMAIL_FAILURES.has(chapter.failureCode)) return FAILURE_MESSAGES[chapter.failureCode];
  return null;
}

function ogdProblem(chapter) {
  if (!chapter.ownConfigured) return 'No Members Portal login saved';
  if (chapter.status === 'connected') return null;
  if (chapter.status === 'running') return 'Signing in…';
  if (chapter.status === 'failed') return FAILURE_MESSAGES[chapter.failureCode] ?? chapter.statusDetail ?? 'Last sign-in failed';
  return 'Not signed in yet';
}

function light(problemOf) {
  const problems = relevant.value.map((chapter) => ({ chapter: chapter.chapter, problem: problemOf(chapter) })).filter((item) => item.problem);
  const isRunning = relevant.value.some((chapter) => chapter.status === 'running');
  return {
    state: problems.length ? (isRunning && problemOf === ogdProblem ? 'pending' : 'off') : 'on',
    detail: problems.length ? problems.map((item) => `${item.chapter}: ${item.problem}`).join('\n') : 'Connected',
  };
}

const gmail = computed(() => light(gmailProblem));
const ogd = computed(() => light(ogdProblem));

onMounted(() => {
  load();
  timer = setInterval(load, REFRESH_MS);
  keepAliveTimer = setInterval(keepAlive, KEEP_ALIVE_MS);
  document.addEventListener('visibilitychange', load);
});
onBeforeUnmount(() => {
  clearInterval(timer);
  clearInterval(keepAliveTimer);
  document.removeEventListener('visibilitychange', load);
});
// Re-reads once the sign-in screen has finished.
watch(() => sessionState.ogdSignInPending, (pending) => {
  if (!pending) load();
});
</script>

<template>
  <button v-if="relevant.length" class="ogd-status" type="button" aria-label="OGD connection status. Open OGD Accounts" @click="emit('open')">
    <span class="ogd-light" :title="`Google Mail — ${gmail.detail}`">
      <span class="ogd-dot" :class="gmail.state" />Gmail
    </span>
    <span class="ogd-light" :title="`OGD — ${ogd.detail}`">
      <span class="ogd-dot" :class="ogd.state" />OGD
    </span>
  </button>
</template>

<style scoped>
.ogd-status { display: inline-flex; align-items: center; gap: 12px; border: 1px solid var(--line); background: var(--surface); border-radius: 999px; padding: 6px 12px; font-size: 12px; font-weight: var(--fw-medium); color: var(--ink-2); white-space: nowrap; }
.ogd-status:hover { background: var(--surface-soft); }
.ogd-light { display: inline-flex; align-items: center; gap: 6px; }
.ogd-dot { position: relative; width: 9px; height: 9px; border-radius: 50%; background: #dc2626; }
.ogd-dot.on { background: #16a34a; animation: ogd-blink 1.6s ease-in-out infinite; }
.ogd-dot.on::after { content: ''; position: absolute; inset: -3px; border-radius: 50%; border: 2px solid #16a34a; opacity: 0; animation: ogd-ping 1.6s ease-out infinite; }
.ogd-dot.pending { background: #d97706; animation: ogd-blink 0.8s ease-in-out infinite; }
@keyframes ogd-blink { 50% { opacity: 0.35; } }
@keyframes ogd-ping { 0% { transform: scale(0.6); opacity: 0.7; } 100% { transform: scale(1.6); opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .ogd-dot.on, .ogd-dot.pending, .ogd-dot.on::after { animation: none; }
}
@media (max-width: 767.98px) {
  .ogd-status { gap: 8px; padding: 4px 9px; font-size: 11px; background: rgba(255, 255, 255, 0.1); border-color: rgba(255, 255, 255, 0.25); color: #fff; }
  .ogd-status:hover { background: rgba(255, 255, 255, 0.16); }
}
</style>
