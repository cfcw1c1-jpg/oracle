import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { ActionLink, EmptyRow, Pill, TableCard, TablePagination, TableRow, usePagination } from '../components/admin-table';
import {
  deleteActivity, fetchActivities, fetchActivityMembers, pushActivity, pushActivityAttendees, saveActivity, siteUrl, syncActivities,
  updateActivityAttendees,
} from '../lib/ogdApi';
import { FAILURE_MESSAGES, formatDateTime } from './OgdConnections';

// The phone version of the web app's Activities page: OGD activities for a
// date range with their attendees, syncing from OGD, creating activities and
// pushing them to OGD, and adding attendees (who are then added in OGD too).

const TZ = 'Asia/Manila';
const PAGE_SIZE_OPTIONS = [10, 20, 50];
const WIDE_LAYOUT_MIN_WIDTH = 860;
// Each chapter signs in to OGD in its own browser, so only a couple run at once.
const CONCURRENT_RUNS = 2;
const DEFAULT_TYPES = ['CHAPTER PRAYER ASSEMBLY', 'FORMATION', 'MISSION', 'FIG ACTIVITY', 'HOUSEHOLD MEETING', 'TEAMBUILDING', 'EVANGELIZATION'];
const SOURCE_LABELS = { ogd: 'OGD', oracle: 'Oracle', link: 'Attendance link' };
const TONES = {
  success: { color: '#15803d', bg: '#dcfce7' },
  warning: { color: '#b45309', bg: '#fef3c7' },
  danger: { color: '#b91c1c', bg: '#fee2e2' },
  info: { color: '#1d4ed8', bg: '#dbeafe' },
  plain: { color: '#475569', bg: '#f1f5f9' },
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const WHEN = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})$/;

// ---------- Dates (Manila) ----------

function manilaDay(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function addMonths(day, months) {
  const [year, month] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 + months, 1)).toISOString().slice(0, 10);
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
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}
// "YYYY-MM-DD HH:MM" in Manila time, for typing in a text box.
function toWhenText(iso) {
  if (!iso) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}
function fromWhenText(text) {
  const match = WHEN.exec(String(text).trim());
  if (!match) return null;
  const date = new Date(`${match[1]}T${match[2].padStart(2, '0')}:${match[3]}:00+08:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// ---------- Helpers ----------

function attendeeKey(attendee) {
  return attendee.memberId ? `id:${attendee.memberId.toUpperCase()}` : `name:${String(attendee.name).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()}`;
}
function attendeeCount(activity) {
  return Math.max(activity.attendees.length, activity.attendanceCount ?? 0);
}
function attendanceLink(activity) {
  return siteUrl(`/activity-attendance?token=${activity.publicToken}`);
}
function confirmAction(title, message, onConfirm) {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Confirm', style: 'destructive', onPress: onConfirm },
  ]);
}
async function shareLink(url, title) {
  if (Platform.OS === 'web') {
    try {
      await navigator.clipboard.writeText(url);
      window.alert('Link copied.');
    } catch {
      window.prompt('Copy this link:', url);
    }
    return;
  }
  Share.share({ message: url, title }).catch(() => null);
}
function without(set, id) {
  const next = new Set(set);
  next.delete(id);
  return next;
}

function isPlaceholder(text) {
  return !text || /^-+|^select\b|^choose\b|^show all/i.test(String(text).trim());
}

// The extra fields for the form's chosen Type, and those its own lists bring.
function extraFieldsFor(ogdForm, form) {
  if (!ogdForm?.typeFieldLabel || !form.activityType) return [];
  const shown = [];
  const visit = (key, depth) => {
    for (const field of ogdForm.dependents?.[key] ?? []) {
      shown.push({ ...field, depth, uid: `${key}|${field.id}` });
      const value = form.ogdFields?.[field.label];
      if ((field.kind === 'select' || field.kind === 'radio') && value && depth < 3) visit(`${key} >> ${field.label}::${value}`, depth + 1);
    }
  };
  visit(`${ogdForm.typeFieldLabel}::${form.activityType}`, 0);
  return shown;
}

function TonePill({ label, tone = 'plain' }) {
  const style = TONES[tone] ?? TONES.plain;
  return <Pill label={label} color={style.color} bg={style.bg} />;
}

function Chip({ label, active, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.chip, active && styles.chipActive]} accessibilityRole="button">
      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

function Button({ label, icon, onPress, disabled, busy, kind = 'plain' }) {
  const isPrimary = kind === 'primary';
  const isDanger = kind === 'danger';
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || busy}
      style={[styles.button, isPrimary && styles.buttonPrimary, (disabled || busy) && styles.buttonDisabled]}
      accessibilityRole="button"
    >
      {busy
        ? <ActivityIndicator size="small" color={isPrimary ? '#fff' : '#2563eb'} />
        : !!icon && <Ionicons name={icon} size={14} color={isPrimary ? '#fff' : isDanger ? '#b91c1c' : '#2563eb'} />}
      <Text style={[styles.buttonText, isPrimary && styles.buttonTextPrimary, isDanger && styles.buttonTextDanger]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Field({ label, children, hint }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
      {!!hint && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

// ---------- Screen ----------

export default function Activities() {
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_LAYOUT_MIN_WIDTH;

  const [range, setRange] = useState({ from: addMonths(today, -2), to: today });
  const [draft, setDraft] = useState({ from: addMonths(today, -2), to: today });
  const [chapters, setChapters] = useState([]);
  const [activities, setActivities] = useState([]);
  const [knownTypes, setKnownTypes] = useState([]);
  // OGD's New Activity form as read on the web page: its Type choices and the extra fields each brings.
  const [ogdForm, setOgdForm] = useState(null);
  const [loadState, setLoadState] = useState({ status: 'loading', message: '' });
  const [reloadCount, setReloadCount] = useState(0);
  const [search, setSearch] = useState('');
  const [chapterFilter, setChapterFilter] = useState(null);
  const [showChapters, setShowChapters] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [runningIds, setRunningIds] = useState(() => new Set());
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [syncErrors, setSyncErrors] = useState({});
  const [pushingIds, setPushingIds] = useState(() => new Set());
  const [sendingIds, setSendingIds] = useState(() => new Set());
  const [actionErrors, setActionErrors] = useState({});
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);
  const [memberCache, setMemberCache] = useState({});
  const [editor, setEditor] = useState(null);
  const [adding, setAdding] = useState(null);
  const isMountedRef = useRef(true);
  const chaptersRef = useRef([]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const reload = useCallback(() => setReloadCount((count) => count + 1), []);

  useEffect(() => {
    let isCurrent = true;
    fetchActivities(range.from, range.to)
      .then((result) => {
        if (!isCurrent) return;
        setChapters(result.chapters);
        chaptersRef.current = result.chapters;
        setActivities(result.activities);
        setKnownTypes(result.types ?? []);
        setOgdForm(result.form ?? null);
        setLoadState({ status: 'success', message: '' });
      })
      .catch((error) => {
        if (isCurrent) setLoadState({ status: 'error', message: error.message });
      });
    return () => {
      isCurrent = false;
    };
  }, [range, reloadCount]);

  const chapterById = useMemo(() => new Map(chapters.map((chapter) => [chapter.areaId, chapter])), [chapters]);
  const typeOptions = useMemo(() => {
    const typeField = ogdForm?.fields?.find((field) => field.label === ogdForm.typeFieldLabel);
    if (typeField) return typeField.options.map((option) => option.text).filter((text) => !isPlaceholder(text));
    return [...new Set([...DEFAULT_TYPES, ...knownTypes])].sort();
  }, [knownTypes, ogdForm]);
  const isReady = useCallback((areaId) => Boolean(chapterById.get(areaId)?.isReady), [chapterById]);

  const visibleActivities = useMemo(() => {
    const query = search.trim().toLowerCase();
    return activities.filter((activity) => (!chapterFilter || activity.areaId === chapterFilter)
      && (!query || [activity.name, activity.activityType, activity.areaName, activity.teamLeader, activity.venue, chapterById.get(activity.areaId)?.chapter]
        .some((value) => value?.toLowerCase().includes(query))
        || activity.attendees.some((attendee) => `${attendee.name} ${attendee.memberId ?? ''}`.toLowerCase().includes(query))));
  }, [activities, chapterFilter, search, chapterById]);

  const { page, pageCount, pageItems, setPage } = usePagination(visibleActivities, pageSize);

  function applyRange(next) {
    if (!DAY.test(next.from) || !DAY.test(next.to)) {
      setLoadState({ status: 'error', message: 'Please enter dates as YYYY-MM-DD.' });
      return;
    }
    setDraft(next);
    setRange(next);
    setLoadState({ status: 'loading', message: '' });
    setPage(1);
  }

  function replaceActivity(updated) {
    setActivities((current) => current.map((activity) => (activity.id === updated.id ? updated : activity)));
  }
  function setActionError(id, message) {
    setActionErrors((current) => ({ ...current, [id]: message }));
  }

  // ---------- Sync ----------

  const syncChapter = useCallback(async (areaId) => {
    setRunningIds((current) => new Set(current).add(areaId));
    setSyncErrors((current) => ({ ...current, [areaId]: null }));
    try {
      await syncActivities({ areaId, from: range.from, to: range.to });
    } catch (error) {
      if (isMountedRef.current) setSyncErrors((current) => ({ ...current, [areaId]: error.message }));
    } finally {
      if (isMountedRef.current) {
        setRunningIds((current) => without(current, areaId));
        reload();
      }
    }
  }, [range, reload]);

  async function syncAll() {
    const queue = chaptersRef.current.filter((chapter) => chapter.isReady).map((chapter) => chapter.areaId);
    setIsSyncingAll(true);
    async function worker() {
      while (queue.length && isMountedRef.current) await syncChapter(queue.shift());
    }
    try {
      await Promise.all(Array.from({ length: CONCURRENT_RUNS }, worker));
    } finally {
      if (isMountedRef.current) setIsSyncingAll(false);
    }
  }

  // ---------- Push and attendees ----------

  async function sendAttendees(activity) {
    if (sendingIds.has(activity.id) || !isReady(activity.areaId)) return;
    setSendingIds((current) => new Set(current).add(activity.id));
    setActionError(activity.id, null);
    try {
      const result = await pushActivityAttendees(activity.id);
      if (isMountedRef.current) replaceActivity(result.activity);
    } catch (error) {
      if (isMountedRef.current) {
        setActionError(activity.id, error.message);
        reload();
      }
    } finally {
      if (isMountedRef.current) setSendingIds((current) => without(current, activity.id));
    }
  }

  async function push(activity) {
    setPushingIds((current) => new Set(current).add(activity.id));
    setActionError(activity.id, null);
    try {
      const result = await pushActivity(activity.id);
      if (!isMountedRef.current) return result.activity;
      replaceActivity(result.activity);
      // Its attendees follow it into OGD.
      if (result.activity.pushStatus === 'pushed' && result.activity.pendingInOgd) sendAttendees(result.activity);
      return result.activity;
    } catch (error) {
      if (isMountedRef.current) {
        setActionError(activity.id, error.message);
        reload();
      }
      return null;
    } finally {
      if (isMountedRef.current) setPushingIds((current) => without(current, activity.id));
    }
  }

  function remove(activity) {
    confirmAction('Delete this activity?', `"${activity.name}" will be removed from Oracle. Its attendance link will stop working.`, async () => {
      try {
        await deleteActivity(activity.id);
        setActivities((current) => current.filter((entry) => entry.id !== activity.id));
      } catch (error) {
        setActionError(activity.id, error.message);
      }
    });
  }

  function removeAttendee(activity, attendee) {
    confirmAction('Remove this attendee?', `${attendee.name} will be removed from "${activity.name}" in Oracle.`, async () => {
      try {
        replaceActivity(await updateActivityAttendees(activity.id, { remove: [attendeeKey(attendee)] }));
      } catch (error) {
        setActionError(activity.id, error.message);
      }
    });
  }

  async function ensureMembers(areaId) {
    if (memberCache[areaId]) return;
    try {
      const members = await fetchActivityMembers(areaId);
      if (isMountedRef.current) setMemberCache((current) => ({ ...current, [areaId]: members }));
    } catch {
      if (isMountedRef.current) setMemberCache((current) => ({ ...current, [areaId]: [] }));
    }
  }

  function openAddAttendees(activity) {
    setAdding({ activity, selection: [], search: '', saving: false });
    ensureMembers(activity.areaId);
  }

  async function confirmAddAttendees() {
    const { activity, selection } = adding;
    setAdding((current) => ({ ...current, saving: true }));
    try {
      const updated = await updateActivityAttendees(activity.id, { add: selection });
      replaceActivity(updated);
      setAdding(null);
      // Added in Oracle means added in OGD too, when the activity is there.
      if (updated.isInOgd && updated.pendingInOgd) sendAttendees(updated);
    } catch (error) {
      setActionError(activity.id, error.message);
      setAdding(null);
    }
  }

  // ---------- New / edit ----------

  function openNew() {
    const first = chapterFilter ? chapterById.get(chapterFilter) : chapters[0];
    setEditor({
      saving: false, error: '', saved: null, pushAfter: true, memberSearch: '',
      form: {
        id: null, areaId: first?.areaId ?? null, name: '', activityType: '', areaName: first?.chapter ?? '', start: '', end: '',
        teamLeader: '', teamLeaderMemberId: '', venue: '', description: '', attendeeIds: [], ogdFields: {},
      },
    });
    if (first) ensureMembers(first.areaId);
  }

  function openEdit(activity) {
    setEditor({
      saving: false, error: '', saved: null, pushAfter: true, memberSearch: '',
      form: {
        id: activity.id, areaId: activity.areaId, name: activity.name ?? '', activityType: activity.activityType ?? '', areaName: activity.areaName ?? '',
        start: toWhenText(activity.startsAt), end: toWhenText(activity.endsAt), teamLeader: activity.teamLeader ?? '',
        teamLeaderMemberId: activity.teamLeaderMemberId ?? '', venue: activity.venue ?? '', description: activity.description ?? '',
        attendeeIds: activity.attendees.filter((attendee) => attendee.memberId && attendee.source !== 'link').map((attendee) => attendee.memberId),
        ogdFields: { ...(activity.ogdFields ?? {}) },
      },
    });
    ensureMembers(activity.areaId);
  }

  // A new activity filled in from another one, with all its attendees, so only
  // the title, type and dates need changing. Works for activities from OGD too.
  function openDuplicate(activity) {
    setEditor({
      saving: false, error: '', saved: null, pushAfter: true, memberSearch: '',
      copiedFrom: { name: activity.name, start: toWhenText(activity.startsAt), skipped: activity.attendees.filter((attendee) => !attendee.memberId).length },
      form: {
        id: null, areaId: activity.areaId, name: activity.name ?? '', activityType: activity.activityType ?? '',
        areaName: activity.areaName || (chapterById.get(activity.areaId)?.chapter ?? ''),
        start: toWhenText(activity.startsAt), end: toWhenText(activity.endsAt), teamLeader: activity.teamLeader ?? '',
        teamLeaderMemberId: activity.teamLeaderMemberId ?? '', venue: activity.venue ?? '', description: activity.description ?? '',
        attendeeIds: [...new Set(activity.attendees.filter((attendee) => attendee.memberId).map((attendee) => attendee.memberId))],
        ogdFields: { ...(activity.ogdFields ?? {}) },
      },
    });
    ensureMembers(activity.areaId);
  }

  function setForm(values) {
    setEditor((current) => ({ ...current, form: { ...current.form, ...values } }));
  }

  async function submitEditor() {
    const { form, pushAfter } = editor;
    const startsAt = fromWhenText(form.start);
    const endsAt = form.end.trim() ? fromWhenText(form.end) : null;
    let error = '';
    if (!form.areaId) error = 'Please choose a chapter.';
    else if (!form.name.trim()) error = 'Please enter the activity name.';
    else if (!startsAt) error = 'Please enter the start as YYYY-MM-DD HH:MM (24-hour, Philippine time).';
    else if (form.end.trim() && !endsAt) error = 'Please enter the end as YYYY-MM-DD HH:MM.';
    else if (endsAt && endsAt < startsAt) error = 'The end must be after the start.';
    else if (editor.copiedFrom && form.start.trim() === editor.copiedFrom.start && form.name.trim() === editor.copiedFrom.name) {
      error = 'This copy has the same title and start as the original. Change the title or the date first.';
    }
    if (error) {
      setEditor((current) => ({ ...current, error }));
      return;
    }
    setEditor((current) => ({ ...current, saving: true, error: '' }));
    try {
      const saved = await saveActivity({
        id: form.id, areaId: form.areaId, name: form.name, activityType: form.activityType, areaName: form.areaName, startsAt, endsAt,
        teamLeader: form.teamLeader, teamLeaderMemberId: form.teamLeaderMemberId, venue: form.venue, description: form.description, attendeeIds: form.attendeeIds,
        // Only the extra fields the chosen Type shows; values left from another Type are dropped.
        ogdFields: Object.fromEntries(extraFieldsFor(ogdForm, form).map((field) => [field.label, form.ogdFields?.[field.label]])
          .filter(([, value]) => value !== undefined && value !== '' && !(Array.isArray(value) && !value.length))),
      });
      if (!isMountedRef.current) return;
      setActivities((current) => (current.some((activity) => activity.id === saved.id)
        ? current.map((activity) => (activity.id === saved.id ? saved : activity))
        : [saved, ...current]));
      setExpandedId(saved.id);
      setEditor((current) => current && { ...current, saving: false, saved });
      if (pushAfter && isReady(saved.areaId)) {
        const pushed = await push(saved);
        if (pushed && isMountedRef.current) setEditor((current) => current && { ...current, saved: pushed });
      }
    } catch (failure) {
      if (isMountedRef.current) setEditor((current) => current && { ...current, saving: false, error: failure.message });
    }
  }

  // ---------- Display ----------

  function statusOf(activity) {
    if (pushingIds.has(activity.id) || activity.pushStatus === 'pushing') return { label: 'Pushing to OGD…', tone: 'info' };
    if (activity.source === 'ogd') return { label: 'From OGD', tone: 'plain' };
    if (activity.pushStatus === 'pushed') return { label: 'In OGD', tone: 'success' };
    if (activity.pushStatus === 'failed') return { label: 'Push failed', tone: 'danger' };
    return { label: 'Oracle only', tone: 'warning' };
  }

  function ogdStateOf(activity, attendee) {
    if (attendee.source === 'ogd') return { label: 'In OGD', tone: 'success' };
    if (attendee.ogd === 'added') return { label: attendee.ogdNote ? 'Already in OGD' : 'Added to OGD', tone: 'success' };
    if (!activity.isInOgd) return { label: 'Goes with push', tone: 'plain' };
    if (!attendee.memberId) return { label: 'No Member ID', tone: 'warning' };
    if (!attendee.isPendingInOgd) return { label: 'Already in OGD', tone: 'success' };
    if (sendingIds.has(activity.id)) return { label: 'Adding…', tone: 'info' };
    if (attendee.ogd === 'failed') return { label: 'Not added', tone: 'danger' };
    return { label: 'Waiting', tone: 'warning' };
  }

  function syncLabel(chapter) {
    if (runningIds.has(chapter.areaId)) return { label: 'Syncing…', tone: 'info' };
    if (!chapter.sync) return chapter.isReady ? { label: 'Not synced', tone: 'plain' } : { label: 'Needs OGD setup', tone: 'plain' };
    if (chapter.sync.status === 'failed') return { label: 'Failed', tone: 'danger' };
    return { label: `${chapter.sync.found} activit${chapter.sync.found === 1 ? 'y' : 'ies'}${chapter.sync.isPartial ? ' (partial)' : ''}`, tone: chapter.sync.isPartial ? 'warning' : 'success' };
  }

  function renderExpanded(activity) {
    const isPushing = pushingIds.has(activity.id);
    const isSending = sendingIds.has(activity.id);
    const details = Object.entries(activity.details ?? {}).filter(([, value]) => value);
    return (
      <View style={styles.expanded}>
        <View style={styles.detailGrid}>
          <Detail label="Chapter" value={chapterById.get(activity.areaId)?.chapter} />
          <Detail label="Start" value={formatWhen(activity.startsAt)} />
          <Detail label="End" value={formatWhen(activity.endsAt)} />
          <Detail label="Team Leader" value={activity.teamLeader} />
          <Detail label="Venue" value={activity.venue} />
          <Detail label="Description" value={activity.description} />
          {Object.entries(activity.ogdFields ?? {}).map(([label, value]) => <Detail key={`f-${label}`} label={label} value={Array.isArray(value) ? value.join(', ') : value === true ? 'Yes' : value} />)}
          {details.map(([label, value]) => <Detail key={label} label={label} value={value} />)}
          {!!activity.syncedAt && <Detail label="Read from OGD" value={formatDateTime(activity.syncedAt)} />}
        </View>

        <View style={styles.linkBox}>
          <Text style={styles.fieldLabel}>Attendance link</Text>
          <Text style={styles.url} selectable>{attendanceLink(activity)}</Text>
          <View style={styles.buttonRow}>
            <Button label="Share link" icon="share-outline" onPress={() => shareLink(attendanceLink(activity), activity.name)} />
            {!!activity.ogdUrl && <Button label="Open in OGD" icon="open-outline" onPress={() => Linking.openURL(activity.ogdUrl)} />}
          </View>
          <Text style={styles.hint}>Members open the attendance link, enter their Member ID and last name, and are added below.</Text>
        </View>

        {activity.source === 'oracle' && (
          <View style={styles.block}>
            {activity.pushStatus === 'failed' && !isPushing && <Text style={styles.errorText}>{FAILURE_MESSAGES[activity.pushFailureCode] || 'The push to OGD failed.'}</Text>}
            {!!activity.pushDetail && <Text style={styles.detailText}>{activity.pushDetail}</Text>}
            {activity.pushStatus !== 'pushed' && (
              <View style={styles.buttonRow}>
                <Button
                  kind="primary"
                  icon="send-outline"
                  label={isPushing ? 'Pushing to OGD…' : activity.pushStatus === 'failed' ? 'Try push again' : 'Push to OGD'}
                  busy={isPushing}
                  disabled={!isReady(activity.areaId)}
                  onPress={() => push(activity)}
                />
                <Button label="Edit" icon="create-outline" disabled={isPushing} onPress={() => openEdit(activity)} />
                <Button label="Delete" icon="trash-outline" kind="danger" disabled={isPushing} onPress={() => remove(activity)} />
              </View>
            )}
            {isPushing && <Text style={styles.notice}>Signing in to OGD and filling New Activity. This takes a minute or two.</Text>}
          </View>
        )}
        <View style={styles.buttonRow}>
          <Button label="Duplicate" icon="copy-outline" onPress={() => openDuplicate(activity)} />
          <Text style={[styles.hint, styles.flex]}>Same details and attendees; change the title, type and dates.</Text>
        </View>
        {!!actionErrors[activity.id] && <Text style={styles.errorText}>{actionErrors[activity.id]}</Text>}

        <View style={styles.attendeeHead}>
          <Text style={styles.sectionTitle}>
            Attendees ({activity.attendees.length}{activity.attendanceCount && activity.attendanceCount !== activity.attendees.length ? `, OGD counts ${activity.attendanceCount}` : ''})
          </Text>
          <View style={styles.buttonRow}>
            {activity.isInOgd && (activity.pendingInOgd > 0 || isSending) && (
              <Button
                kind="primary"
                icon="send-outline"
                label={isSending ? 'Adding in OGD…' : `Add ${activity.pendingInOgd} to OGD`}
                busy={isSending}
                disabled={!isReady(activity.areaId)}
                onPress={() => sendAttendees(activity)}
              />
            )}
            <Button label="Add attendees" icon="person-add-outline" onPress={() => openAddAttendees(activity)} />
          </View>
        </View>
        {isSending && <Text style={styles.notice}>Signing in to OGD and adding the attendees to this activity there. This takes a minute or two; keep this screen open.</Text>}
        {!isSending && !!activity.attendeePushStatus && activity.attendeePushStatus !== 'pushing' && (
          <View style={styles.block}>
            {activity.attendeePushStatus === 'pushed'
              ? <Text style={styles.successText}>Attendees added in OGD {formatDateTime(activity.attendeesPushedAt)}.</Text>
              : <Text style={styles.errorText}>{FAILURE_MESSAGES[activity.attendeePushFailureCode] || 'Some attendees could not be added in OGD.'}{activity.pendingInOgd ? ` Use "Add ${activity.pendingInOgd} to OGD" to try again.` : ''}</Text>}
            {!!activity.attendeePushDetail && <Text style={styles.detailText}>{activity.attendeePushDetail}</Text>}
          </View>
        )}
        {activity.isInOgd && activity.pendingInOgd > 0 && !isReady(activity.areaId) && (
          <Text style={styles.hint}>This chapter needs its OGD login before attendees can be added in OGD.</Text>
        )}
        {activity.attendees.length === 0 && (
          <Text style={styles.mutedText}>{activity.source === 'ogd' ? 'No attendees were read from OGD for this activity yet. Sync again to fetch them.' : 'No attendees yet. Share the attendance link or add them here.'}</Text>
        )}
        {activity.attendees.map((attendee, index) => {
          const state = ogdStateOf(activity, attendee);
          return (
            <View key={attendeeKey(attendee)} style={styles.attendeeRow}>
              <View style={styles.attendeeMain}>
                <Text style={styles.attendeeName}>{index + 1}. {attendee.name}</Text>
                <Text style={styles.mutedText}>
                  {[attendee.memberId, attendee.area, attendee.service, `added by ${SOURCE_LABELS[attendee.source] ?? attendee.source}`].filter(Boolean).join(' · ')}
                </Text>
                <View style={styles.pillRow}>
                  <TonePill label={state.label} tone={state.tone} />
                  {!attendee.matched && <TonePill label="not in members" tone="warning" />}
                </View>
                {attendee.ogd === 'failed' && !!attendee.ogdNote && <Text style={styles.detailText}>{attendee.ogdNote}</Text>}
              </View>
              {attendee.source !== 'ogd' && attendee.ogd !== 'added' && (
                <TouchableOpacity onPress={() => removeAttendee(activity, attendee)} accessibilityLabel="Remove attendee" hitSlop={8}>
                  <Ionicons name="close-circle-outline" size={20} color="#94a3b8" />
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </View>
    );
  }

  function renderActivity(activity, index) {
    const status = statusOf(activity);
    const isOpen = expandedId === activity.id;
    return (
      <TableRow key={activity.id} last={index === pageItems.length - 1} style={styles.activityRow}>
        <TouchableOpacity onPress={() => setExpandedId(isOpen ? null : activity.id)} style={styles.activityHead} accessibilityRole="button">
          <View style={styles.activityMain}>
            <Text style={styles.activityName}>{activity.name}</Text>
            <Text style={styles.mutedText}>
              {[activity.activityType, activity.areaName || chapterById.get(activity.areaId)?.chapter].filter(Boolean).join(' · ')}
            </Text>
            <Text style={styles.bodyText}>{formatWhen(activity.startsAt)}{activity.venue ? ` · ${activity.venue}` : ''}</Text>
            <View style={styles.pillRow}>
              <TonePill label={status.label} tone={status.tone} />
              <TonePill label={`${attendeeCount(activity)} attendee${attendeeCount(activity) === 1 ? '' : 's'}`} />
              {sendingIds.has(activity.id)
                ? <TonePill label="adding attendees…" tone="info" />
                : activity.pendingInOgd > 0 && <TonePill label={`${activity.pendingInOgd} not in OGD`} tone="warning" />}
            </View>
          </View>
          <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color="#64748b" />
        </TouchableOpacity>
        {isOpen && renderExpanded(activity)}
      </TableRow>
    );
  }

  const readyCount = chapters.filter((chapter) => chapter.isReady).length;
  const isBusy = isSyncingAll || runningIds.size > 0;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={[styles.headRow, !isWide && styles.headRowStacked]}>
        <View style={styles.flex}>
          <Text style={styles.title}>Activities</Text>
          <Text style={styles.subtitle}>Every chapter activity from OGD with its attendees, plus new activities you create here and push to OGD.</Text>
        </View>
        <Button kind="primary" icon="add" label="New Activity" disabled={!chapters.length} onPress={openNew} />
      </View>

      <TableCard>
        <View style={styles.rangeBox}>
          <View style={styles.rangeRow}>
            <Field label="From">
              <TextInput value={draft.from} onChangeText={(text) => setDraft((current) => ({ ...current, from: text }))} placeholder="YYYY-MM-DD" placeholderTextColor="#94a3b8" style={styles.input} />
            </Field>
            <Field label="Until">
              <TextInput value={draft.to} onChangeText={(text) => setDraft((current) => ({ ...current, to: text }))} placeholder="YYYY-MM-DD" placeholderTextColor="#94a3b8" style={styles.input} />
            </Field>
          </View>
          <View style={styles.chipRow}>
            {PRESETS.map((preset) => (
              <Chip key={preset.label} label={preset.label} active={range.from === preset.from() && range.to === preset.to()} onPress={() => applyRange({ from: preset.from(), to: preset.to() })} />
            ))}
          </View>
          <View style={styles.buttonRow}>
            <Button label="Show range" icon="search-outline" onPress={() => applyRange(draft)} />
            <Button kind="primary" icon="sync-outline" label={isSyncingAll ? 'Syncing…' : `Sync all from OGD (${readyCount})`} busy={isSyncingAll} disabled={!readyCount || isBusy} onPress={syncAll} />
          </View>
          <Text style={styles.hint}>Showing activities that start {range.from} to {range.to}. Sync reads this range from OGD.</Text>
          {isBusy && <Text style={styles.notice}>Each chapter signs in to OGD and opens every activity in the range, which can take a few minutes. Keep this screen open until it finishes.</Text>}
        </View>
      </TableCard>

      {loadState.status === 'success' && chapters.length > 0 && (
        <TableCard style={styles.cardGap}>
          <TouchableOpacity onPress={() => setShowChapters((value) => !value)} style={styles.collapseHead} accessibilityRole="button">
            <Text style={styles.sectionTitle}>Chapters ({chapters.length})</Text>
            <Ionicons name={showChapters ? 'chevron-up' : 'chevron-down'} size={18} color="#64748b" />
          </TouchableOpacity>
          {showChapters && chapters.map((chapter, index) => {
            const label = syncLabel(chapter);
            return (
              <TableRow key={chapter.areaId} last={index === chapters.length - 1} style={styles.chapterRow}>
                <View style={styles.flex}>
                  <Text style={styles.activityName}>{chapter.chapter}</Text>
                  <Text style={styles.mutedText}>{chapter.sector || 'No sector'}{chapter.sync?.syncedAt ? ` · synced ${formatDateTime(chapter.sync.syncedAt)} (${chapter.sync.from} to ${chapter.sync.to})` : ''}</Text>
                  <View style={styles.pillRow}><TonePill label={label.label} tone={label.tone} /></View>
                  {chapter.sync?.status === 'failed' && <Text style={styles.errorText}>{FAILURE_MESSAGES[chapter.sync.failureCode] || 'The sync failed.'}</Text>}
                  {!!chapter.sync?.statusDetail && <Text style={styles.detailText}>{chapter.sync.statusDetail}</Text>}
                  {!!syncErrors[chapter.areaId] && <Text style={styles.errorText}>{syncErrors[chapter.areaId]}</Text>}
                </View>
                {chapter.isReady && !runningIds.has(chapter.areaId) && !isSyncingAll && (
                  <ActionLink label="Sync" icon="sync-outline" onPress={() => syncChapter(chapter.areaId)} />
                )}
              </TableRow>
            );
          })}
        </TableCard>
      )}

      <TextInput
        value={search}
        onChangeText={(text) => {
          setSearch(text);
          setPage(1);
        }}
        placeholder="Search activity, venue, leader or attendee..."
        placeholderTextColor="#94a3b8"
        style={[styles.input, styles.search]}
      />
      {chapters.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} style={styles.chipScroll}>
          <Chip label="All chapters" active={!chapterFilter} onPress={() => { setChapterFilter(null); setPage(1); }} />
          {chapters.map((chapter) => (
            <Chip key={chapter.areaId} label={chapter.chapter} active={chapterFilter === chapter.areaId} onPress={() => { setChapterFilter(chapter.areaId); setPage(1); }} />
          ))}
        </ScrollView>
      )}

      <TableCard>
        {loadState.status === 'loading' && <ActivityIndicator style={styles.loader} color="#2563eb" />}
        {loadState.status === 'error' && (
          <View style={styles.block}>
            <Text style={styles.errorText}>{loadState.message}</Text>
            <ActionLink label="Try again" icon="refresh-outline" onPress={reload} />
          </View>
        )}
        {loadState.status === 'success' && (
          <>
            {pageItems.length === 0
              ? <EmptyRow label={activities.length === 0 ? 'No activities in this range yet. Sync from OGD, or create one.' : 'No activities match your search.'} />
              : pageItems.map(renderActivity)}
            <TablePagination
              page={page}
              pageCount={pageCount}
              totalCount={visibleActivities.length}
              pageSize={pageSize}
              onChange={setPage}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
            />
          </>
        )}
      </TableCard>

      {!!editor && (
        <EditorModal
          editor={editor}
          chapters={chapters}
          typeOptions={typeOptions}
          ogdForm={ogdForm}
          members={memberCache[editor.form.areaId]}
          isReady={isReady}
          isPushing={editor.saved ? pushingIds.has(editor.saved.id) : false}
          pushError={editor.saved ? actionErrors[editor.saved.id] : null}
          onChange={setEditor}
          onForm={setForm}
          onChapter={(chapter) => {
            setForm({ areaId: chapter.areaId, areaName: chapter.chapter, attendeeIds: [], teamLeader: '', teamLeaderMemberId: '' });
            ensureMembers(chapter.areaId);
          }}
          onSubmit={submitEditor}
          onClose={() => setEditor(null)}
        />
      )}

      {!!adding && (
        <AddAttendeesModal
          adding={adding}
          members={memberCache[adding.activity.areaId]}
          onChange={setAdding}
          onSubmit={confirmAddAttendees}
          onClose={() => setAdding(null)}
        />
      )}
    </ScrollView>
  );
}

function Detail({ label, value }) {
  if (!value) return null;
  return (
    <View style={styles.detail}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.bodyText}>{value}</Text>
    </View>
  );
}

function MemberPicker({ members, selected, search, onSearch, onToggle, excluded }) {
  const query = search.trim().toLowerCase();
  const list = (members ?? [])
    .filter((member) => !excluded?.has(member.memberId))
    .filter((member) => !query || `${member.name} ${member.memberId} ${member.area}`.toLowerCase().includes(query))
    .slice(0, 150);
  return (
    <View>
      <TextInput value={search} onChangeText={onSearch} placeholder="Search members by name, ID or area..." placeholderTextColor="#94a3b8" style={styles.input} />
      {!members && <ActivityIndicator style={styles.loader} color="#2563eb" />}
      {members && list.length === 0 && <Text style={styles.mutedText}>No members found.</Text>}
      {list.map((member) => {
        const isOn = selected.includes(member.memberId);
        return (
          <TouchableOpacity key={member.memberId} onPress={() => onToggle(member.memberId)} style={styles.memberRow} accessibilityRole="checkbox" accessibilityState={{ checked: isOn }}>
            <Ionicons name={isOn ? 'checkbox' : 'square-outline'} size={20} color={isOn ? '#2563eb' : '#94a3b8'} />
            <View style={styles.flex}>
              <Text style={styles.attendeeName}>{member.name}</Text>
              <Text style={styles.mutedText}>{[member.memberId, member.area, member.service].filter(Boolean).join(' · ')}</Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function Sheet({ title, subtitle, onClose, locked, children, footer }) {
  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => !locked && onClose()}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <View style={styles.flex}>
              <Text style={styles.sheetTitle}>{title}</Text>
              {!!subtitle && <Text style={styles.mutedText}>{subtitle}</Text>}
            </View>
            {!locked && (
              <TouchableOpacity onPress={onClose} accessibilityLabel="Close" hitSlop={8}>
                <Ionicons name="close" size={22} color="#475569" />
              </TouchableOpacity>
            )}
          </View>
          <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">{children}</ScrollView>
          {!!footer && <View style={styles.sheetFoot}>{footer}</View>}
        </View>
      </View>
    </Modal>
  );
}

function EditorModal({ editor, chapters, typeOptions, ogdForm, members, isReady, isPushing, pushError, onChange, onForm, onChapter, onSubmit, onClose }) {
  const { form, saved } = editor;
  const canPush = form.areaId && isReady(form.areaId);

  if (saved) {
    return (
      <Sheet title="Activity saved" subtitle={saved.name} onClose={onClose} locked={isPushing} footer={<Button label="Done" disabled={isPushing} onPress={onClose} />}>
        <Text style={styles.fieldLabel}>Attendance link</Text>
        <Text style={styles.url} selectable>{attendanceLink(saved)}</Text>
        <View style={styles.buttonRow}><Button label="Share link" icon="share-outline" onPress={() => shareLink(attendanceLink(saved), saved.name)} /></View>
        {!!saved.ogdUrl && (
          <>
            <Text style={styles.fieldLabel}>OGD link</Text>
            <Text style={styles.url} selectable>{saved.ogdUrl}</Text>
          </>
        )}
        {isPushing && <Text style={styles.notice}>Pushing to OGD: signing in and filling New Activity. This takes a minute or two; keep this open.</Text>}
        {!isPushing && saved.pushStatus === 'pushed' && <Text style={styles.successText}>Created in OGD. {saved.pushDetail}</Text>}
        {!isPushing && saved.pushStatus === 'failed' && (
          <>
            <Text style={styles.errorText}>{FAILURE_MESSAGES[saved.pushFailureCode] || 'The push to OGD failed.'} The activity is saved in Oracle; you can push it again from the list.</Text>
            {!!saved.pushDetail && <Text style={styles.detailText}>{saved.pushDetail}</Text>}
          </>
        )}
        {!isPushing && !saved.pushStatus && !!pushError && <Text style={styles.errorText}>{pushError}</Text>}
        {!isPushing && !saved.pushStatus && !pushError && <Text style={styles.mutedText}>Saved in Oracle only. Use Push to OGD in the list when you&apos;re ready.</Text>}
      </Sheet>
    );
  }

  const leaderQuery = form.teamLeader.trim().toLowerCase();
  const leaderMatches = leaderQuery && !form.teamLeaderMemberId
    ? (members ?? []).filter((member) => `${member.name} ${member.memberId}`.toLowerCase().includes(leaderQuery)).slice(0, 5)
    : [];

  return (
    <Sheet
      title={form.id ? 'Edit Activity' : editor.copiedFrom ? 'Duplicate Activity' : 'New Activity'}
      onClose={onClose}
      locked={editor.saving}
      footer={(
        <View style={styles.buttonRow}>
          <Button label="Cancel" disabled={editor.saving} onPress={onClose} />
          <Button kind="primary" label={editor.saving ? 'Saving…' : editor.pushAfter && canPush ? 'Save and push to OGD' : 'Save'} busy={editor.saving} onPress={onSubmit} />
        </View>
      )}
    >
      {!!editor.copiedFrom && (
        <Text style={styles.notice}>
          Copied from {editor.copiedFrom.name} with {form.attendeeIds.length} attendee{form.attendeeIds.length === 1 ? '' : 's'}. Change the title, type and dates, then save.
          {editor.copiedFrom.skipped ? ` ${editor.copiedFrom.skipped} without a Member ID ${editor.copiedFrom.skipped === 1 ? 'was' : 'were'} not copied.` : ''}
        </Text>
      )}
      {!form.id && (
        <Field label="Chapter">
          <View style={styles.chipRow}>
            {chapters.map((chapter) => <Chip key={chapter.areaId} label={chapter.chapter} active={form.areaId === chapter.areaId} onPress={() => onChapter(chapter)} />)}
          </View>
        </Field>
      )}
      <Field label="Activity Name">
        <TextInput value={form.name} onChangeText={(name) => onForm({ name })} placeholder="e.g. Chapter Prayer Assembly" placeholderTextColor="#94a3b8" style={styles.input} />
      </Field>
      <Field label="Type">
        <View style={styles.chipRow}>
          {typeOptions.map((type) => <Chip key={type} label={type} active={form.activityType === type} onPress={() => onForm({ activityType: form.activityType === type ? '' : type })} />)}
        </View>
      </Field>
      {extraFieldsFor(ogdForm, form).length > 0 && (
        <View style={styles.extraBox}>
          <Text style={styles.fieldLabel}>{form.activityType} details (OGD asks for these)</Text>
          {extraFieldsFor(ogdForm, form).map((field) => {
            const value = form.ogdFields?.[field.label];
            const setValue = (next) => onForm({ ogdFields: { ...form.ogdFields, [field.label]: next } });
            const choices = (field.options ?? []).filter((option) => !isPlaceholder(option.text));
            return (
              <Field key={field.uid} label={`${field.label}${field.required ? ' *' : ''}`}>
                {(field.kind === 'select' || field.kind === 'radio') && (
                  <View style={styles.chipRow}>
                    {choices.map((option) => <Chip key={option.value + option.text} label={option.text} active={value === option.text} onPress={() => setValue(value === option.text ? undefined : option.text)} />)}
                  </View>
                )}
                {field.kind === 'checkboxes' && (
                  <View style={styles.chipRow}>
                    {choices.map((option) => {
                      const list = Array.isArray(value) ? value : [];
                      const isOn = list.includes(option.text);
                      return <Chip key={option.value + option.text} label={option.text} active={isOn} onPress={() => setValue(isOn ? list.filter((entry) => entry !== option.text) : [...list, option.text])} />;
                    })}
                  </View>
                )}
                {field.kind === 'checkbox' && (
                  <View style={styles.switchRow}><Switch value={value === true} onValueChange={setValue} /><Text style={styles.bodyText}>Yes</Text></View>
                )}
                {!['select', 'radio', 'checkboxes', 'checkbox'].includes(field.kind) && (
                  <TextInput value={value ?? ''} onChangeText={setValue} multiline={field.kind === 'textarea'} placeholder={field.kind === 'date' ? 'YYYY-MM-DD' : ''} placeholderTextColor="#94a3b8" style={[styles.input, field.kind === 'textarea' && styles.textArea]} />
                )}
              </Field>
            );
          })}
        </View>
      )}
      <Field label="Area">
        <TextInput value={form.areaName} onChangeText={(areaName) => onForm({ areaName })} placeholder="e.g. West 1C1" placeholderTextColor="#94a3b8" style={styles.input} />
      </Field>
      <Field label="Start" hint="YYYY-MM-DD HH:MM, 24-hour, Philippine time">
        <TextInput value={form.start} onChangeText={(start) => onForm({ start })} placeholder="2026-11-28 19:00" placeholderTextColor="#94a3b8" style={styles.input} />
      </Field>
      <Field label="End (optional)">
        <TextInput value={form.end} onChangeText={(end) => onForm({ end })} placeholder="2026-11-28 21:00" placeholderTextColor="#94a3b8" style={styles.input} />
      </Field>
      <Field label="Team Leader">
        <TextInput value={form.teamLeader} onChangeText={(teamLeader) => onForm({ teamLeader, teamLeaderMemberId: '' })} placeholder="Search a member or type a name" placeholderTextColor="#94a3b8" style={styles.input} />
        {leaderMatches.map((member) => (
          <TouchableOpacity key={member.memberId} onPress={() => onForm({ teamLeader: member.name, teamLeaderMemberId: member.memberId })} style={styles.suggestion}>
            <Text style={styles.bodyText}>{member.name} · {member.memberId}</Text>
          </TouchableOpacity>
        ))}
      </Field>
      <Field label="Venue">
        <TextInput value={form.venue} onChangeText={(venue) => onForm({ venue })} placeholderTextColor="#94a3b8" style={styles.input} />
      </Field>
      <Field label="Description">
        <TextInput value={form.description} onChangeText={(description) => onForm({ description })} multiline style={[styles.input, styles.textArea]} />
      </Field>
      <Text style={styles.hint}>Type and Area must match a choice in OGD&apos;s New Activity form for the push to work.</Text>
      <Field label={`Attendees (${form.attendeeIds.length} selected)`}>
        <MemberPicker
          members={form.areaId ? members : []}
          selected={form.attendeeIds}
          search={editor.memberSearch}
          onSearch={(memberSearch) => onChange((current) => ({ ...current, memberSearch }))}
          onToggle={(id) => onForm({ attendeeIds: form.attendeeIds.includes(id) ? form.attendeeIds.filter((entry) => entry !== id) : [...form.attendeeIds, id] })}
        />
      </Field>
      <View style={styles.switchRow}>
        <Switch value={editor.pushAfter && Boolean(canPush)} disabled={!canPush} onValueChange={(pushAfter) => onChange((current) => ({ ...current, pushAfter }))} />
        <Text style={styles.bodyText}>Push to OGD after saving{canPush ? '' : ' (this chapter needs its OGD login first)'}</Text>
      </View>
      {!!editor.error && <Text style={styles.errorText}>{editor.error}</Text>}
    </Sheet>
  );
}

function AddAttendeesModal({ adding, members, onChange, onSubmit, onClose }) {
  const present = new Set(adding.activity.attendees.map((attendee) => attendee.memberId).filter(Boolean));
  return (
    <Sheet
      title="Add attendees"
      subtitle={adding.activity.isInOgd ? `${adding.activity.name} · they'll be added in OGD too` : adding.activity.name}
      onClose={onClose}
      locked={adding.saving}
      footer={(
        <View style={styles.buttonRow}>
          <Button label="Cancel" disabled={adding.saving} onPress={onClose} />
          <Button kind="primary" label={`Add ${adding.selection.length || ''}`.trim()} busy={adding.saving} disabled={!adding.selection.length} onPress={onSubmit} />
        </View>
      )}
    >
      <MemberPicker
        members={members}
        selected={adding.selection}
        excluded={present}
        search={adding.search}
        onSearch={(search) => onChange((current) => ({ ...current, search }))}
        onToggle={(id) => onChange((current) => ({ ...current, selection: current.selection.includes(id) ? current.selection.filter((entry) => entry !== id) : [...current.selection, id] }))}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  flex: { flex: 1 },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 },
  headRowStacked: { flexDirection: 'column', alignItems: 'stretch' },
  title: { fontSize: 22, fontWeight: '800', color: '#002060' },
  subtitle: { fontSize: 13, color: '#64748b', marginTop: 4 },
  cardGap: { marginTop: 12 },
  rangeBox: { padding: 14, gap: 10 },
  rangeRow: { flexDirection: 'row', gap: 10 },
  field: { flex: 1, gap: 4, marginBottom: 10 },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 13, color: '#0f172a' },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  search: { marginTop: 12, marginBottom: 8 },
  chipScroll: { marginBottom: 12, flexGrow: 0 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#fff' },
  chipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  chipText: { fontSize: 12, fontWeight: '600', color: '#334155' },
  chipTextActive: { color: '#fff' },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  button: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#fff' },
  buttonPrimary: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontSize: 13, fontWeight: '700', color: '#2563eb' },
  buttonTextPrimary: { color: '#fff' },
  buttonTextDanger: { color: '#b91c1c' },
  hint: { fontSize: 11, color: '#64748b' },
  notice: { fontSize: 12, color: '#1d4ed8', marginVertical: 6 },
  loader: { paddingVertical: 24 },
  collapseHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 },
  chapterRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  activityRow: { flexDirection: 'column', alignItems: 'stretch' },
  activityHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  activityMain: { flex: 1, gap: 3 },
  activityName: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  bodyText: { fontSize: 13, color: '#334155' },
  mutedText: { fontSize: 12, color: '#64748b' },
  detailText: { fontSize: 11, color: '#64748b' },
  errorText: { fontSize: 12, fontWeight: '600', color: '#b91c1c' },
  successText: { fontSize: 12, fontWeight: '600', color: '#15803d' },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  expanded: { marginTop: 12, gap: 10, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 12 },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  detail: { minWidth: 140, flexGrow: 1, flexBasis: '45%', gap: 2 },
  linkBox: { gap: 6, padding: 10, borderRadius: 8, backgroundColor: '#f8fafc' },
  url: { fontSize: 12, color: '#1e3a8a', fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) },
  block: { gap: 6 },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  attendeeHead: { gap: 8, marginTop: 4 },
  attendeeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  attendeeMain: { flex: 1, gap: 2 },
  attendeeName: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  suggestion: { paddingVertical: 8, paddingHorizontal: 10, backgroundColor: '#f8fafc', borderRadius: 6, marginTop: 4 },
  extraBox: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 12, marginBottom: 10, gap: 4 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 8 },
  backdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.45)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '92%', backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, width: '100%', maxWidth: 760, alignSelf: 'center' },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 16, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: '#002060' },
  sheetBody: { padding: 16, gap: 6 },
  sheetFoot: { padding: 12, borderTopWidth: 1, borderTopColor: '#e2e8f0', alignItems: 'flex-end' },
});
