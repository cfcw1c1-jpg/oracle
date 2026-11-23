<script setup>
import { CalendarPlus, Check, Copy, CopyPlus, Download, ExternalLink, Pencil, RefreshCw, Send, Trash2, UserPlus, X } from 'lucide-vue-next';
import { computed, markRaw, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import AppModal from '@/components/AppModal.vue';
import DataTable from '@/components/DataTable.vue';
import LoadingBlock from '@/components/LoadingBlock.vue';
import PageHead from '@/components/PageHead.vue';
import PushProgress from '@/components/PushProgress.vue';
import SearchInput from '@/components/SearchInput.vue';
import { confirmAction, exportCsv, formatDateTime } from '@/lib/data';
import {
  deleteActivity, FAILURE_MESSAGES, fetchActivities, fetchActivityMembers, fetchActivityProgress, pushActivity, pushActivityAttendees, readActivityForm, saveActivity, syncActivities, updateActivityAttendees,
} from '@/lib/ogdApi';
import { describeProgress } from '@/lib/pushProgress';

// Each chapter signs in to OGD in its own browser, so only a couple run at once.
const CONCURRENT_RUNS = 2;
// OGD's types seen so far; types read from OGD are added to these.
const DEFAULT_TYPES = ['CHAPTER PRAYER ASSEMBLY', 'FORMATION', 'TRAINING', 'TEACHING', 'FELLOWSHIP', 'OTHER MEETING', 'WORK WITH THE POOR', 'MISSION', 'CONFERENCE', 'OTHER ASSEMBLY', 'FIG ACTIVITY'];
const TZ = 'Asia/Manila';

// ---------- Dates (Manila) ----------

function manilaDay(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function addMonths(day, months) {
  const [year, month] = day.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  return first.toISOString().slice(0, 10);
}
const today = manilaDay();
const PRESETS = [
  { label: 'This month', from: () => `${today.slice(0, 8)}01`, to: () => today },
  { label: 'Last 3 months', from: () => addMonths(today, -2), to: () => today },
  { label: 'This year', from: () => `${today.slice(0, 4)}-01-01`, to: () => today },
  { label: 'Upcoming', from: () => today, to: () => addMonths(today, 3) },
];

function formatWhen(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}
// <input type="datetime-local"> value, in Manila time.
function toLocalInput(iso) {
  if (!iso) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
function fromLocalInput(value) {
  return value ? new Date(`${value}:00+08:00`).toISOString() : null;
}

// ---------- State ----------

const range = reactive({ from: addMonths(today, -2), to: today });
const chapters = ref([]);
const activities = ref([]);
const knownTypes = ref([]);
// OGD's New Activity form as read by Oracle: its fields, and the extra fields each Type brings.
const ogdForm = ref(null);
const formChapterId = ref(null);
const isReadingForm = ref(false);
const formError = ref('');
const showFormFields = ref(false);
const loadState = reactive({ status: 'loading', message: '' });
const chapterFilter = ref('');
const typeFilter = ref('');
const search = ref('');
const expandedId = ref(null);
const runningIds = ref(new Set());
const rowErrors = ref({});
const isSyncingAll = ref(false);
const pushingIds = ref(new Set());
const sendingIds = ref(new Set());
const actionErrors = ref({});
const copied = ref('');
let isActive = true;
let loadToken = 0;

const chapterById = computed(() => new Map(chapters.value.map((chapter) => [chapter.areaId, chapter])));
const readyCount = computed(() => chapters.value.filter((row) => row.isReady).length);
const isBusy = computed(() => isSyncingAll.value || runningIds.value.size > 0);
const typeOptions = computed(() => [...new Set([...DEFAULT_TYPES, ...knownTypes.value])].sort());

function isPlaceholder(text) {
  return !text || /^-+|^select\b|^choose\b|^show all/i.test(text.trim());
}
const formTypeField = computed(() => ogdForm.value?.fields?.find((field) => field.label === ogdForm.value.typeFieldLabel) ?? null);
// OGD's own Type choices once its form has been read; until then, the usual ones.
const editorTypes = computed(() => (formTypeField.value
  ? formTypeField.value.options.map((option) => option.text).filter((text) => !isPlaceholder(text))
  : DEFAULT_TYPES));
// The editor's pick list, keeping an older activity's own type choosable.
const editorTypeChoices = computed(() => {
  const current = editor.form?.activityType;
  return current && !editorTypes.value.includes(current) ? [...editorTypes.value, current] : editorTypes.value;
});
const editorAreaChoices = computed(() => {
  const current = editor.form?.areaName;
  const chapter = chapterById.value.get(editor.form?.areaId)?.chapter;
  return [...new Set([chapter, current, ...editorAreas.value].filter(Boolean))];
});
const formAreaField = computed(() => ogdForm.value?.fields?.find((field) => field.kind === 'select' && /^area/i.test(field.label)) ?? null);
const formSummary = computed(() => {
  const form = ogdForm.value;
  if (!form) return null;
  const withExtras = Object.keys(form.dependents ?? {}).filter((key) => !key.includes(' >> ')).length;
  return { types: editorTypes.value.length, withExtras, chapter: chapterById.value.get(form.areaId)?.chapter };
});
function choicesOf(field) {
  return (field.options ?? []).filter((option) => !isPlaceholder(option.text));
}

// The extra fields for the Type chosen in the editor, and those its own lists bring.
const extraFields = computed(() => {
  const form = ogdForm.value;
  if (!form?.typeFieldLabel || !editor.open || !editor.form.activityType) return [];
  // A list found again deeper down (Talk(s) for the chosen Formation) keeps
  // its place but takes the deeper, narrower choices.
  const shown = new Map();
  const visit = (key, depth) => {
    for (const field of form.dependents?.[key] ?? []) {
      shown.set(field.label, { ...field, depth, uid: field.label });
    }
    for (const field of form.dependents?.[key] ?? []) {
      const value = editor.form.ogdFields?.[field.label];
      if ((field.kind === 'select' || field.kind === 'radio') && value && depth < 3) visit(`${key} >> ${field.label}::${value}`, depth + 1);
    }
  };
  visit(`${form.typeFieldLabel}::${editor.form.activityType}`, 0);
  return [...shown.values()];
});

// A value is kept only while the field shows it as a choice.
function keptValue(field, value) {
  if (value === undefined || value === '' || (Array.isArray(value) && !value.length)) return undefined;
  if (!['select', 'radio', 'checkboxes', 'multiselect'].includes(field.kind)) return value;
  const texts = new Set(choicesOf(field).map((option) => option.text));
  if (Array.isArray(value)) {
    const list = value.filter((entry) => texts.has(entry));
    return list.length ? list : undefined;
  }
  return texts.has(value) ? value : undefined;
}
function toggleExtraChoice(label, text) {
  const list = Array.isArray(editor.form.ogdFields[label]) ? editor.form.ogdFields[label] : [];
  editor.form.ogdFields[label] = list.includes(text) ? list.filter((entry) => entry !== text) : [...list, text];
}

async function readForm() {
  const areaId = formChapterId.value || chapters.value.find((row) => row.isReady)?.areaId;
  if (!areaId) return;
  isReadingForm.value = true;
  formError.value = '';
  try {
    await readActivityForm(areaId);
  } catch (error) {
    if (isActive) formError.value = error.message;
  } finally {
    if (isActive) {
      isReadingForm.value = false;
      load();
    }
  }
}

function readFormFromEditor() {
  if (chapterById.value.get(editor.form.areaId)?.isReady) formChapterId.value = editor.form.areaId;
  readForm();
}

const visibleActivities = computed(() => {
  const query = search.value.trim().toLowerCase();
  return activities.value.filter((activity) => (!chapterFilter.value || activity.areaId === Number(chapterFilter.value))
    && (!typeFilter.value || activity.activityType === typeFilter.value)
    && (!query || [activity.name, activity.activityType, activity.areaName, activity.teamLeader, activity.venue, chapterById.value.get(activity.areaId)?.chapter]
      .some((value) => value?.toLowerCase().includes(query))
      || activity.attendees.some((attendee) => `${attendee.name} ${attendee.memberId ?? ''}`.toLowerCase().includes(query))));
});

const totals = computed(() => ({
  activities: visibleActivities.value.length,
  attendance: visibleActivities.value.reduce((sum, activity) => sum + attendeeCount(activity), 0),
  members: new Set(visibleActivities.value.flatMap((activity) => activity.attendees.filter((attendee) => attendee.memberId).map((attendee) => attendee.memberId))).size,
}));

function attendeeCount(activity) {
  return Math.max(activity.attendees.length, activity.attendanceCount ?? 0);
}
function attendeeKey(attendee) {
  return attendee.memberId ? `id:${attendee.memberId.toUpperCase()}` : `name:${String(attendee.name).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()}`;
}
function attendanceLink(activity) {
  return `${window.location.origin}/activity-attendance?token=${activity.publicToken}`;
}

function statusOf(activity) {
  if (pushingIds.value.has(activity.id) || activity.pushStatus === 'pushing') return { label: 'Pushing to OGD…', tone: 'info' };
  if (activity.source === 'ogd') return { label: 'From OGD', tone: '' };
  if (activity.pushStatus === 'pushed') return { label: 'In OGD', tone: 'success' };
  if (activity.pushStatus === 'failed') return { label: 'Push failed', tone: 'danger' };
  return { label: 'Oracle only', tone: 'warning' };
}

function syncStatus(row) {
  if (runningIds.value.has(row.areaId)) return { label: 'Syncing…', tone: 'info' };
  if (!row.sync) return row.isReady ? { label: 'Not synced', tone: '' } : { label: 'Needs OGD setup', tone: '' };
  if (row.sync.status === 'failed') return { label: 'Failed', tone: 'danger' };
  return { label: `${row.sync.found} activit${row.sync.found === 1 ? 'y' : 'ies'}${row.sync.isPartial ? ' (partial)' : ''}`, tone: row.sync.isPartial ? 'warning' : 'success' };
}

const chapterColumns = [
  { key: 'sector', label: 'Sector' },
  { key: 'chapter', label: 'Chapter' },
  { key: 'sync', label: 'Last Sync', value: (row) => row.sync?.syncedAt ?? '' },
  { key: 'range', label: 'Synced Range', value: (row) => row.sync?.from ?? '' },
  { key: 'actions', label: 'Actions', action: true },
];

const activityColumns = [
  { key: 'name', label: 'Activity Name' },
  { key: 'activityType', label: 'Type' },
  { key: 'areaName', label: 'Area', value: (row) => row.areaName || chapterById.value.get(row.areaId)?.chapter },
  { key: 'startsAt', label: 'Start Date' },
  { key: 'endsAt', label: 'End Date' },
  { key: 'teamLeader', label: 'Team Leader' },
  { key: 'venue', label: 'Venue' },
  { key: 'attendance', label: 'Attendance', value: attendeeCount, align: 'right' },
  { key: 'status', label: 'Status', value: (row) => statusOf(row).label },
];

// ---------- Loading and syncing ----------

async function load() {
  const token = ++loadToken;
  try {
    const result = await fetchActivities(range.from, range.to);
    if (token !== loadToken || !isActive) return;
    chapters.value = result.chapters;
    activities.value = result.activities;
    knownTypes.value = result.types;
    ogdForm.value = result.form;
    if (!formChapterId.value) formChapterId.value = result.form?.areaId ?? result.chapters.find((row) => row.isReady)?.areaId ?? null;
    Object.assign(loadState, { status: 'success', message: '' });
  } catch (error) {
    if (token !== loadToken || !isActive) return;
    Object.assign(loadState, { status: 'error', message: error.message });
  }
}

function applyRange() {
  if (!range.from || !range.to) return;
  Object.assign(loadState, { status: 'loading', message: '' });
  load();
}
function applyPreset(preset) {
  range.from = preset.from();
  range.to = preset.to();
  applyRange();
}

function setIn(setRef, id, isOn) {
  const next = new Set(setRef.value);
  if (isOn) next.add(id);
  else next.delete(id);
  setRef.value = next;
}

async function syncChapter(areaId) {
  setIn(runningIds, areaId, true);
  rowErrors.value = { ...rowErrors.value, [areaId]: null };
  try {
    await syncActivities({ areaId, from: range.from, to: range.to });
  } catch (error) {
    if (isActive) rowErrors.value = { ...rowErrors.value, [areaId]: error.message };
  } finally {
    if (isActive) {
      setIn(runningIds, areaId, false);
      load();
    }
  }
}

async function syncAll() {
  const queue = chapters.value.filter((row) => row.isReady && (!chapterFilter.value || row.areaId === Number(chapterFilter.value))).map((row) => row.areaId);
  isSyncingAll.value = true;
  async function worker() {
    while (queue.length && isActive) await syncChapter(queue.shift());
  }
  try {
    await Promise.all(Array.from({ length: CONCURRENT_RUNS }, worker));
  } finally {
    if (isActive) isSyncingAll.value = false;
  }
}

function replaceActivity(updated) {
  activities.value = activities.value.map((activity) => (activity.id === updated.id ? updated : activity));
}

async function copy(text, key) {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = key;
    setTimeout(() => { if (copied.value === key) copied.value = ''; }, 2000);
  } catch {
    window.prompt('Copy this link:', text);
  }
}

// ---------- Push progress (bar and time left while OGD works) ----------

const progressRuns = ref({});
const nowTick = ref(Date.now());
let progressTimer = null;
let progressTicks = 0;

function startProgress(kind, activity, count = 0) {
  progressRuns.value = { ...progressRuns.value, [`${kind}:${activity.id}`]: { startedAt: Date.now(), progress: null, memo: markRaw({}), count } };
  if (progressTimer) return;
  progressTimer = setInterval(async () => {
    nowTick.value = Date.now();
    progressTicks += 1;
    if (progressTicks % 2) return;
    for (const key of Object.keys(progressRuns.value)) {
      const [kindOf, id] = key.split(':');
      const progress = await fetchActivityProgress(Number(id)).catch(() => undefined);
      const run = progressRuns.value[key];
      if (run && progress?.kind === kindOf) run.progress = progress;
    }
  }, 1000);
}

function stopProgress(kind, activityId) {
  const next = { ...progressRuns.value };
  delete next[`${kind}:${activityId}`];
  progressRuns.value = next;
  if (!Object.keys(next).length && progressTimer) { clearInterval(progressTimer); progressTimer = null; }
}

function progressOf(kind, activity) {
  const run = activity && progressRuns.value[`${kind}:${activity.id}`];
  if (!run) return null;
  return describeProgress(kind, run.progress, { startedAt: run.startedAt, now: nowTick.value, memo: run.memo, count: run.count });
}

async function push(activity) {
  setIn(pushingIds, activity.id, true);
  startProgress('activity', activity);
  actionErrors.value = { ...actionErrors.value, [activity.id]: null };
  try {
    const result = await pushActivity(activity.id);
    if (isActive) replaceActivity(result.activity);
    // Its attendees follow it into OGD.
    if (result.activity.pushStatus === 'pushed' && result.activity.pendingInOgd) sendAttendees(result.activity);
    return result.activity;
  } catch (error) {
    if (isActive) actionErrors.value = { ...actionErrors.value, [activity.id]: error.message };
    load();
    return null;
  } finally {
    stopProgress('activity', activity.id);
    if (isActive) setIn(pushingIds, activity.id, false);
  }
}

// Adds the attendees OGD does not have yet to the activity's attendees in OGD.
const MAX_ATTENDEE_ROUNDS = 6;
async function sendAttendees(activity) {
  if (sendingIds.value.has(activity.id) || !chapterById.value.get(activity.areaId)?.isReady) return;
  setIn(sendingIds, activity.id, true);
  startProgress('attendees', activity, Math.min(activity.pendingInOgd || 0, 40));
  actionErrors.value = { ...actionErrors.value, [activity.id]: null };
  try {
    // OGD allows about 40 attendees per run; more rounds follow while each one adds someone.
    for (let round = 1; round <= MAX_ATTENDEE_ROUNDS && isActive; round += 1) {
      if (round > 1) startProgress('attendees', activity, Math.min(activity.pendingInOgd || 0, 40));
      const result = await pushActivityAttendees(activity.id);
      if (!isActive) break;
      replaceActivity(result.activity);
      activity = result.activity;
      if (!result.added || !result.activity.pendingInOgd) break;
    }
  } catch (error) {
    if (isActive) actionErrors.value = { ...actionErrors.value, [activity.id]: error.message };
    load();
  } finally {
    stopProgress('attendees', activity.id);
    if (isActive) setIn(sendingIds, activity.id, false);
  }
}

function ogdStateOf(activity, attendee) {
  if (attendee.source === 'ogd') return { label: 'In OGD', tone: 'success' };
  if (attendee.ogd === 'added') return { label: attendee.ogdNote ? 'Already in OGD' : 'Added to OGD', tone: 'success' };
  if (!activity.isInOgd) return { label: 'Goes with push', tone: '' };
  if (!attendee.memberId) return { label: 'No Member ID', tone: 'warning' };
  if (attendee.ogd === 'skipped') return { label: 'Not in OGD (skipped)', tone: '' };
  if (!attendee.isPendingInOgd) return { label: 'Already in OGD', tone: 'success' };
  if (sendingIds.value.has(activity.id)) return { label: 'Adding…', tone: 'info' };
  if (attendee.ogd === 'failed') return { label: 'Not added', tone: 'danger' };
  return { label: 'Waiting', tone: 'warning' };
}

async function remove(activity) {
  if (!confirmAction('Delete this activity?', `"${activity.name}" will be removed from Oracle. Its attendance link will stop working.`)) return;
  try {
    await deleteActivity(activity.id);
    activities.value = activities.value.filter((entry) => entry.id !== activity.id);
  } catch (error) {
    actionErrors.value = { ...actionErrors.value, [activity.id]: error.message };
  }
}

async function removeAttendee(activity, attendee) {
  if (!confirmAction('Remove this attendee?', `${attendee.name} will be removed from "${activity.name}" in Oracle.`)) return;
  try {
    replaceActivity(await updateActivityAttendees(activity.id, { remove: [attendeeKey(attendee)] }));
  } catch (error) {
    actionErrors.value = { ...actionErrors.value, [activity.id]: error.message };
  }
}

// ---------- Exports ----------

function exportActivities() {
  exportCsv(`activities-${range.from}-to-${range.to}`, [
    { key: 'chapter', label: 'Chapter', value: (row) => chapterById.value.get(row.areaId)?.chapter },
    { key: 'name', label: 'Activity Name' },
    { key: 'activityType', label: 'Type' },
    { key: 'areaName', label: 'Area' },
    { key: 'startsAt', label: 'Start Date', value: (row) => formatWhen(row.startsAt) },
    { key: 'endsAt', label: 'End Date', value: (row) => formatWhen(row.endsAt) },
    { key: 'teamLeader', label: 'Team Leader' },
    { key: 'venue', label: 'Venue' },
    { key: 'description', label: 'Description' },
    { key: 'attendance', label: 'Attendance', value: attendeeCount },
    { key: 'status', label: 'Status', value: (row) => statusOf(row).label },
    { key: 'ogdUrl', label: 'OGD Link' },
    { key: 'link', label: 'Attendance Link', value: attendanceLink },
  ], visibleActivities.value);
}

function exportAttendees(list = visibleActivities.value) {
  const rows = list.flatMap((activity) => activity.attendees.map((attendee, index) => ({ activity, attendee, rowId: `${activity.id}-${index}` })));
  exportCsv(list.length === 1 ? `attendees-${list[0].name}` : `activity-attendees-${range.from}-to-${range.to}`, [
    { key: 'chapter', label: 'Chapter', value: (row) => chapterById.value.get(row.activity.areaId)?.chapter },
    { key: 'activity', label: 'Activity', value: (row) => row.activity.name },
    { key: 'type', label: 'Type', value: (row) => row.activity.activityType },
    { key: 'start', label: 'Start Date', value: (row) => formatWhen(row.activity.startsAt) },
    { key: 'memberId', label: 'Member ID', value: (row) => row.attendee.memberId },
    { key: 'name', label: 'Name', value: (row) => row.attendee.name },
    { key: 'area', label: 'Area', value: (row) => row.attendee.area },
    { key: 'service', label: 'Pastoral Service', value: (row) => row.attendee.service },
    { key: 'source', label: 'Added By', value: (row) => SOURCE_LABELS[row.attendee.source] ?? row.attendee.source },
    { key: 'matched', label: 'In Members List', value: (row) => (row.attendee.matched ? 'Yes' : 'No') },
  ], rows);
}

const SOURCE_LABELS = { ogd: 'OGD', oracle: 'Oracle', link: 'Attendance link' };

// ---------- New / edit ----------

const editor = reactive({ open: false, saving: false, pushAfter: true, error: '', saved: null, copiedFrom: null, form: {} });
const memberCache = ref({});
const membersState = reactive({ status: 'idle', message: '' });
const memberSearch = ref('');
const attendeeSearch = ref('');
const addingFor = ref(null);
const addSelection = ref([]);

const editorMembers = computed(() => memberCache.value[editor.form.areaId] ?? []);
const editorAreas = computed(() => [...new Set(editorMembers.value.map((member) => member.area).filter(Boolean))].sort());

function blankForm() {
  const areaId = Number(chapterFilter.value) || chapters.value.find((row) => row.isReady)?.areaId || chapters.value[0]?.areaId || null;
  return {
    id: null, areaId, name: '', activityType: '', areaName: chapterById.value.get(areaId)?.chapter ?? '',
    start: '', end: '', teamLeader: '', teamLeaderMemberId: '', venue: '', description: '', attendeeIds: [], ogdFields: {},
  };
}

async function ensureMembers(areaId) {
  if (!areaId || memberCache.value[areaId]) return;
  membersState.status = 'loading';
  try {
    const members = await fetchActivityMembers(areaId);
    memberCache.value = { ...memberCache.value, [areaId]: members };
    membersState.status = 'success';
  } catch (error) {
    Object.assign(membersState, { status: 'error', message: error.message });
  }
}

function openNew() {
  Object.assign(editor, { open: true, saving: false, error: '', saved: null, pushAfter: true, copiedFrom: null, form: blankForm() });
  memberSearch.value = '';
  ensureMembers(editor.form.areaId);
}

function openEdit(activity) {
  Object.assign(editor, {
    open: true, saving: false, error: '', saved: null, pushAfter: true, copiedFrom: null,
    form: {
      id: activity.id, areaId: activity.areaId, name: activity.name, activityType: activity.activityType ?? '', areaName: activity.areaName ?? '',
      start: toLocalInput(activity.startsAt), end: toLocalInput(activity.endsAt), teamLeader: activity.teamLeader ?? '',
      teamLeaderMemberId: activity.teamLeaderMemberId ?? '', venue: activity.venue ?? '', description: activity.description ?? '',
      attendeeIds: activity.attendees.filter((attendee) => attendee.memberId && attendee.source !== 'link').map((attendee) => attendee.memberId),
      ogdFields: { ...(activity.ogdFields ?? {}) },
    },
  });
  memberSearch.value = '';
  ensureMembers(activity.areaId);
}

// A new activity filled in from another one, with all its attendees, so only
// the title, type and dates need changing. Works for activities from OGD too.
function openDuplicate(activity) {
  const attendeeIds = [...new Set(activity.attendees.filter((attendee) => attendee.memberId).map((attendee) => attendee.memberId))];
  Object.assign(editor, {
    open: true, saving: false, error: '', saved: null, pushAfter: true,
    copiedFrom: { name: activity.name, start: toLocalInput(activity.startsAt), skipped: activity.attendees.filter((attendee) => !attendee.memberId).length },
    form: {
      id: null, areaId: activity.areaId, name: activity.name, activityType: activity.activityType ?? '', areaName: activity.areaName || (chapterById.value.get(activity.areaId)?.chapter ?? ''),
      start: toLocalInput(activity.startsAt), end: toLocalInput(activity.endsAt), teamLeader: activity.teamLeader ?? '',
      teamLeaderMemberId: activity.teamLeaderMemberId ?? '', venue: activity.venue ?? '', description: activity.description ?? '',
      attendeeIds,
      ogdFields: { ...(activity.ogdFields ?? {}) },
    },
  });
  memberSearch.value = '';
  ensureMembers(activity.areaId);
}

function changeEditorChapter() {
  editor.form.areaName = chapterById.value.get(editor.form.areaId)?.chapter ?? '';
  editor.form.attendeeIds = [];
  editor.form.teamLeaderMemberId = '';
  ensureMembers(editor.form.areaId);
}

function onLeaderInput() {
  const match = editorMembers.value.find((member) => member.name.toUpperCase() === editor.form.teamLeader.trim().toUpperCase());
  editor.form.teamLeaderMemberId = match?.memberId ?? '';
}

const pickerMembers = computed(() => {
  const query = memberSearch.value.trim().toLowerCase();
  const list = editorMembers.value;
  return (query ? list.filter((member) => `${member.name} ${member.memberId} ${member.area}`.toLowerCase().includes(query)) : list).slice(0, 300);
});

function toggleAttendee(memberId) {
  const ids = editor.form.attendeeIds;
  editor.form.attendeeIds = ids.includes(memberId) ? ids.filter((id) => id !== memberId) : [...ids, memberId];
}

async function submitEditor() {
  editor.error = '';
  if (!editor.form.name.trim()) { editor.error = 'Please enter the activity name.'; return; }
  if (!editor.form.start) { editor.error = 'Please enter the start date and time.'; return; }
  if (editor.form.end && editor.form.end < editor.form.start) { editor.error = 'The end must be after the start.'; return; }
  if (editor.copiedFrom && editor.form.start === editor.copiedFrom.start && editor.form.name.trim() === editor.copiedFrom.name) {
    editor.error = 'This copy has the same title and start as the original. Change the title or the date first.';
    return;
  }
  editor.saving = true;
  try {
    const saved = await saveActivity({
      id: editor.form.id, areaId: editor.form.areaId, name: editor.form.name, activityType: editor.form.activityType, areaName: editor.form.areaName,
      startsAt: fromLocalInput(editor.form.start), endsAt: fromLocalInput(editor.form.end), teamLeader: editor.form.teamLeader,
      teamLeaderMemberId: editor.form.teamLeaderMemberId, venue: editor.form.venue, description: editor.form.description, attendeeIds: editor.form.attendeeIds,
      // Only the extra fields the chosen Type shows; values left from another Type are dropped.
      ogdFields: Object.fromEntries(extraFields.value.map((field) => [field.label, keptValue(field, editor.form.ogdFields?.[field.label])])
        .filter(([, value]) => value !== undefined)),
    });
    if (!isActive) return;
    const inRange = saved.startsAt >= fromLocalInput(`${range.from}T00:00`) && saved.startsAt <= fromLocalInput(`${range.to}T23:59`);
    if (activities.value.some((activity) => activity.id === saved.id)) replaceActivity(saved);
    else if (inRange) activities.value = [saved, ...activities.value];
    editor.saved = saved;
    expandedId.value = saved.id;
    if (editor.pushAfter && chapterById.value.get(saved.areaId)?.isReady) {
      const pushed = await push(saved);
      if (pushed && isActive) editor.saved = pushed;
    }
  } catch (error) {
    if (isActive) editor.error = error.message;
  } finally {
    if (isActive) editor.saving = false;
  }
}

const savedActivity = computed(() => (editor.saved ? activities.value.find((activity) => activity.id === editor.saved.id) ?? editor.saved : null));

// ---------- Adding attendees to an existing activity ----------

function openAddAttendees(activity) {
  addingFor.value = activity;
  addSelection.value = [];
  attendeeSearch.value = '';
  ensureMembers(activity.areaId);
}

const addCandidates = computed(() => {
  if (!addingFor.value) return [];
  const present = new Set(addingFor.value.attendees.map((attendee) => attendee.memberId).filter(Boolean));
  const query = attendeeSearch.value.trim().toLowerCase();
  return (memberCache.value[addingFor.value.areaId] ?? [])
    .filter((member) => !present.has(member.memberId))
    .filter((member) => !query || `${member.name} ${member.memberId} ${member.area}`.toLowerCase().includes(query))
    .slice(0, 300);
});

async function confirmAddAttendees() {
  const activity = addingFor.value;
  if (!activity || !addSelection.value.length) return;
  try {
    const updated = await updateActivityAttendees(activity.id, { add: addSelection.value });
    replaceActivity(updated);
    addingFor.value = null;
    // Added in Oracle means added in OGD too, when the activity is there.
    if (updated.isInOgd && updated.pendingInOgd) sendAttendees(updated);
  } catch (error) {
    actionErrors.value = { ...actionErrors.value, [activity.id]: error.message };
    addingFor.value = null;
  }
}

function detailEntries(activity) {
  return Object.entries(activity.details ?? {}).filter(([, value]) => value);
}

onMounted(load);
onBeforeUnmount(() => {
  isActive = false;
  if (progressTimer) clearInterval(progressTimer);
});
</script>

<template>
  <div class="page">
    <PageHead title="Activities" subtitle="Every chapter activity from OGD with its attendees, plus new activities you create here and push to OGD.">
      <button v-if="loadState.status === 'success' && chapters.length" class="btn" :disabled="!readyCount || isBusy" @click="syncAll">
        <RefreshCw :size="14" />{{ isSyncingAll ? 'Syncing…' : 'Sync from OGD' }}
      </button>
      <button v-if="loadState.status === 'success' && chapters.length" class="btn btn-primary" @click="openNew"><CalendarPlus :size="14" />New Activity</button>
    </PageHead>

    <div class="controls">
      <label class="field date"><span class="field-label">From</span><input v-model="range.from" type="date" class="input" :max="range.to" :disabled="isBusy" @change="applyRange" /></label>
      <label class="field date"><span class="field-label">Until</span><input v-model="range.to" type="date" class="input" :min="range.from" :disabled="isBusy" @change="applyRange" /></label>
      <div class="presets">
        <button v-for="preset in PRESETS" :key="preset.label" class="btn btn-sm" :disabled="isBusy" @click="applyPreset(preset)">{{ preset.label }}</button>
      </div>
    </div>
    <p class="muted small range-note">Showing activities that start from {{ range.from }} until {{ range.to }}. Sync from OGD reads the same range.</p>

    <p v-if="isBusy" class="notice">Each chapter signs in to OGD and opens every activity in the range for its details and attendees, which can take a few minutes. Keep this page open until it finishes.</p>

    <section class="card">
      <div class="card-pad section-head"><h2 class="section-title">Chapters</h2></div>
      <LoadingBlock v-if="loadState.status === 'loading'" />
      <div v-else-if="loadState.status === 'error'" class="card-pad stack">
        <p class="text-danger">{{ loadState.message }}</p>
        <div><button class="btn btn-sm" @click="load">Try again</button></div>
      </div>
      <DataTable v-else :columns="chapterColumns" :rows="chapters" row-key="areaId" :initial-sort="{ key: 'chapter', ascending: true }" empty-text="No chapters are assigned to your account yet.">
        <template #cell-sector="{ value }">{{ value || '—' }}</template>
        <template #cell-chapter="{ value }"><span class="strong">{{ value }}</span></template>
        <template #cell-sync="{ row }">
          <div class="status">
            <span class="pill" :class="syncStatus(row).tone">{{ syncStatus(row).label }}</span>
            <p v-if="row.sync && !runningIds.has(row.areaId)" class="muted tiny">{{ formatDateTime(row.sync.syncedAt) }}</p>
            <p v-if="row.sync?.status === 'failed' && FAILURE_MESSAGES[row.sync.failureCode]" class="small text-danger">{{ FAILURE_MESSAGES[row.sync.failureCode] }}</p>
            <p v-if="row.sync?.statusDetail" class="muted tiny detail">{{ row.sync.statusDetail }}</p>
            <p v-if="rowErrors[row.areaId]" class="small text-danger">{{ rowErrors[row.areaId] }}</p>
          </div>
        </template>
        <template #cell-range="{ row }"><span class="nowrap">{{ row.sync ? `${row.sync.from} to ${row.sync.to}` : '—' }}</span></template>
        <template #cell-actions="{ row }">
          <button v-if="row.isReady && !runningIds.has(row.areaId) && !isSyncingAll" class="link-btn" @click="syncChapter(row.areaId)"><RefreshCw :size="13" />Sync</button>
          <span v-else-if="!row.isReady" class="muted tiny">Save its Gmail and OGD login under OGD Accounts first.</span>
        </template>
      </DataTable>
    </section>

    <section v-if="loadState.status === 'success' && chapters.length" class="card card-pad stack">
      <div class="section-head sub">
        <div>
          <h2 class="section-title">OGD New Activity form</h2>
          <p class="muted small">Oracle opens OGD's New Activity form, tries every Type to see which extra fields each one asks for (like Formation), and saves them here. Nothing is saved in OGD.</p>
        </div>
        <div class="row gap">
          <select v-if="chapters.filter((row) => row.isReady).length > 1" v-model.number="formChapterId" class="select select-sm" :disabled="isReadingForm">
            <option v-for="row in chapters.filter((entry) => entry.isReady)" :key="row.areaId" :value="row.areaId">{{ row.chapter }}</option>
          </select>
          <button class="btn btn-sm" :disabled="isReadingForm || !readyCount" @click="readForm"><RefreshCw :size="13" />{{ isReadingForm ? 'Reading OGD form…' : (ogdForm ? 'Read again' : 'Read form from OGD') }}</button>
        </div>
      </div>
      <p v-if="isReadingForm" class="notice">Signing in to OGD and trying each Type on the New Activity form. This takes a minute or two; keep this page open.</p>
      <p v-if="formError" class="small text-danger">{{ formError }}</p>
      <template v-if="formChapterId && chapterById.get(formChapterId)?.formRead?.status === 'failed' && !isReadingForm">
        <p class="small text-danger">{{ FAILURE_MESSAGES[chapterById.get(formChapterId).formRead.failureCode] || 'Reading the form failed.' }}</p>
        <p v-if="chapterById.get(formChapterId).formRead.statusDetail" class="muted tiny detail wide">{{ chapterById.get(formChapterId).formRead.statusDetail }}</p>
      </template>
      <template v-if="ogdForm">
        <p class="small">Read {{ formatDateTime(ogdForm.capturedAt) }}<template v-if="formSummary.chapter"> from {{ formSummary.chapter }}</template>: {{ formSummary.types }} types, {{ formSummary.withExtras }} with extra fields.<template v-if="ogdForm.isPartial"> Not every choice fit in one run; read it again for the rest.</template></p>
        <p v-if="formChapterId && chapterById.get(formChapterId)?.formRead?.statusDetail && chapterById.get(formChapterId)?.formRead?.status === 'read'" class="muted tiny detail wide">{{ chapterById.get(formChapterId).formRead.statusDetail }}</p>
        <div><button class="link-btn" @click="showFormFields = !showFormFields">{{ showFormFields ? 'Hide fields' : 'Show fields' }}</button></div>
        <div v-if="showFormFields" class="form-fields stack">
          <div>
            <p class="field-label">Always on the form</p>
            <p class="small">{{ ogdForm.fields.map((field) => field.label + (field.required ? ' *' : '')).join(' · ') }}</p>
          </div>
          <div v-for="(fields, key) in ogdForm.dependents" :key="key">
            <p class="field-label">{{ key.replaceAll('::', ' = ').replaceAll(' >> ', ', then ') }}</p>
            <p class="small">{{ fields.map((field) => `${field.label}${field.options?.length ? ` (${choicesOf(field).map((option) => option.text).slice(0, 12).join(', ')}${choicesOf(field).length > 12 ? ', …' : ''})` : ''}`).join(' · ') }}</p>
          </div>
          <p v-if="!Object.keys(ogdForm.dependents ?? {}).length" class="muted small">No Type brought extra fields.</p>
        </div>
      </template>
      <p v-else-if="!isReadingForm" class="muted small">Not read yet. Until it is, New Activity offers the usual types and no extra fields.</p>
    </section>

    <section v-if="loadState.status === 'success'" class="card">
      <div class="card-pad section-head">
        <h2 class="section-title">Activities ({{ totals.activities }}) · {{ totals.attendance }} attendance · {{ totals.members }} members</h2>
        <div class="row gap">
          <button class="btn btn-sm" :disabled="!visibleActivities.length" @click="exportActivities"><Download :size="14" />Activities CSV</button>
          <button class="btn btn-sm" :disabled="!visibleActivities.length" @click="exportAttendees()"><Download :size="14" />Attendees CSV</button>
        </div>
      </div>
      <div class="card-pad filters">
        <SearchInput v-model="search" placeholder="Search activity, venue, leader or attendee..." />
        <select v-if="chapters.length > 1" v-model="chapterFilter" class="select" aria-label="Chapter">
          <option value="">All chapters</option>
          <option v-for="row in chapters" :key="row.areaId" :value="String(row.areaId)">{{ row.chapter }}</option>
        </select>
        <select v-model="typeFilter" class="select" aria-label="Type">
          <option value="">All types</option>
          <option v-for="type in typeOptions" :key="type" :value="type">{{ type }}</option>
        </select>
      </div>
      <DataTable
        :columns="activityColumns" :rows="visibleActivities" row-key="id" clickable :expanded-key="expandedId"
        :initial-sort="{ key: 'startsAt', ascending: false }"
        :empty-text="activities.length ? 'No activities match your filters.' : 'No activities in this range yet. Sync from OGD, or create one.'"
        @row-click="(row) => (expandedId = expandedId === row.id ? null : row.id)"
      >
        <template #cell-name="{ row }"><span class="strong link-like">{{ row.name }}</span></template>
        <template #cell-startsAt="{ row }"><span class="nowrap">{{ formatWhen(row.startsAt) }}</span></template>
        <template #cell-endsAt="{ row }"><span class="nowrap">{{ formatWhen(row.endsAt) }}</span></template>
        <template #cell-attendance="{ row }"><span class="nowrap">{{ attendeeCount(row) }} member{{ attendeeCount(row) === 1 ? '' : 's' }}</span></template>
        <template #cell-status="{ row }">
          <span class="pill" :class="statusOf(row).tone">{{ statusOf(row).label }}</span>
          <span v-if="sendingIds.has(row.id)" class="pill info tiny-pill">adding attendees…</span>
          <span v-else-if="row.pendingInOgd" class="pill warning tiny-pill" :title="`${row.pendingInOgd} attendee(s) not in OGD yet`">{{ row.pendingInOgd }} not in OGD</span>
        </template>
        <template #expanded="{ row }">
          <div class="expanded stack" @click.stop>
            <div class="detail-grid">
              <div><span class="muted tiny">Chapter</span><p>{{ chapterById.get(row.areaId)?.chapter ?? '—' }}</p></div>
              <div><span class="muted tiny">Description</span><p>{{ row.description || '—' }}</p></div>
              <div v-for="[label, value] in Object.entries(row.ogdFields ?? {})" :key="`f-${label}`"><span class="muted tiny">{{ label }}</span><p>{{ Array.isArray(value) ? value.join(', ') : (value === true ? 'Yes' : value) }}</p></div>
              <div v-for="[label, value] in detailEntries(row)" :key="label"><span class="muted tiny">{{ label }}</span><p>{{ value }}</p></div>
              <div v-if="row.syncedAt"><span class="muted tiny">Read from OGD</span><p>{{ formatDateTime(row.syncedAt) }}</p></div>
            </div>

            <div class="links stack">
              <div class="link-row">
                <span class="muted tiny label">Attendance link</span>
                <code class="url">{{ attendanceLink(row) }}</code>
                <button class="btn btn-sm" @click="copy(attendanceLink(row), `a${row.id}`)"><component :is="copied === `a${row.id}` ? Check : Copy" :size="13" />{{ copied === `a${row.id}` ? 'Copied' : 'Copy' }}</button>
              </div>
              <div v-if="row.ogdUrl" class="link-row">
                <span class="muted tiny label">OGD link</span>
                <code class="url">{{ row.ogdUrl }}</code>
                <button class="btn btn-sm" @click="copy(row.ogdUrl, `o${row.id}`)"><component :is="copied === `o${row.id}` ? Check : Copy" :size="13" />{{ copied === `o${row.id}` ? 'Copied' : 'Copy' }}</button>
                <a class="btn btn-sm" :href="row.ogdUrl" target="_blank" rel="noopener"><ExternalLink :size="13" />Open</a>
              </div>
              <p class="muted tiny">Members open the attendance link, enter their Member ID and last name, and are added below. OGD links need an OGD login.</p>
            </div>

            <div v-if="row.source === 'oracle'" class="stack">
              <p v-if="row.pushStatus === 'failed' && !pushingIds.has(row.id)" class="small text-danger">{{ FAILURE_MESSAGES[row.pushFailureCode] || 'The push to OGD failed.' }}</p>
              <p v-if="row.pushDetail" class="muted tiny detail wide">{{ row.pushDetail }}</p>
              <div class="row gap">
                <button v-if="row.pushStatus !== 'pushed'" class="btn btn-sm btn-primary" :disabled="pushingIds.has(row.id) || !chapterById.get(row.areaId)?.isReady" @click="push(row)">
                  <Send :size="13" />{{ pushingIds.has(row.id) ? 'Pushing to OGD…' : (row.pushStatus === 'failed' ? 'Try push again' : 'Push to OGD') }}
                </button>
                <button v-if="row.pushStatus !== 'pushed'" class="btn btn-sm" :disabled="pushingIds.has(row.id)" @click="openEdit(row)"><Pencil :size="13" />Edit</button>
                <button v-if="row.pushStatus !== 'pushed'" class="btn btn-sm danger" :disabled="pushingIds.has(row.id)" @click="remove(row)"><Trash2 :size="13" />Delete</button>
              </div>
              <PushProgress v-if="progressOf('activity', row)" :view="progressOf('activity', row)" note="Creating the activity in OGD. Its attendees follow right after." />
            </div>
            <div class="row gap"><button class="btn btn-sm" @click="openDuplicate(row)"><CopyPlus :size="13" />Duplicate</button><span class="muted tiny">A new activity with the same details and attendees; change the title, type and dates.</span></div>
            <p v-if="actionErrors[row.id]" class="small text-danger">{{ actionErrors[row.id] }}</p>

            <div class="section-head sub">
              <h3 class="section-title small-title">Attendees ({{ row.attendees.length }}<template v-if="row.attendanceCount && row.attendanceCount !== row.attendees.length"> listed, OGD counts {{ row.attendanceCount }}</template>)</h3>
              <div class="row gap">
                <button v-if="row.isInOgd && (row.pendingInOgd || sendingIds.has(row.id))" class="btn btn-sm btn-primary" :disabled="sendingIds.has(row.id) || !chapterById.get(row.areaId)?.isReady" @click="sendAttendees(row)">
                  <Send :size="13" />{{ sendingIds.has(row.id) ? 'Adding in OGD…' : `Add ${row.pendingInOgd} to OGD` }}
                </button>
                <button class="btn btn-sm" @click="openAddAttendees(row)"><UserPlus :size="13" />Add attendees</button>
                <button class="btn btn-sm" :disabled="!row.attendees.length" @click="exportAttendees([row])"><Download :size="13" />CSV</button>
              </div>
            </div>
            <PushProgress v-if="sendingIds.has(row.id) && progressOf('attendees', row)" :view="progressOf('attendees', row)" note="Adding the attendees to this activity in OGD. Keep this page open." />
            <template v-else-if="row.attendeePushStatus && row.attendeePushStatus !== 'pushing'">
              <p v-if="row.attendeePushStatus === 'pushed'" class="small text-success">Attendees added in OGD {{ formatDateTime(row.attendeesPushedAt) }}.</p>
              <p v-else class="small text-danger">{{ FAILURE_MESSAGES[row.attendeePushFailureCode] || 'Some attendees could not be added in OGD.' }}<template v-if="row.pendingInOgd"> Use "Add {{ row.pendingInOgd }} to OGD" to try again.</template></p>
              <p v-if="row.attendeePushDetail" class="muted tiny detail wide">{{ row.attendeePushDetail }}</p>
            </template>
            <p v-if="row.isInOgd && row.pendingInOgd && !chapterById.get(row.areaId)?.isReady" class="muted tiny">This chapter needs its OGD login before attendees can be added in OGD.</p>
            <div v-if="row.attendees.length" class="table-scroll">
              <table class="mini">
                <thead><tr><th>#</th><th>Name</th><th>Member ID</th><th>Area</th><th>Service</th><th>Added by</th><th>In OGD</th><th></th></tr></thead>
                <tbody>
                  <tr v-for="(attendee, index) in row.attendees" :key="attendeeKey(attendee)">
                    <td>{{ index + 1 }}</td>
                    <td class="strong">{{ attendee.name }}<span v-if="!attendee.matched" class="pill warning tiny-pill" title="Not found in Oracle's members list">not in members</span></td>
                    <td class="nowrap">{{ attendee.memberId || '—' }}</td>
                    <td>{{ attendee.area || '—' }}</td>
                    <td>{{ attendee.service || '—' }}</td>
                    <td>{{ SOURCE_LABELS[attendee.source] ?? attendee.source }}</td>
                    <td><span class="pill tiny-pill" :class="ogdStateOf(row, attendee).tone" :title="attendee.ogdNote || ''">{{ ogdStateOf(row, attendee).label }}</span></td>
                    <td><button v-if="attendee.source !== 'ogd' && attendee.ogd !== 'added'" class="icon-btn" aria-label="Remove attendee" @click="removeAttendee(row, attendee)"><X :size="14" /></button></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="muted small">{{ row.source === 'ogd' ? 'No attendees were read from OGD for this activity yet. Sync again to fetch them.' : 'No attendees yet. Share the attendance link or add them here.' }}</p>
          </div>
        </template>
      </DataTable>
    </section>

    <AppModal v-if="editor.open" :title="editor.saved ? 'Activity saved' : (editor.form.id ? 'Edit Activity' : (editor.copiedFrom ? 'Duplicate Activity' : 'New Activity'))" :width="720" :locked="editor.saving" @close="editor.open = false">
      <div v-if="savedActivity" class="stack">
        <p><span class="strong">{{ savedActivity.name }}</span> · {{ formatWhen(savedActivity.startsAt) }}</p>
        <div class="link-row">
          <span class="muted tiny label">Attendance link</span>
          <code class="url">{{ attendanceLink(savedActivity) }}</code>
          <button class="btn btn-sm" @click="copy(attendanceLink(savedActivity), 'saved-a')"><component :is="copied === 'saved-a' ? Check : Copy" :size="13" />{{ copied === 'saved-a' ? 'Copied' : 'Copy' }}</button>
        </div>
        <div v-if="savedActivity.ogdUrl" class="link-row">
          <span class="muted tiny label">OGD link</span>
          <code class="url">{{ savedActivity.ogdUrl }}</code>
          <button class="btn btn-sm" @click="copy(savedActivity.ogdUrl, 'saved-o')"><component :is="copied === 'saved-o' ? Check : Copy" :size="13" />{{ copied === 'saved-o' ? 'Copied' : 'Copy' }}</button>
        </div>
        <PushProgress v-if="pushingIds.has(savedActivity.id) && progressOf('activity', savedActivity)" :view="progressOf('activity', savedActivity)" note="Creating the activity in OGD. Keep this open." />
        <PushProgress v-if="sendingIds.has(savedActivity.id) && progressOf('attendees', savedActivity)" :view="progressOf('attendees', savedActivity)" note="Created in OGD. Now adding its attendees there; you can close this, it keeps going while this page is open." />
        <p v-else-if="savedActivity.pushStatus === 'pushed'" class="small text-success">Created in OGD. {{ savedActivity.pushDetail }}</p>
        <template v-else-if="savedActivity.pushStatus === 'failed'">
          <p class="small text-danger">{{ FAILURE_MESSAGES[savedActivity.pushFailureCode] || 'The push to OGD failed.' }} The activity is saved in Oracle; you can push it again from the list.</p>
          <p v-if="savedActivity.pushDetail" class="muted tiny detail wide">{{ savedActivity.pushDetail }}</p>
        </template>
        <p v-else-if="actionErrors[savedActivity.id]" class="small text-danger">{{ actionErrors[savedActivity.id] }}</p>
        <p v-else class="muted small">Saved in Oracle only. Use Push to OGD in the list when you're ready.</p>
      </div>
      <form v-else class="stack" @submit.prevent="submitEditor">
        <p v-if="editor.copiedFrom" class="notice">Copied from <span class="strong">{{ editor.copiedFrom.name }}</span> with {{ editor.form.attendeeIds.length }} attendee{{ editor.form.attendeeIds.length === 1 ? '' : 's' }}. Change the title, type and dates, then save.<template v-if="editor.copiedFrom.skipped"> {{ editor.copiedFrom.skipped }} attendee{{ editor.copiedFrom.skipped === 1 ? ' has' : 's have' }} no Member ID and {{ editor.copiedFrom.skipped === 1 ? 'was' : 'were' }} not copied.</template></p>
        <div class="grid2">
          <label v-if="chapters.length > 1 && !editor.form.id" class="field"><span class="field-label">Chapter</span>
            <select v-model.number="editor.form.areaId" class="select" @change="changeEditorChapter">
              <option v-for="row in chapters" :key="row.areaId" :value="row.areaId">{{ row.chapter }}</option>
            </select>
          </label>
          <label class="field span2"><span class="field-label">Activity Name *</span><input v-model="editor.form.name" class="input" maxlength="200" required placeholder="e.g. Chapter Assembly" /></label>
          <label class="field"><span class="field-label">Type</span>
            <select v-model="editor.form.activityType" class="select">
              <option value="">Choose a type…</option>
              <option v-for="type in editorTypeChoices" :key="type" :value="type">{{ type }}</option>
            </select>
          </label>
          <label class="field"><span class="field-label">Area</span>
            <select v-if="formAreaField" v-model="editor.form.areaName" class="select">
              <option value="">Choose an area…</option>
              <option v-for="option in choicesOf(formAreaField)" :key="option.value" :value="option.text">{{ option.text }}</option>
            </select>
            <select v-else v-model="editor.form.areaName" class="select">
              <option value="">Choose an area…</option>
              <option v-for="area in editorAreaChoices" :key="area" :value="area">{{ area }}</option>
            </select>
          </label>
          <div v-if="!ogdForm && editor.form.activityType" class="extra span2 stack">
            <p class="small">OGD's extra fields for {{ editor.form.activityType }} (like Formation and Talk(s)) haven't been read yet. Oracle reads them once from OGD's New Activity form and then shows them here.</p>
            <p v-if="isReadingForm" class="muted small">Reading OGD's form… this takes a few minutes. You can keep filling in the rest.</p>
            <p v-if="formError" class="small text-danger">{{ formError }}</p>
            <div><button type="button" class="btn btn-sm" :disabled="isReadingForm || !readyCount" @click="readFormFromEditor"><RefreshCw :size="13" />{{ isReadingForm ? 'Reading OGD form…' : 'Read form from OGD' }}</button></div>
          </div>
          <div v-if="extraFields.length" class="extra span2">
            <p class="field-label">{{ editor.form.activityType }} details (OGD asks for these)</p>
            <div class="grid2">
              <div v-for="field in extraFields" :key="field.uid" class="field" :class="{ span2: ['checkboxes', 'multiselect', 'radio', 'textarea'].includes(field.kind) }">
                <span class="field-label">{{ field.label }}<template v-if="field.required"> *</template></span>
                <select v-if="field.kind === 'select'" v-model="editor.form.ogdFields[field.label]" class="select">
                  <option :value="undefined">Choose…</option>
                  <option v-for="option in choicesOf(field)" :key="option.value" :value="option.text">{{ option.text }}</option>
                </select>
                <div v-else-if="field.kind === 'checkboxes' || field.kind === 'multiselect'" class="choice-list">
                  <label v-for="option in choicesOf(field)" :key="option.value + option.text" class="row gap check">
                    <input type="checkbox" :checked="(editor.form.ogdFields[field.label] ?? []).includes(option.text)" @change="toggleExtraChoice(field.label, option.text)" /><span>{{ option.text }}</span>
                  </label>
                </div>
                <div v-else-if="field.kind === 'radio'" class="choice-list">
                  <label v-for="option in field.options" :key="option.value + option.text" class="row gap check">
                    <input v-model="editor.form.ogdFields[field.label]" type="radio" :value="option.text" /><span>{{ option.text }}</span>
                  </label>
                </div>
                <label v-else-if="field.kind === 'checkbox'" class="row gap check"><input v-model="editor.form.ogdFields[field.label]" type="checkbox" /><span>Yes</span></label>
                <textarea v-else-if="field.kind === 'textarea'" v-model="editor.form.ogdFields[field.label]" class="input" rows="2" />
                <input v-else v-model="editor.form.ogdFields[field.label]" class="input" :type="['date', 'number', 'time'].includes(field.kind) ? field.kind : 'text'" />
              </div>
            </div>
          </div>
          <label class="field"><span class="field-label">Start *</span><input v-model="editor.form.start" type="datetime-local" class="input" required /></label>
          <label class="field"><span class="field-label">End</span><input v-model="editor.form.end" type="datetime-local" class="input" :min="editor.form.start" /></label>
          <label class="field"><span class="field-label">Team Leader</span>
            <input v-model="editor.form.teamLeader" class="input" list="activity-leaders" placeholder="LASTNAME, FIRSTNAME" @input="onLeaderInput" />
            <datalist id="activity-leaders"><option v-for="member in editorMembers" :key="member.memberId" :value="member.name" /></datalist>
          </label>
          <label class="field"><span class="field-label">Venue</span><input v-model="editor.form.venue" class="input" maxlength="300" /></label>
          <label class="field span2"><span class="field-label">Description</span><textarea v-model="editor.form.description" class="input" rows="2" maxlength="2000" /></label>
        </div>
        <p class="muted tiny">Times are Philippine time. Type and Area must match a choice in OGD's New Activity form for the push to work.</p>

        <div class="stack picker">
          <div class="section-head"><span class="field-label">Attendees ({{ editor.form.attendeeIds.length }} selected)</span></div>
          <SearchInput v-model="memberSearch" placeholder="Search members by name, ID or area..." />
          <LoadingBlock v-if="membersState.status === 'loading' && !editorMembers.length" variant="text" :rows="3" />
          <p v-else-if="membersState.status === 'error'" class="small text-danger">{{ membersState.message }}</p>
          <div v-else class="member-list">
            <label v-for="member in pickerMembers" :key="member.memberId" class="member-option">
              <input type="checkbox" :checked="editor.form.attendeeIds.includes(member.memberId)" @change="toggleAttendee(member.memberId)" />
              <span class="grow">{{ member.name }}</span><span class="muted tiny">{{ member.memberId }} · {{ member.area }}</span>
            </label>
            <p v-if="!pickerMembers.length" class="muted small">No members match.</p>
          </div>
          <p class="muted tiny">You can also add attendees later, or share the attendance link so members add themselves.</p>
        </div>

        <label class="row gap check"><input v-model="editor.pushAfter" type="checkbox" :disabled="!chapterById.get(editor.form.areaId)?.isReady" />
          <span>Push to OGD after saving<span v-if="!chapterById.get(editor.form.areaId)?.isReady" class="muted tiny"> (this chapter needs its OGD login first)</span></span>
        </label>
        <p v-if="editor.error" class="small text-danger">{{ editor.error }}</p>
      </form>
      <template #footer>
        <template v-if="savedActivity">
          <button class="btn" :disabled="pushingIds.has(savedActivity.id)" @click="editor.open = false">Done</button>
        </template>
        <template v-else>
          <button class="btn" :disabled="editor.saving" @click="editor.open = false">Cancel</button>
          <button class="btn btn-primary" :disabled="editor.saving" @click="submitEditor">{{ editor.saving ? 'Saving…' : (editor.pushAfter && chapterById.get(editor.form.areaId)?.isReady ? 'Save and push to OGD' : 'Save') }}</button>
        </template>
      </template>
    </AppModal>

    <AppModal v-if="addingFor" title="Add attendees" :subtitle="addingFor.name" :width="560" @close="addingFor = null">
      <div class="stack">
        <SearchInput v-model="attendeeSearch" placeholder="Search members by name, ID or area..." />
        <LoadingBlock v-if="membersState.status === 'loading' && !memberCache[addingFor.areaId]" variant="text" :rows="3" />
        <div v-else class="member-list">
          <label v-for="member in addCandidates" :key="member.memberId" class="member-option">
            <input v-model="addSelection" type="checkbox" :value="member.memberId" />
            <span class="grow">{{ member.name }}</span><span class="muted tiny">{{ member.memberId }} · {{ member.area }}</span>
          </label>
          <p v-if="!addCandidates.length" class="muted small">No members to add.</p>
        </div>
      </div>
      <template #footer>
        <button class="btn" @click="addingFor = null">Cancel</button>
        <button class="btn btn-primary" :disabled="!addSelection.length" @click="confirmAddAttendees">Add {{ addSelection.length || '' }}</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.controls { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px 16px; }
.date { width: 170px; max-width: 100%; }
.presets { display: flex; flex-wrap: wrap; gap: 6px; padding-bottom: 2px; }
.range-note { margin: -4px 0 0; }
.section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding-bottom: 0; }
.section-head.sub { padding: 0; }
.section-title { font-size: 15px; font-weight: var(--fw-heading); margin: 0; }
.small-title { font-size: 14px; }
.filters { display: flex; flex-wrap: wrap; gap: 8px; padding-top: 12px; padding-bottom: 12px; }
.filters > :first-child { flex: 1 1 260px; }
.filters .select { width: auto; min-width: 150px; }
.status { text-align: left; min-width: 150px; }
.tiny { font-size: 11px; margin-top: 2px; }
.detail { max-width: 380px; max-height: 6em; overflow: auto; word-break: break-word; }
.detail.wide { max-width: none; }
.gap { gap: 8px; flex-wrap: wrap; }
.link-like { color: var(--accent); }
.expanded { padding: 12px 4px; text-align: left; cursor: default; }
.detail-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px 16px; }
.detail-grid p { margin: 2px 0 0; word-break: break-word; }
.links { padding: 10px 12px; background: var(--accent-soft); border-radius: var(--radius-sm); gap: 6px; }
.link-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.link-row .label { min-width: 100px; }
.url { flex: 1 1 240px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; padding: 4px 8px; background: var(--surface); border-radius: 6px; }
.table-scroll { overflow-x: auto; }
.mini { width: 100%; border-collapse: collapse; font-size: 13px; }
.mini th, .mini td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
.mini th { font-size: 12px; color: var(--muted); font-weight: 600; }
.tiny-pill { margin-left: 6px; font-size: 10px; padding: 1px 6px; }
.danger { color: var(--danger); }
.select-sm { width: auto; min-width: 140px; padding: 5px 8px; font-size: 13px; }
.extra { border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 12px; }
.choice-list { display: flex; flex-wrap: wrap; gap: 6px 16px; }
.form-fields > div { border-top: 1px solid var(--line); padding-top: 8px; }
.grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.span2 { grid-column: 1 / -1; }
@media (max-width: 600px) { .grid2 { grid-template-columns: 1fr; } }
.picker { border-top: 1px solid var(--line); padding-top: 12px; }
.member-list { max-height: 260px; overflow-y: auto; border: 1px solid var(--line); border-radius: var(--radius-sm); }
.member-option { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-bottom: 1px solid var(--line); cursor: pointer; font-size: 13px; }
.member-option:last-child { border-bottom: 0; }
.check { align-items: flex-start; font-size: 14px; }
</style>
