<script setup>
import { ArrowRight, ChevronDown, ChevronUp, GraduationCap, Info, KeyRound, LogIn, RefreshCw, Square, Trash2, Undo2, UploadCloud } from 'lucide-vue-next';
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import AppModal from '@/components/AppModal.vue';
import DataTable from '@/components/DataTable.vue';
import LoadingBlock from '@/components/LoadingBlock.vue';
import PageHead from '@/components/PageHead.vue';
import PasswordField from '@/components/PasswordField.vue';
import SearchInput from '@/components/SearchInput.vue';
import { confirmAction, formatDateTime } from '@/lib/data';
import { TRAINING_COLUMNS } from '@/lib/formation';
import { FAILURE_MESSAGES, fetchOgdChanges, fetchOgdChapters, pushOgdChanges, runOgdTestLogin, saveOgdCredential, syncOgdMembers, updateOgdChanges } from '@/lib/ogdApi';

const props = defineProps({ scopes: { type: Array, required: true } });

const COPY = {
  accounts: {
    tab: 'OGD Login', subtitle: 'Set the One Global Data username and password for each chapter.', column: 'OGD Username',
    identifierLabel: 'OGD username', passwordLabel: 'OGD password', hint: 'Username used at cfcglobaldata.com', waiting: 'Waiting for Gmail', type: 'text', maxIdentifier: 50, maxPassword: 50, passwordHint: '',
  },
  sector: {
    tab: 'Gmail', subtitle: "Assign each chapter's Gmail account and check whether it can sign in to OGD.", column: 'Gmail',
    identifierLabel: 'Gmail address', passwordLabel: 'Gmail App Password', hint: 'chapter@gmail.com', waiting: 'Waiting for MSG', type: 'email', maxIdentifier: 254, maxPassword: 40, passwordHint: '16-character App Password',
  },
};
const STATUS = {
  connected: { label: 'Logged in', tone: 'success' }, running: { label: 'Logging in…', tone: 'info' },
  failed: { label: 'Failed', tone: 'danger' }, idle: { label: 'Not tested', tone: '' },
};
const SYNC_STATUS = {
  synced: { label: 'Synced', tone: 'success' }, partial: { label: 'Partly synced', tone: 'warning' },
  failed: { label: 'Sync failed', tone: 'danger' }, syncing: { label: 'Syncing…', tone: 'info' },
};
const GUIDE_STEPS = [
  { text: "Sign in to the chapter's Gmail account in your browser." },
  { text: 'Turn on 2-Step Verification for that account.', link: 'Open Google Account security', url: 'https://myaccount.google.com/security' },
  { text: 'Go to App Passwords, enter a name such as "OGD Portal", and create it.', link: 'Open App Passwords', url: 'https://myaccount.google.com/apppasswords' },
  { text: 'Copy the 16-character password Google shows. It is displayed only once.' },
  { text: 'In the table below, choose "Set up" on the chapter, then enter the Gmail address and the App Password. Do not use the normal Gmail password.' },
  { text: 'Once MSG has set the OGD Account for that chapter, choose "Test Login".' },
];
const GUIDE_NOTES = [
  'IMAP needs no setup. Gmail keeps it turned on, and this app uses it to read the OTP email.',
  "Changing the Gmail account's password cancels its App Passwords. Create a new one and save it here.",
  'App Passwords may not be available on work or school accounts, or on accounts using Advanced Protection or security keys only.',
];

const scope = ref(props.scopes[0]);
const copy = computed(() => COPY[scope.value]);
const rows = ref([]);
const loadState = reactive({ status: 'loading', message: '' });
const search = ref('');
const isGuideOpen = ref(true);
const editing = ref(null);
const form = reactive({ identifier: '', password: '', error: '', isSaving: false });
const testingIds = ref(new Set());
const syncingIds = ref(new Set());
const notice = ref('');

function setupLabel(row) {
  if (!row.ownConfigured) return 'Not set';
  return row.otherConfigured ? 'Ready' : copy.value.waiting;
}

const columns = computed(() => [
  { key: 'sector', label: 'Sector' },
  { key: 'chapter', label: 'Chapter' },
  { key: 'identifier', label: copy.value.column },
  { key: 'setup', label: 'Setup', value: setupLabel },
  { key: 'status', label: 'OGD Status', value: (row) => STATUS[row.status].label },
  { key: 'lastAttemptAt', label: 'Last Attempt' },
  { key: 'memberSync', label: 'Last Sync', value: (row) => row.memberSync?.syncedAt ?? '' },
  { key: 'actions', label: 'Actions', action: true },
]);

const visibleRows = computed(() => {
  const query = search.value.trim().toLowerCase();
  return query ? rows.value.filter((row) => [row.sector, row.cluster, row.chapter, row.identifier].some((value) => value?.toLowerCase().includes(query))) : rows.value;
});

let loadToken = 0;
async function load() {
  const token = ++loadToken;
  try {
    const chapters = await fetchOgdChapters(scope.value);
    if (token !== loadToken) return;
    rows.value = chapters;
    applyBackgroundState(chapters);
    chapters.forEach(trackEta);
    Object.assign(loadState, { status: 'success', message: '' });
  } catch (error) {
    if (token === loadToken) Object.assign(loadState, { status: 'error', message: error.message });
  }
}

watch(scope, () => {
  Object.assign(loadState, { status: 'loading', message: '' });
  rows.value = [];
  load();
});

function openEdit(row) {
  editing.value = row;
  Object.assign(form, { identifier: row.identifier ?? '', password: '', error: '', isSaving: false });
}

async function saveCredential() {
  if (!form.identifier.trim() || !form.password) {
    form.error = 'Please fill in both fields.';
    return;
  }
  form.isSaving = true;
  form.error = '';
  try {
    await saveOgdCredential({ scope: scope.value, areaId: editing.value.areaId, identifier: form.identifier, password: form.password });
    editing.value = null;
    load();
  } catch (error) {
    form.error = error.message;
  } finally {
    form.isSaving = false;
  }
}

function setTesting(areaId, isTesting) {
  const next = new Set(testingIds.value);
  if (isTesting) next.add(areaId);
  else next.delete(areaId);
  testingIds.value = next;
}

async function testLogin(row) {
  notice.value = '';
  setTesting(row.areaId, true);
  rows.value = rows.value.map((item) => (item.areaId === row.areaId ? { ...item, status: 'running', failureCode: null, statusDetail: null } : item));
  try {
    await runOgdTestLogin({ scope: scope.value, areaId: row.areaId });
  } catch (error) {
    notice.value = `${row.chapter}: ${error.message}`;
  } finally {
    setTesting(row.areaId, false);
    load();
  }
}

// Syncs run on the server in the background: Sync Members or Sync Formations
// only starts one, the server keeps starting its next run until it is done,
// and this page reads the progress it saves. Closing the page does not stop
// it; Stop ends it after the current run.
// The server writes progress every few seconds; this re-reads it while a sync runs.
const PROGRESS_POLL_MS = 4000;
const syncRuns = ref({});
const syncingParts = ref({});
const syncWaiting = ref({});
const startingIds = ref(new Set());
const stoppingIds = ref(new Set());
let isMounted = true;
let pollTimer = null;

function updatePolling() {
  if (syncingIds.value.size && !pollTimer) pollTimer = setInterval(load, PROGRESS_POLL_MS);
  if (!syncingIds.value.size && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function isBackgroundActive(row) {
  const background = row.memberSync?.background;
  return Boolean(background && !background.stalled);
}

// Rebuilds which chapters are syncing from what the server reports.
function applyBackgroundState(chapters) {
  const active = chapters.filter(isBackgroundActive);
  const next = new Set([...active.map((row) => row.areaId), ...startingIds.value]);
  syncingIds.value.forEach((areaId) => {
    if (!next.has(areaId)) resetEta(areaId);
  });
  syncingIds.value = next;
  syncRuns.value = Object.fromEntries(active.map((row) => [row.areaId, row.memberSync.background.run]));
  syncingParts.value = Object.fromEntries(active.map((row) => [row.areaId, row.memberSync.background.part]));
  syncWaiting.value = Object.fromEntries(active.filter((row) => row.memberSync.progress?.stage === 'retry_wait').map((row) => [row.areaId, true]));
  stoppingIds.value = new Set(active.filter((row) => row.memberSync.background.state === 'stopping').map((row) => row.areaId));
  updatePolling();
}

function setStarting(areaId, isStarting) {
  const next = new Set(startingIds.value);
  if (isStarting) next.add(areaId);
  else next.delete(areaId);
  startingIds.value = next;
}

// part: 'info' (Members list and household heads) or 'formations'. Each is
// started on its own and resumes from its own page.
async function syncMembers(row, part) {
  notice.value = '';
  resetEta(row.areaId);
  setStarting(row.areaId, true);
  syncingParts.value = { ...syncingParts.value, [row.areaId]: part };
  setSyncing(row.areaId, true);
  try {
    await syncOgdMembers({ scope: scope.value, areaId: row.areaId, part });
  } catch (error) {
    notice.value = `${row.chapter}: ${error.message}`;
  } finally {
    setStarting(row.areaId, false);
    if (isMounted) await load();
  }
}

async function stopSync(row) {
  stoppingIds.value = new Set([...stoppingIds.value, row.areaId]);
  try {
    await syncOgdMembers({ scope: scope.value, areaId: row.areaId, action: 'stop' });
  } catch (error) {
    notice.value = `${row.chapter}: ${error.message}`;
  } finally {
    if (isMounted) load();
  }
}

// ---------- Time left ----------
// Measured from the progress the server writes while a sync runs: how long
// reading takes per member, how long each run reads before it stops for the
// time limit, and the gap between runs (saving, signing in, the OTP email and
// paging back to where it stopped). Until there is enough to go on, the
// defaults below fill in.
const DEFAULT_GAP_MS = 75 * 1000;
const DEFAULT_READ_PER_RUN_MS = 150 * 1000;
const MIN_SAMPLE_MS = 20 * 1000;
const MIN_SAMPLE_MEMBERS = 3;
const etaStats = new Map();
const etaText = ref({});

function resetEta(areaId) {
  etaStats.delete(areaId);
  const { [areaId]: _, ...rest } = etaText.value;
  etaText.value = rest;
}

const average = (list, fallback) => (list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : fallback);

function formatTimeLeft(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'less than a minute left';
  if (minutes < 60) return `about ${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `about ${hours} h${rest ? ` ${rest} min` : ''} left`;
}

function estimateTimeLeft(stats, progress) {
  if (stats.readDone < MIN_SAMPLE_MEMBERS || stats.readMs < MIN_SAMPLE_MS || !progress.total) return '';
  const remaining = Math.max(0, progress.total - (progress.done ?? 0));
  if (!remaining) return 'almost done';
  const readLeft = remaining * (stats.readMs / stats.readDone);
  const readPerRun = Math.max(60000, average(stats.runReadMs, DEFAULT_READ_PER_RUN_MS));
  const leftInThisRun = stats.runStartAt ? Math.max(0, readPerRun - (stats.last.at - stats.runStartAt)) : 0;
  const moreRuns = Math.max(0, Math.ceil((readLeft - leftInThisRun) / readPerRun));
  return formatTimeLeft(readLeft + moreRuns * average(stats.gapMs, DEFAULT_GAP_MS));
}

// Called with every fresh copy of the chapter rows (polled while syncing).
function trackEta(row) {
  const progress = row.memberSync?.progress;
  if (!syncingIds.value.has(row.areaId) || !progress?.at) return;
  const at = Date.parse(progress.at);
  const run = syncRuns.value[row.areaId];
  let stats = etaStats.get(row.areaId);
  if (!stats || stats.part !== progress.part) {
    stats = { part: progress.part, readMs: 0, readDone: 0, gapMs: [], runReadMs: [], runStartAt: null, lastReadAt: null, last: null };
    etaStats.set(row.areaId, stats);
  }
  const last = stats.last;
  if (last && at <= last.at) return;

  if (progress.stage === 'reading') {
    if (last?.stage === 'reading' && last.run === run) {
      const members = (progress.done ?? 0) - last.done;
      if (members >= 0) {
        stats.readDone += members;
        stats.readMs += at - last.at;
      }
    } else {
      // First reading sample of a run: the time since the last run stopped
      // reading is the gap between runs.
      if (stats.lastReadAt) stats.gapMs.push(at - stats.lastReadAt);
      stats.runStartAt = at;
    }
  } else if (last?.stage === 'reading') {
    stats.lastReadAt = last.at;
    if (stats.runStartAt) stats.runReadMs.push(last.at - stats.runStartAt);
    stats.runStartAt = null;
  }
  stats.last = { at, done: progress.done ?? 0, stage: progress.stage, run };
  etaText.value = { ...etaText.value, [row.areaId]: estimateTimeLeft(stats, progress) };
}

function timeLeftLabel(row) {
  const text = etaText.value[row.areaId];
  if (!text) return syncingIds.value.has(row.areaId) ? 'Working out the time left…' : '';
  return `${text[0].toUpperCase()}${text.slice(1)} for ${SYNC_PARTS[currentPart(row)]}.`;
}

function setSyncing(areaId, isSyncing) {
  const next = new Set(syncingIds.value);
  if (isSyncing) next.add(areaId);
  else next.delete(areaId);
  syncingIds.value = next;
  updatePolling();
}

const STAGE_LABELS = {
  queued: 'Starting the next run…', signing_in: 'Signing in to OGD…', reading: 'Reading members', saving: 'Saving to Oracle…',
  skipping: 'Going back to where it stopped', retry_wait: 'Sign-in failed, trying again in about a minute…',
};
// Members (list + household heads) and Formations sync separately.
const SYNC_PARTS = { info: 'Members', formations: 'Formations' };

function currentPart(row) {
  return syncingParts.value[row.areaId] ?? row.memberSync?.progress?.part ?? row.memberSync?.part ?? 'info';
}

// "Members continues from page 4" for each sync that stopped part-way.
function resumeNotes(sync) {
  return [['info', sync.infoNextPage], ['formations', sync.formationsNextPage]]
    .filter(([, page]) => page > 1)
    .map(([part, page]) => `${SYNC_PARTS[part]} continues from page ${page}.`);
}

// Percent for the bar, or null while the total is unknown (indeterminate bar).
// Signing in and saving sit at the ends so the bar never jumps backwards.
function progressPercent(progress) {
  if (!progress?.total) return null;
  if (progress.stage === 'saving') return 100;
  return Math.min(99, Math.round(((progress.done ?? 0) / progress.total) * 100));
}

function progressLabel(row) {
  const progress = row.memberSync?.progress;
  const run = syncRuns.value[row.areaId];
  const runText = run > 1 ? ` · run ${run}` : '';
  if (stoppingIds.value.has(row.areaId)) return `Stopping after this run…${runText}`;
  if (syncWaiting.value[row.areaId]) return `${STAGE_LABELS.retry_wait}${runText}`;
  if (!progress) return `Starting…${runText}`;
  if (progress.stage === 'skipping') return `${STAGE_LABELS.skipping} · page ${progress.page ?? '…'}${runText}`;
  if (progress.stage !== 'reading') return `${STAGE_LABELS[progress.stage] ?? 'Working…'}${runText}`;
  const count = progress.total ? `${Math.min(progress.done ?? 0, progress.total)} of ~${progress.total}` : `${progress.done ?? 0}`;
  const reading = progress.part === 'formations' ? 'Reading formations' : STAGE_LABELS.reading;
  return `${reading} ${count}${progress.page ? ` · page ${progress.page}` : ''}${runText}`;
}

// ---------- Changes waiting for OGD ----------
// Member edits saved in Oracle wait here until MSG or the Chapter Head pushes
// them. Discard drops a change (Oracle keeps it); Revert also restores the
// old value in Oracle.

const FIELD_LABELS = {
  Lastname: 'Last name', Firstname: 'First name', Status: 'Status', SpouseName: 'Spouse',
  Phone: 'Phone', MobileNo: 'Mobile #', Email: 'Email', PastoralService: 'Pastoral service', AreaName: 'Area',
  NameOfHouseholdHead: 'Household head', YearRegistered: 'Year registered',
};
// Talks ticked in PFO Trainings or Assign to Talks are queued by their
// training column; they show as "CLPT 2 talk" and Ticked / Not ticked.
const TRAINING_LABELS = new Map(TRAINING_COLUMNS.map((column) => [column.id, `${column.label} talk`]));
const isTraining = (field) => /^.+?_\d+-/.test(field);
const fieldLabel = (field) => FIELD_LABELS[field] ?? TRAINING_LABELS.get(field) ?? field;
const changeValue = (change, value) => (isTraining(change.field) ? (value === 'Y' ? 'Ticked' : 'Not ticked') : value || 'blank');
const CHANGE_STATUS = { pending: { label: 'Waiting', tone: 'info' }, failed: { label: 'Not pushed', tone: 'danger' } };
const MAX_PUSH_RUNS = 20;

const changes = ref([]);
const changesState = reactive({ status: 'idle', message: '' });
const selectedChanges = ref(new Set());
const busyChanges = ref(false);
const pushingIds = ref(new Set());
const pushNotice = ref('');

const changeColumns = [
  { key: 'select', label: '', action: true },
  { key: 'memberName', label: 'Member' },
  { key: 'chapter', label: 'Chapter', value: (change) => chapterName(change.areaId) },
  { key: 'field', label: 'Field', value: (change) => fieldLabel(change.field) },
  { key: 'change', label: 'Change', value: (change) => changeValue(change, change.newValue) },
  { key: 'changedAt', label: 'Edited' },
  { key: 'status', label: 'Status', value: (change) => CHANGE_STATUS[change.status]?.label ?? change.status },
  { key: 'rowActions', label: 'Actions', action: true },
];

const chapterName = (areaId) => rows.value.find((row) => row.areaId === areaId)?.chapter ?? '';
const changeCount = (areaId) => changes.value.filter((change) => change.areaId === areaId).length;
const allChangesSelected = computed(() => changes.value.length > 0 && changes.value.every((change) => selectedChanges.value.has(change.id)));

async function loadChanges() {
  if (scope.value !== 'accounts') return;
  if (changesState.status === 'idle') changesState.status = 'loading';
  try {
    const result = await fetchOgdChanges(scope.value);
    changes.value = result.changes;
    pushProgress.value = Object.fromEntries(result.pushProgress.map((item) => [item.areaId, item]));
    result.pushProgress.forEach(trackPushEta);
    const open = new Set(changes.value.map((change) => change.id));
    selectedChanges.value = new Set([...selectedChanges.value].filter((id) => open.has(id)));
    Object.assign(changesState, { status: 'success', message: '' });
  } catch (error) {
    Object.assign(changesState, { status: 'error', message: error.message });
  }
}

function toggleChange(id) {
  const next = new Set(selectedChanges.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedChanges.value = next;
}

function toggleAllChanges() {
  selectedChanges.value = allChangesSelected.value ? new Set() : new Set(changes.value.map((change) => change.id));
}

async function updateChanges(action, ids) {
  if (!ids.length) return;
  const count = ids.length === 1 ? 'this change' : `these ${ids.length} changes`;
  const message = action === 'revert'
    ? `Oracle will go back to the old value for ${count}, and nothing is sent to OGD.`
    : `Oracle keeps the new value for ${count}, but it will not be sent to OGD.`;
  if (!confirmAction(action === 'revert' ? 'Revert in Oracle?' : 'Remove from the OGD queue?', message)) return;
  busyChanges.value = true;
  pushNotice.value = '';
  try {
    await updateOgdChanges({ scope: scope.value, action, ids });
    selectedChanges.value = new Set([...selectedChanges.value].filter((id) => !ids.includes(id)));
  } catch (error) {
    pushNotice.value = error.message;
  } finally {
    busyChanges.value = false;
    loadChanges();
  }
}

function setPushing(areaId, isPushing) {
  const next = new Set(pushingIds.value);
  if (isPushing) next.add(areaId);
  else next.delete(areaId);
  pushingIds.value = next;
  if (next.size && !pushPollTimer) pushPollTimer = setInterval(loadChanges, PROGRESS_POLL_MS);
  if (!next.size && pushPollTimer) {
    clearInterval(pushPollTimer);
    pushPollTimer = null;
  }
}

// ---------- Push progress ----------
// Each push run writes how many of its members it has pushed and how far it
// has paged through OGD's member list; this page polls it every few seconds.
// The percentage counts members pushed out of all members the push started
// with. The time left is an upper bound: it assumes the run pages to the end
// of the list, but a run stops as soon as every member is found.
const PUSH_RUN_BUDGET_MS = 230 * 1000;
const PUSH_GAP_MS = 90 * 1000;
const MIN_PUSH_SAMPLE_MS = 15 * 1000;
const pushProgress = ref({});
const pushRuns = ref({});
const pushEta = new Map();
let pushPollTimer = null;

function trackPushEta(item) {
  const run = pushRuns.value[item.areaId];
  if (!run || item.startedAt === run.staleStartedAt) return;
  // Between runs there is no progress row, so the last count is kept here.
  const done = Math.min(run.members, Math.max(run.lastDone, run.members - item.membersTotal + item.membersDone));
  if (done !== run.lastDone) pushRuns.value = { ...pushRuns.value, [item.areaId]: { ...run, lastDone: done } };
  if (item.stage !== 'pushing') return;
  const at = Date.parse(item.at);
  const sample = pushEta.get(item.areaId);
  if (!sample || sample.runStartedAt !== item.startedAt) {
    pushEta.set(item.areaId, { runStartedAt: item.startedAt, firstAt: at, firstDone: item.listDone, lastAt: at, lastDone: item.listDone });
    return;
  }
  if (at > sample.lastAt) Object.assign(sample, { lastAt: at, lastDone: item.listDone });
}

function pushTimeLeft(item) {
  const sample = pushEta.get(item.areaId);
  if (!sample || sample.runStartedAt !== item.startedAt) return '';
  const elapsed = sample.lastAt - sample.firstAt;
  const walked = sample.lastDone - sample.firstDone;
  if (elapsed < MIN_PUSH_SAMPLE_MS || walked < 2) return '';
  const left = Math.max(0, item.listTotal - item.listDone);
  if (!left) return 'almost done';
  let ms = left * (elapsed / walked);
  const leftInRun = Math.max(0, PUSH_RUN_BUDGET_MS - (sample.lastAt - Date.parse(item.startedAt)));
  if (ms > leftInRun) ms += Math.ceil((ms - leftInRun) / (PUSH_RUN_BUDGET_MS - PUSH_GAP_MS)) * PUSH_GAP_MS;
  return `up to ${formatTimeLeft(ms)}`;
}

function pushStatus(row) {
  const run = pushRuns.value[row.areaId];
  const item = pushProgress.value[row.areaId];
  if (!run) return 'Pushing to OGD…';
  const current = item && item.startedAt !== run.staleStartedAt;
  const done = run.lastDone;
  const percent = run.members ? Math.round((done / run.members) * 100) : 0;
  const head = `Pushing to OGD · ${percent}% (${done} of ${run.members} member${run.members === 1 ? '' : 's'})`;
  if (!current || item.stage === 'signing_in') return `${head} · signing in…`;
  if (item.stage === 'skipping') return `${head} · going back to page ${item.page ?? 1}…`;
  if (item.stage === 'saving') return `${head} · saving…`;
  const left = pushTimeLeft(item);
  return `${head} · ${left ? `${left[0].toUpperCase()}${left.slice(1)}` : 'working out the time left…'}`;
}

// Each run signs in once and pushes as many members as fit; the server says
// A push run that could not sign in is tried again after OGD's one-minute
// spacing between logins, a few times in a row. Wrong credentials and Gmail
// problems still stop it straight away.
const RETRYABLE_FAILURES = new Set(['unexpected_page', 'automation_error', 'members_page_unexpected', 'otp_not_found']);
const MAX_SIGN_IN_RETRIES = 3;
const RETRY_WAIT_MS = 65 * 1000;

// more: true when changes are left over and this starts the next run.
async function pushChanges(row) {
  const count = changeCount(row.areaId);
  if (!count || !confirmAction(`Push ${count} change${count === 1 ? '' : 's'} to OGD?`, `This signs in to OGD as ${row.chapter} and saves the changes on each member's record there.`)) return;
  notice.value = '';
  pushNotice.value = '';
  const members = new Set(changes.value.filter((change) => change.areaId === row.areaId).map((change) => change.memberId)).size;
  pushRuns.value = { ...pushRuns.value, [row.areaId]: { members, lastDone: 0, staleStartedAt: pushProgress.value[row.areaId]?.startedAt ?? null } };
  pushEta.delete(row.areaId);
  setPushing(row.areaId, true);
  try {
    let retries = 0;
    let fromPage = null;
    for (let run = 1; run <= MAX_PUSH_RUNS && isMounted; run += 1) {
      let result;
      try {
        result = await pushOgdChanges({ scope: scope.value, areaId: row.areaId, fromPage });
      } catch (error) {
        if (error.status !== 429 || retries >= MAX_SIGN_IN_RETRIES) throw error;
        result = { status: 'failed', failureCode: 'cooldown' };
      }
      if (result.status === 'failed' && (result.failureCode === 'cooldown' || RETRYABLE_FAILURES.has(result.failureCode)) && retries < MAX_SIGN_IN_RETRIES) {
        retries += 1;
        await new Promise((resolve) => setTimeout(resolve, RETRY_WAIT_MS));
        continue;
      }
      pushNotice.value = `${row.chapter}: ${result.status === 'failed' ? (FAILURE_MESSAGES[result.failureCode] ?? result.statusDetail ?? 'The push failed.') : result.statusDetail}`;
      await loadChanges();
      if (!result.more) break;
      fromPage = result.nextPage ?? null;
    }
  } catch (error) {
    pushNotice.value = `${row.chapter}: ${error.message}`;
  } finally {
    setPushing(row.areaId, false);
    const { [row.areaId]: _, ...rest } = pushRuns.value;
    pushRuns.value = rest;
    pushEta.delete(row.areaId);
    if (isMounted) {
      load();
      loadChanges();
    }
  }
}

watch(scope, () => {
  changes.value = [];
  changesState.status = 'idle';
  loadChanges();
});

onMounted(loadChanges);
onMounted(load);
onBeforeUnmount(() => {
  isMounted = false;
  clearInterval(pollTimer);
  clearInterval(pushPollTimer);
});
</script>

<template>
  <div class="page">
    <PageHead title="OGD Accounts" :subtitle="copy.subtitle" />
    <div v-if="scopes.length > 1" class="tabs" role="tablist">
      <button v-for="item in scopes" :key="item" class="tab" :class="{ active: item === scope }" role="tab" :aria-selected="item === scope" @click="scope = item">{{ COPY[item].tab }}</button>
    </div>

    <section v-if="scope === 'sector'" class="card guide">
      <button class="guide-head" :aria-expanded="isGuideOpen" @click="isGuideOpen = !isGuideOpen">
        <Info :size="18" /><span class="grow">How to connect a chapter's Gmail (App Password + IMAP)</span><component :is="isGuideOpen ? ChevronUp : ChevronDown" :size="16" />
      </button>
      <div v-if="isGuideOpen" class="guide-body">
        <ol>
          <li v-for="step in GUIDE_STEPS" :key="step.text">{{ step.text }}<a v-if="step.link" :href="step.url" target="_blank" rel="noopener noreferrer">{{ step.link }}</a></li>
        </ol>
        <p class="strong small">Good to know</p>
        <ul><li v-for="note in GUIDE_NOTES" :key="note">{{ note }}</li></ul>
      </div>
    </section>

    <SearchInput v-model="search" placeholder="Search sector, chapter, or account..." />
    <p v-if="notice" class="notice error">{{ notice }}</p>

    <section class="card">
      <LoadingBlock v-if="loadState.status === 'loading'" />
      <div v-else-if="loadState.status === 'error'" class="card-pad stack">
        <p class="text-danger">{{ loadState.message }}</p>
        <div><button class="btn btn-sm" @click="load">Try again</button></div>
      </div>
      <DataTable v-else :columns="columns" :rows="visibleRows" row-key="areaId" :initial-sort="{ key: 'sector', ascending: true }" :empty-text="rows.length ? 'No chapters match your search.' : 'No chapters are assigned to your account yet.'">
        <template #cell-sector="{ value }">{{ value || '—' }}</template>
        <template #cell-chapter="{ value }"><span class="strong">{{ value }}</span></template>
        <template #cell-identifier="{ value }">{{ value || 'Not set' }}</template>
        <template #cell-status="{ row }">
          <div class="status">
            <span class="pill" :class="STATUS[row.status].tone">{{ STATUS[row.status].label }}</span>
            <p v-if="row.status === 'failed' && FAILURE_MESSAGES[row.failureCode]" class="small text-danger">{{ FAILURE_MESSAGES[row.failureCode] }}</p>
            <p v-if="row.statusDetail" class="muted tiny">{{ row.statusDetail }}</p>
            <p v-if="row.lastSuccessAt" class="muted tiny">Last success: {{ formatDateTime(row.lastSuccessAt) }}</p>
          </div>
        </template>
        <template #cell-lastAttemptAt="{ value }"><span class="nowrap">{{ formatDateTime(value) }}</span></template>
        <template #cell-memberSync="{ row }">
          <div class="status">
            <template v-if="syncingIds.has(row.areaId)">
              <span class="pill info">Syncing {{ SYNC_PARTS[currentPart(row)] }}…</span>
              <div
                class="progress"
                :class="{ indeterminate: progressPercent(row.memberSync?.progress) === null }"
                role="progressbar"
                :aria-label="`${SYNC_PARTS[currentPart(row)]} sync progress`"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-valuenow="progressPercent(row.memberSync?.progress) ?? undefined"
              >
                <div class="progress-fill" :style="{ width: `${progressPercent(row.memberSync?.progress) ?? 35}%` }" />
              </div>
              <p class="muted tiny">{{ progressLabel(row) }}</p>
              <p class="tiny strong-ish" aria-live="polite">{{ timeLeftLabel(row) }}</p>
              <p class="muted tiny">Runs in the background. You can close this page.</p>
            </template>
            <template v-else-if="row.memberSync">
              <span class="pill" :class="SYNC_STATUS[row.memberSync.status].tone">{{ SYNC_STATUS[row.memberSync.status].label }}</span>
              <p v-if="row.memberSync.background?.stalled" class="small text-danger">The background {{ SYNC_PARTS[row.memberSync.background.part] ?? '' }} sync stopped unexpectedly. Start it again to continue.</p>
              <p v-if="row.memberSync.status === 'failed' && FAILURE_MESSAGES[row.memberSync.failureCode]" class="small text-danger">{{ FAILURE_MESSAGES[row.memberSync.failureCode] }}</p>
              <p v-if="row.memberSync.statusDetail" class="muted tiny">{{ row.memberSync.statusDetail }}</p>
              <p v-for="note in resumeNotes(row.memberSync)" :key="note" class="muted tiny">{{ note }}</p>
              <p class="muted tiny">{{ formatDateTime(row.memberSync.syncedAt) }}</p>
            </template>
            <span v-else class="muted small">Never synced</span>
          </div>
        </template>
        <template #cell-actions="{ row }">
          <div class="row-actions">
            <button class="btn btn-sm" @click="openEdit(row)"><KeyRound :size="13" />{{ row.ownConfigured ? 'Change' : 'Set up' }}</button>
            <span v-if="testingIds.has(row.areaId) || syncingIds.has(row.areaId) || pushingIds.has(row.areaId)" class="spinner sm" role="status" :aria-label="pushingIds.has(row.areaId) ? 'Pushing to OGD' : 'Working'" />
            <span v-if="pushingIds.has(row.areaId)" class="muted small" aria-live="polite">{{ pushStatus(row) }}</span>
            <button v-else-if="syncingIds.has(row.areaId) && !startingIds.has(row.areaId)" class="btn btn-sm btn-danger" :disabled="stoppingIds.has(row.areaId)" @click="stopSync(row)"><Square :size="13" />{{ stoppingIds.has(row.areaId) ? 'Stopping…' : 'Stop' }}</button>
            <template v-else-if="row.ownConfigured && row.otherConfigured && row.status !== 'running' && !testingIds.has(row.areaId) && !syncingIds.has(row.areaId)">
              <button class="btn btn-sm" @click="testLogin(row)"><LogIn :size="13" />Test Login</button>
              <button class="btn btn-sm" @click="syncMembers(row, 'info')"><RefreshCw :size="13" />Sync Members</button>
              <button class="btn btn-sm" @click="syncMembers(row, 'formations')"><GraduationCap :size="13" />Sync Formations</button>
              <button v-if="scope === 'accounts' && changeCount(row.areaId)" class="btn btn-sm btn-primary" @click="pushChanges(row)"><UploadCloud :size="13" />Push to OGD ({{ changeCount(row.areaId) }})</button>
            </template>
          </div>
        </template>
      </DataTable>
    </section>

    <section v-if="scope === 'accounts'" class="card" aria-labelledby="ogd-changes-title">
      <div class="card-pad changes-head">
        <div class="grow">
          <h2 id="ogd-changes-title" class="card-title">Changes waiting for OGD</h2>
          <p class="muted small">Member edits saved in Oracle. Remove the ones that should not go to OGD, then use Push to OGD on the chapter above.</p>
        </div>
        <div v-if="changes.length" class="row row-wrap">
          <label class="check small"><input class="tick" type="checkbox" :checked="allChangesSelected" @change="toggleAllChanges" />Select all</label>
          <button class="btn btn-sm" :disabled="!selectedChanges.size || busyChanges || pushingIds.size > 0" @click="updateChanges('discard', [...selectedChanges])"><Trash2 :size="13" />Discard selected</button>
          <button class="btn btn-sm" :disabled="!selectedChanges.size || busyChanges || pushingIds.size > 0" @click="updateChanges('revert', [...selectedChanges])"><Undo2 :size="13" />Revert selected</button>
        </div>
      </div>
      <p v-if="pushNotice" class="notice push-notice" role="status">{{ pushNotice }}</p>
      <LoadingBlock v-if="changesState.status === 'loading'" />
      <div v-else-if="changesState.status === 'error'" class="card-pad stack">
        <p class="text-danger">{{ changesState.message }}</p>
        <div><button class="btn btn-sm" @click="loadChanges">Try again</button></div>
      </div>
      <DataTable v-else :columns="changeColumns" :rows="changes" row-key="id" :initial-sort="{ key: 'changedAt', ascending: false }" empty-text="Nothing is waiting. Member edits saved in Oracle will show here.">
        <template #cell-select="{ row }"><input class="tick" type="checkbox" :aria-label="`Select ${row.memberName} ${fieldLabel(row.field)}`" :checked="selectedChanges.has(row.id)" @change="toggleChange(row.id)" /></template>
        <template #cell-memberName="{ row }"><span class="strong">{{ row.memberName }}</span><p class="muted tiny">{{ row.memberId }}</p></template>
        <template #cell-change="{ row }">
          <span class="change"><span class="old">{{ changeValue(row, row.oldValue) }}</span><ArrowRight :size="12" aria-label="to" /><span class="strong">{{ changeValue(row, row.newValue) }}</span></span>
        </template>
        <template #cell-changedAt="{ row }"><span class="nowrap">{{ formatDateTime(row.changedAt) }}</span><p v-if="row.changedBy" class="muted tiny">{{ row.changedBy }}</p></template>
        <template #cell-status="{ row }">
          <div class="status">
            <span class="pill" :class="CHANGE_STATUS[row.status]?.tone">{{ CHANGE_STATUS[row.status]?.label ?? row.status }}</span>
            <p v-if="row.detail" class="muted tiny">{{ row.detail }}</p>
          </div>
        </template>
        <template #cell-rowActions="{ row }">
          <div class="row">
            <button class="link-btn" :disabled="busyChanges || pushingIds.has(row.areaId)" @click="updateChanges('discard', [row.id])"><Trash2 :size="13" />Discard</button>
            <button class="link-btn" :disabled="busyChanges || pushingIds.has(row.areaId)" @click="updateChanges('revert', [row.id])"><Undo2 :size="13" />Revert</button>
          </div>
        </template>
      </DataTable>
    </section>

    <AppModal v-if="editing" :title="editing.chapter" :subtitle="editing.sector || ''" :locked="form.isSaving" @close="editing = null">
      <form class="stack" @submit.prevent="saveCredential">
        <label class="field"><span class="field-label">{{ copy.identifierLabel }}</span><input v-model="form.identifier" class="input" :type="copy.type" :placeholder="copy.hint" :maxlength="copy.maxIdentifier" autocapitalize="none" autocomplete="off" spellcheck="false" /></label>
        <PasswordField v-model="form.password" :label="copy.passwordLabel" :placeholder="editing.ownConfigured ? 'Enter the password again to save' : copy.passwordHint" :maxlength="copy.maxPassword" autocomplete="new-password" />
        <p class="muted small">Stored encrypted and used only to sign this chapter in to OGD. It can't be viewed again after saving.</p>
        <p v-if="form.error" class="small text-danger">{{ form.error }}</p>
        <div class="row actions">
          <button type="button" class="btn" :disabled="form.isSaving" @click="editing = null">Cancel</button>
          <button class="btn btn-primary" :disabled="form.isSaving">{{ form.isSaving ? 'Saving…' : 'Save' }}</button>
        </div>
      </form>
    </AppModal>
  </div>
</template>

<style scoped>
.row-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 220px; }
.guide { background: var(--accent-soft); box-shadow: none; }
.guide-head { width: 100%; display: flex; align-items: center; gap: 8px; padding: 13px 16px; border: 0; background: none; font-size: 13.5px; font-weight: var(--fw-heading); text-align: left; }
.guide-body { padding: 0 16px 14px; font-size: 13px; color: var(--ink-2); display: grid; gap: 8px; }
ol, ul { margin: 0; padding-left: 20px; display: grid; gap: 6px; }
.guide-body a { display: block; font-weight: var(--fw-medium); }
.status { text-align: left; min-width: 150px; }
.tiny { font-size: 11px; margin-top: 2px; }
.strong-ish { color: var(--ink-2); font-weight: var(--fw-medium); }
.progress { position: relative; height: 6px; margin-top: 6px; border-radius: 999px; background: var(--accent-soft); overflow: hidden; min-width: 140px; }
.progress-fill { height: 100%; border-radius: inherit; background: var(--accent); transition: width 0.6s ease; }
.progress.indeterminate .progress-fill { position: absolute; animation: progress-slide 1.4s ease-in-out infinite; }
@keyframes progress-slide { from { left: -35%; } to { left: 100%; } }
@media (prefers-reduced-motion: reduce) {
  .progress-fill { transition: none; }
  .progress.indeterminate .progress-fill { animation: none; left: 0; opacity: 0.6; }
}
.actions { justify-content: flex-end; }
.changes-head { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 12px; }
.push-notice { margin: 0 16px 12px; }
.tick { width: 16px; height: 16px; accent-color: var(--primary); }
.change { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.change .old { color: var(--muted); text-decoration: line-through; }
</style>
