import { Ionicons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { fetchAllRows } from '../../lib/fetchAllRows';
import { supabase } from '../../lib/supabase';
import { TRAINING_COLUMNS } from './PfoList';

function showAlert(title, message) {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
}

function confirmAction(title, message, onConfirm) {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
  } else {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onConfirm },
    ]);
  }
}

function formatSnapshotDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Groups the flat TRAINING_COLUMNS list by their "group" field so a formation
// stage can check whether a member completed EVERY column belonging to that group.
const COLUMN_IDS_BY_GROUP = TRAINING_COLUMNS.reduce((acc, col) => {
  if (!acc[col.group]) acc[col.group] = [];
  acc[col.group].push(col.id);
  return acc;
}, {});

// Formation stages mapped to the training-matrix column groups they correspond to.
export const FORMATION_STAGES = [
  {
    key: 'firstYear',
    label: 'First Year Formation',
    marker: '🟦',
    color: '#3b82f6',
    tracks: [
      { code: 'ET', name: 'Evangelization Training', group: 'Evangelism Tracks' },
      { code: 'CLPT', name: 'Christian Life Program Training', group: 'CLP Training Tracks' },
      { code: 'TW', name: 'Tongues Workshop', group: 'Tongues Workshop' },
      { code: 'CO', name: 'Covenant Orientation', group: 'Covenant Orientation Tracks' },
      { code: 'MER 1', name: 'Marriage Enrichment Retreat 1', group: 'Marriage Enrichment Retreat 1' },
      { code: 'FS', name: 'Financial Stewardship', group: 'Financial Stewardship' },
    ],
  },
  {
    key: 'secondYear',
    label: 'Second Year Formation',
    marker: '🟩',
    color: '#22c55e',
    tracks: [
      { code: 'FCL', name: 'Foundation for Christian Living', group: 'Foundations for Christian Living' },
      { code: 'SG', name: 'Spiritual Gifts Training', group: 'Spiritual Gifts Seminar' },
      { code: 'MER 2', name: 'Marriage Enrichment Retreat 2', group: 'Marriage Enrichment Retreat 2' },
      { code: 'MWPR', name: 'Mission with the Poor', group: 'Mission with the Poor' },
    ],
  },
  {
    key: 'thirdYear',
    label: 'Third Year Formation',
    marker: '🟨',
    color: '#eab308',
    tracks: [
      { code: 'CPR', name: 'Christian Personal Relationships', group: 'Christian Personal Relationships' },
      { code: 'HW', name: 'Healing Workshop', group: 'Healing Workshop' },
      { code: 'CHE', name: 'Christian and His Emotions', group: 'Christian Maturity / Emotions' },
    ],
  },
  {
    key: 'fourthYear',
    label: 'Fourth Year Formation',
    marker: '🟧',
    color: '#f97316',
    tracks: [
      { code: 'LPG', name: 'Living as a People of God', group: 'Living as a People of God' },
      { code: 'FOS', name: 'Fruit of the Spirit', group: 'Fruit of the Spirit Tracks' },
    ],
  },
  {
    key: 'leadersTrack',
    label: 'Leaders Track',
    marker: '🟥',
    color: '#ef4444',
    tracks: [
      { code: 'HLT', name: 'Household Leaders Training', group: 'Household Leaders Training' },
      { code: 'ULT', name: 'Unit Leaders Training', group: 'Unit Leaders Training' },
      { code: 'CLT', name: 'Chapter Leaders Training', group: 'Chapter Leaders Training' },
      { code: 'MCR', name: 'Mission Core Retreat', group: 'Mission Core Retreats' },
      { code: 'STW', name: 'Speakers Training Workshop', group: 'Speakers Training Workshops' },
    ],
  },
];

// Same short codes MembersList.js/ManageMembers.js use for PastoralService.
// A blank value normalizes to "MEMBER", same convention used everywhere
// else this column is read.
export const ROLE_LABELS = {
  CL: 'Chapter Leader',
  UL: 'Unit Leader',
  UH: 'Unit Head',
  HH: 'Household Head',
  CH: 'Chapter Head',
  FMHHL: 'Family Min Household Leader',
  MEMBER: 'Member',
  HHL: 'Household Leader',
  FMHH: 'Family Min Household Head',
};

export function normalizeRole(code) {
  return (code || '').trim().toUpperCase() || 'MEMBER';
}

export function getRoleLabel(code) {
  return ROLE_LABELS[code] || code;
}

// A member with no Status yet (legacy rows) counts as Active; only an
// explicit non-Active status (Inactive/Deceased/SOLD/HANDMAID) excludes them.
function isActiveStatus(status) {
  return !status || status === 'Active';
}

// A track is "complete" for a member only if every column in its group is Y/y,
// matching the same all-or-nothing logic PfoReports.js uses for "attendedAll".
export function computeTrackStat(track, pfoRows, totalMembers) {
  if (!track.group) {
    return { tracked: false };
  }

  const columnIds = COLUMN_IDS_BY_GROUP[track.group] || [];
  const completedCount = pfoRows.filter(
    (row) => columnIds.length > 0 && columnIds.every((id) => row[id] === 'Y' || row[id] === 'y')
  ).length;

  const percent = totalMembers > 0 ? (completedCount / totalMembers) * 100 : 0;

  return { tracked: true, completedCount, percent };
}

function buildStageInsight(trackedPercentages) {
  if (trackedPercentages.length === 0) return 'No trackable modules in this stage yet.';

  const average = trackedPercentages.reduce((sum, p) => sum + p, 0) / trackedPercentages.length;

  if (average >= 85) return 'Very high completion rate; majority already grounded in this stage of formation.';
  if (average >= 70) return 'Strong participation across modules in this stage.';
  if (average >= 50) return 'Moderate completion; there is room to push deeper formation.';
  return 'Needs significant attention and reinforcement.';
}

export default function PfoStatGenerator() {
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [membersRows, setMembersRows] = useState([]);
  const [pfoRows, setPfoRows] = useState([]);
  const [selectedRoles, setSelectedRoles] = useState(new Set());
  const [assignedAreaNames, setAssignedAreaNames] = useState([]);
  const [areaFilter, setAreaFilter] = useState('All');
  const [areaDropdownOpen, setAreaDropdownOpen] = useState(false);
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);

  const [snapshots, setSnapshots] = useState([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(true);
  const [snapshotNote, setSnapshotNote] = useState('');
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const [historyExpandedId, setHistoryExpandedId] = useState(null);
  const [deletingSnapshotId, setDeletingSnapshotId] = useState(null);

  useEffect(() => {
    generateStats();
    loadAssignedAreas();
  }, []);

  // Re-runs whenever the Area filter changes (including the initial mount)
  // so the history below only ever shows snapshots for the Area currently
  // selected above, instead of the 30 most recent snapshots across every
  // Area mixed together.
  useEffect(() => {
    loadSnapshots();
  }, [areaFilter]);

  async function loadSnapshots() {
    try {
      setSnapshotsLoading(true);
      const { data, error } = await supabase
        .from('formation_stats_snapshots')
        .select('*')
        .eq('area_filter', areaFilter)
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      setSnapshots(data || []);
    } catch (err) {
      console.error('Error loading formation stats history:', err.message);
    } finally {
      setSnapshotsLoading(false);
    }
  }

  // Areas explicitly assigned to the signed-in account (Portal Users ->
  // Areas) -- same convention as the Directory/PFO Trainings Area filters.
  async function loadAssignedAreas() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from('user_areas')
        .select('areas ( name )')
        .eq('profile_id', user.id);
      if (error) throw error;
      const names = (data || []).map((row) => row.areas?.name).filter(Boolean);
      setAssignedAreaNames(names);
    } catch (err) {
      console.error('Error loading assigned areas:', err.message);
    }
  }

  async function generateStats() {
    try {
      setLoading(true);

      const [members, data] = await Promise.all([
        fetchAllRows('members', 'MemberIDNo, PastoralService, Status, AreaName'),
        fetchAllRows('pfo_members', '*, members (PastoralService, Status, AreaName)'),
      ]);

      setMembersRows(members);
      setPfoRows(data);
    } catch (err) {
      console.error('Error generating PFO formation statistics:', err.message);
    } finally {
      setLoading(false);
    }
  }

  const areaOptions = useMemo(() => {
    if (assignedAreaNames.length > 0) {
      return ['All', ...Array.from(new Set(assignedAreaNames)).sort()];
    }
    const values = new Set(membersRows.map((m) => (m.AreaName || 'No Area').trim()));
    return ['All', ...Array.from(values).sort()];
  }, [membersRows, assignedAreaNames]);

  // Every distinct PastoralService code actually present in the data,
  // offered as multi-select checkboxes -- not a hardcoded list, since
  // PastoralService is free text (Manage Members) and can carry codes
  // beyond ROLE_LABELS.
  const roleOptions = useMemo(() => {
    const values = new Set(membersRows.map((m) => normalizeRole(m.PastoralService)));
    return Array.from(values).sort();
  }, [membersRows]);

  // Prefix match (same convention used across the app) so an Area named
  // "West 1C2" also covers AreaName variants like "West 1C2B"/"West 1C2D".
  function matchesAreaFilter(areaName) {
    if (areaFilter === 'All') return true;
    const value = (areaName || '').trim();
    return areaFilter === 'No Area' ? !value : value.toLowerCase().startsWith(areaFilter.toLowerCase());
  }

  // No roles checked means unfiltered (every role counts) -- matches the
  // Area filter's "All" convention.
  function matchesRoleFilter(code) {
    if (selectedRoles.size === 0) return true;
    return selectedRoles.has(normalizeRole(code));
  }

  function toggleRole(code) {
    setSelectedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  // Non-Active members (Inactive/Deceased/SOLD/HANDMAID) are excluded from
  // every count below. The Area and Role filters narrow the same way.
  const activeMembersRows = useMemo(
    () => membersRows.filter((m) => isActiveStatus(m.Status) && matchesAreaFilter(m.AreaName) && matchesRoleFilter(m.PastoralService)),
    [membersRows, areaFilter, selectedRoles]
  );

  const activeTotalMembers = activeMembersRows.length;

  // Numerator has to be drawn from the same subset as the denominator, otherwise
  // completions from non-Active, out-of-area, or unselected-role rows would
  // inflate the percentage.
  const activePfoRows = useMemo(
    () => pfoRows.filter((row) =>
      isActiveStatus(row.members?.Status)
      && matchesAreaFilter(row.members?.AreaName)
      && matchesRoleFilter(row.members?.PastoralService)
    ),
    [pfoRows, areaFilter, selectedRoles]
  );

  const denominatorLabel = selectedRoles.size === 0
    ? 'Total Active Members'
    : `Total Active Members (${Array.from(selectedRoles).map(getRoleLabel).join(', ')})`;

  const stageResults = useMemo(() => {
    return FORMATION_STAGES.map((stage) => {
      const trackResults = stage.tracks.map((track) => ({
        ...track,
        ...computeTrackStat(track, activePfoRows, activeTotalMembers),
      }));

      const trackedPercentages = trackResults.filter((t) => t.tracked).map((t) => t.percent);

      return {
        ...stage,
        trackResults,
        insight: buildStageInsight(trackedPercentages),
      };
    });
  }, [activePfoRows, activeTotalMembers]);

  // Trends are only meaningful when compared against a snapshot taken
  // under the SAME Area/Roles filters -- otherwise a delta could just
  // reflect a narrower filter, not real progress. Snapshots already come
  // back newest-first, so the first match is the most recent comparable one.
  const comparableSnapshot = useMemo(() => {
    const currentRoles = Array.from(selectedRoles).sort();
    return snapshots.find((snap) => {
      if (snap.area_filter !== areaFilter) return false;
      const snapRoles = (snap.role_filter || []).slice().sort();
      return snapRoles.length === currentRoles.length && snapRoles.every((r, i) => r === currentRoles[i]);
    }) || null;
  }, [snapshots, areaFilter, selectedRoles]);

  function getSnapshotTrackPercent(snapshot, code) {
    const entry = (snapshot?.track_results || []).find((t) => t.code === code);
    return entry && entry.tracked ? entry.percent : null;
  }

  // Stores the CURRENTLY computed numbers as a point-in-time row, tagged
  // with the filter context they were computed under -- re-deriving past
  // values later from members/pfo_members isn't possible since those
  // tables only ever reflect current state.
  async function handleSaveSnapshot() {
    setSavingSnapshot(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const trackResultsPayload = stageResults.flatMap((stage) =>
        stage.trackResults.map((t) => ({
          stageKey: stage.key,
          stageLabel: stage.label,
          code: t.code,
          name: t.name,
          tracked: t.tracked,
          completedCount: t.tracked ? t.completedCount : null,
          percent: t.tracked ? t.percent : null,
        }))
      );

      const { error } = await supabase.from('formation_stats_snapshots').insert([{
        created_by: user?.id || null,
        created_by_email: user?.email || null,
        note: snapshotNote.trim() || null,
        area_filter: areaFilter,
        role_filter: Array.from(selectedRoles),
        total_members: activeTotalMembers,
        track_results: trackResultsPayload,
      }]);
      if (error) throw error;

      setSnapshotNote('');
      await loadSnapshots();
    } catch (err) {
      showAlert('Save Failed', err.message);
    } finally {
      setSavingSnapshot(false);
    }
  }

  function handleDeleteSnapshot(snap) {
    confirmAction(
      'Delete Snapshot',
      `Remove the snapshot saved ${formatSnapshotDate(snap.created_at)}${snap.note ? ` ("${snap.note}")` : ''}? This cannot be undone.`,
      async () => {
        setDeletingSnapshotId(snap.id);
        try {
          const { error } = await supabase.from('formation_stats_snapshots').delete().eq('id', snap.id);
          if (error) throw error;
          setSnapshots((prev) => prev.filter((s) => s.id !== snap.id));
          if (historyExpandedId === snap.id) setHistoryExpandedId(null);
        } catch (err) {
          showAlert('Delete Failed', err.message);
        } finally {
          setDeletingSnapshotId(null);
        }
      }
    );
  }

  function buildTextReport() {
    const lines = [`${denominatorLabel}: ${activeTotalMembers}`, ''];

    stageResults.forEach((stage) => {
      lines.push(`${stage.marker} ${stage.label}:`, '');

      stage.trackResults.forEach((track, index) => {
        const prefix = `${index + 1}. ${track.name} (${track.code})`;
        if (track.tracked) {
          lines.push(`${prefix}: ${track.completedCount} / ${activeTotalMembers} → ${track.percent.toFixed(1)}%`);
        } else {
          lines.push(`${prefix}: Not tracked in current data`);
        }
      });

      lines.push('', `Insight: ${stage.insight}`, '');
    });

    return lines.join('\n');
  }

  async function handleExportReport() {
    try {
      setExporting(true);
      const textContent = buildTextReport();

      const now = new Date();
      const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const safeFileName = `cfc-pfo-formation-stats-${stamp}.txt`;

      if (Platform.OS === 'web') {
        const element = document.createElement('a');
        const file = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
        element.href = URL.createObjectURL(file);
        element.download = safeFileName;
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
        return;
      }

      const file = new File(Paths.document, safeFileName);
      file.create({ overwrite: true });
      file.write(textContent);
      await Sharing.shareAsync(file.uri, { mimeType: 'text/plain', dialogTitle: 'Export Formation Stats' });
    } catch (err) {
      console.error('Error exporting formation stats report:', err.message);
    } finally {
      setExporting(false);
    }
  }

  if (loading) return <ActivityIndicator size="large" color="#002060" style={styles.centered} />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <View style={styles.heroSection}>
        <View style={styles.titleRow}>
          <Ionicons name="analytics-outline" size={22} color="#0f172a" style={styles.titleIcon} />
          <Text style={styles.title}>PFO Formation Statistics</Text>
        </View>
        <Text style={styles.subtitle}>
          Auto-computed completion rates across every formation stage, based on the current member roster.
        </Text>
      </View>

      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>{denominatorLabel}</Text>
        <Text style={styles.summaryValue}>{activeTotalMembers}</Text>
      </View>

      <View style={styles.filtersRow}>
        <View style={styles.areaDropdownWrapper}>
          <Text style={styles.fieldLabel}>Area:</Text>
          <TouchableOpacity
            style={styles.dropdownHeader}
            activeOpacity={0.8}
            onPress={() => setAreaDropdownOpen((v) => !v)}
          >
            <Text style={styles.dropdownHeaderText} numberOfLines={1}>{areaFilter}</Text>
            <Ionicons name={areaDropdownOpen ? 'chevron-up' : 'chevron-down'} size={14} color="#64748b" />
          </TouchableOpacity>

          {areaDropdownOpen && (
            <View style={styles.dropdownMenuContainer}>
              {areaOptions.map((option) => {
                const isSelected = option === areaFilter;
                return (
                  <TouchableOpacity
                    key={option}
                    style={[styles.dropdownItem, isSelected && styles.dropdownItemActive]}
                    onPress={() => { setAreaFilter(option); setAreaDropdownOpen(false); }}
                  >
                    <Text style={[styles.dropdownItemText, isSelected && styles.dropdownItemTextActive]} numberOfLines={1}>
                      {option}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        <View style={styles.roleDropdownWrapper}>
          <Text style={styles.fieldLabel}>Roles:</Text>
          <TouchableOpacity
            style={styles.dropdownHeader}
            activeOpacity={0.8}
            onPress={() => setRoleDropdownOpen((v) => !v)}
          >
            <Text style={styles.dropdownHeaderText} numberOfLines={1}>
              {selectedRoles.size === 0 ? 'All Roles' : `${selectedRoles.size} role${selectedRoles.size === 1 ? '' : 's'} selected`}
            </Text>
            <Ionicons name={roleDropdownOpen ? 'chevron-up' : 'chevron-down'} size={14} color="#64748b" />
          </TouchableOpacity>

          {roleDropdownOpen && (
            <View style={styles.dropdownMenuContainer}>
              <TouchableOpacity
                style={styles.dropdownItem}
                onPress={() => setSelectedRoles(new Set())}
              >
                <Text style={[styles.dropdownItemText, selectedRoles.size === 0 && styles.dropdownItemTextActive]}>
                  All Roles
                </Text>
              </TouchableOpacity>
              <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled>
                {roleOptions.map((code) => {
                  const checked = selectedRoles.has(code);
                  return (
                    <TouchableOpacity key={code} style={styles.dropdownCheckItem} onPress={() => toggleRole(code)}>
                      <Ionicons
                        name={checked ? 'checkbox' : 'square-outline'}
                        size={16}
                        color={checked ? '#002060' : '#94a3b8'}
                        style={{ marginRight: 8 }}
                      />
                      <Text style={[styles.dropdownItemText, checked && styles.dropdownItemTextActive]} numberOfLines={1}>
                        {getRoleLabel(code)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}
        </View>
      </View>

      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.refreshBtn} onPress={generateStats}>
          <Ionicons name="refresh-outline" size={15} color="#334155" style={styles.btnIcon} />
          <Text style={styles.refreshBtnText}>Refresh</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.exportBtn} onPress={handleExportReport} disabled={exporting}>
          {exporting ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <>
              <Ionicons name="download-outline" size={15} color="#ffffff" style={styles.btnIcon} />
              <Text style={styles.exportBtnText}>Export Report</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <Text style={styles.compareHint}>
        {comparableSnapshot
          ? `Comparing against the snapshot saved ${formatSnapshotDate(comparableSnapshot.created_at)} (same Area/Roles filters).`
          : 'No comparable snapshot yet for these filters — save one below to start tracking trends over time.'}
      </Text>

      {stageResults.map((stage) => (
        <View key={stage.key} style={styles.stageCard}>
          <View style={styles.stageHeader}>
            <View style={[styles.stageDot, { backgroundColor: stage.color }]} />
            <Text style={styles.stageTitle}>{stage.label}</Text>
          </View>

          {stage.trackResults.map((track) => {
            const prevPercent = track.tracked ? getSnapshotTrackPercent(comparableSnapshot, track.code) : null;
            const delta = prevPercent === null ? null : track.percent - prevPercent;
            return (
              <View key={track.code} style={styles.trackRow}>
                <View style={styles.trackNameCol}>
                  <Text style={styles.trackName}>{track.name}</Text>
                  <Text style={styles.trackCode}>{track.code}</Text>
                </View>

                {track.tracked ? (
                  <View style={styles.trackStatCol}>
                    <Text style={styles.trackFraction}>{track.completedCount} / {activeTotalMembers}</Text>
                    <Text style={[styles.trackPercent, { color: stage.color }]}>{track.percent.toFixed(1)}%</Text>
                    {delta !== null && (
                      <Text style={[styles.deltaText, delta > 0.05 ? styles.deltaUp : delta < -0.05 ? styles.deltaDown : styles.deltaFlat]}>
                        {delta > 0.05 ? '▲' : delta < -0.05 ? '▼' : '—'} {Math.abs(delta).toFixed(1)}%
                      </Text>
                    )}
                  </View>
                ) : (
                  <View style={styles.notTrackedBadge}>
                    <Text style={styles.notTrackedText}>Not Tracked</Text>
                  </View>
                )}
              </View>
            );
          })}

          <View style={[styles.insightBox, { backgroundColor: `${stage.color}1A` }]}>
            <Ionicons name="information-circle-outline" size={14} color={stage.color} style={styles.insightIcon} />
            <Text style={[styles.insightText, { color: stage.color }]}>{stage.insight}</Text>
          </View>
        </View>
      ))}

      <View style={styles.historyCard}>
        <Text style={styles.historyTitle}>Snapshot History — Area: {areaFilter}</Text>
        <Text style={styles.historySubtitle}>
          Save the numbers above as a dated record. History only shows snapshots saved under the Area selected above -- switch Area to see that Area's own history.
        </Text>

        <View style={styles.snapshotSaveRow}>
          <TextInput
            style={styles.snapshotNoteInput}
            placeholder={'Optional note (e.g. "End of Q1")'}
            placeholderTextColor="#94a3b8"
            value={snapshotNote}
            onChangeText={setSnapshotNote}
          />
          <TouchableOpacity style={styles.saveSnapshotBtn} onPress={handleSaveSnapshot} disabled={savingSnapshot}>
            {savingSnapshot ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <>
                <Ionicons name="save-outline" size={14} color="#ffffff" style={{ marginRight: 6 }} />
                <Text style={styles.saveSnapshotBtnText}>Save Snapshot</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {snapshotsLoading ? (
          <ActivityIndicator color="#002060" style={{ marginVertical: 16 }} />
        ) : snapshots.length === 0 ? (
          <Text style={styles.historyEmptyText}>No snapshots saved yet for the &quot;{areaFilter}&quot; area.</Text>
        ) : (
          snapshots.map((snap, index) => {
            const isExpanded = historyExpandedId === snap.id;
            return (
              <View key={snap.id} style={[styles.snapshotRow, index === snapshots.length - 1 && { borderBottomWidth: 0 }]}>
                <View style={styles.snapshotRowHeader}>
                  <TouchableOpacity
                    style={styles.snapshotRowToggle}
                    onPress={() => setHistoryExpandedId(isExpanded ? null : snap.id)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.snapshotDate}>{formatSnapshotDate(snap.created_at)}</Text>
                      <Text style={styles.snapshotMeta} numberOfLines={1}>
                        {snap.total_members} members · Area: {snap.area_filter} · Roles: {(snap.role_filter || []).length ? snap.role_filter.join(', ') : 'All'}
                        {snap.note ? ` · "${snap.note}"` : ''}
                      </Text>
                    </View>
                    <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color="#64748b" style={{ marginLeft: 8 }} />
                  </TouchableOpacity>

                  {deletingSnapshotId === snap.id ? (
                    <ActivityIndicator size="small" color="#dc2626" style={styles.deleteSnapshotBtn} />
                  ) : (
                    <TouchableOpacity
                      style={styles.deleteSnapshotBtn}
                      onPress={() => handleDeleteSnapshot(snap)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="trash-outline" size={16} color="#dc2626" />
                    </TouchableOpacity>
                  )}
                </View>

                {isExpanded && (
                  <View style={styles.snapshotDetail}>
                    {(snap.track_results || []).map((t) => (
                      <View key={t.code} style={styles.snapshotDetailRow}>
                        <Text style={styles.snapshotDetailName} numberOfLines={1}>{t.name} ({t.code})</Text>
                        <Text style={styles.snapshotDetailValue}>
                          {t.tracked ? `${t.completedCount} / ${snap.total_members} · ${t.percent.toFixed(1)}%` : 'Not tracked'}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 30 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  heroSection: { paddingVertical: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  titleIcon: { marginRight: 8 },
  title: { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  subtitle: { fontSize: 13, color: '#64748b', marginTop: 4, lineHeight: 19 },

  summaryCard: {
    backgroundColor: '#002060', borderRadius: 12, padding: 16, marginBottom: 14,
  },
  summaryLabel: { fontSize: 11, fontWeight: '700', color: '#93c5fd', textTransform: 'uppercase' },
  summaryValue: { fontSize: 30, fontWeight: '800', color: '#ffffff', marginTop: 4 },

  filtersRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 14, zIndex: 10 },
  areaDropdownWrapper: { zIndex: 10, flexGrow: 1, flexBasis: 200, maxWidth: 260 },
  // Lower than areaDropdownWrapper so Area's own floating menu (it comes
  // first and opens downward) reliably paints over the Roles field sitting
  // right below it on narrow screens, instead of the two tying at an equal
  // zIndex and the stacking order becoming a platform-dependent toss-up.
  roleDropdownWrapper: { zIndex: 9, flexGrow: 1, flexBasis: 200, maxWidth: 260 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 6, textTransform: 'uppercase' },
  dropdownHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#ffffff', borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0',
    paddingHorizontal: 14, paddingVertical: 12,
  },
  dropdownHeaderText: { flex: 1, fontSize: 14, fontWeight: '600', color: '#1e293b' },
  dropdownMenuContainer: {
    position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 6,
    backgroundColor: '#ffffff', borderRadius: 10, borderWidth: 1, borderColor: '#cbd5e1',
    maxHeight: 260, overflow: 'hidden',
    shadowColor: '#0f172a', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 8,
    elevation: 8,
  },
  dropdownItem: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  dropdownCheckItem: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  dropdownItemActive: { backgroundColor: '#eff6ff' },
  dropdownItemText: { fontSize: 13, fontWeight: '500', color: '#334155' },
  dropdownItemTextActive: { color: '#002060', fontWeight: '700' },

  actionRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  refreshBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#cbd5e1',
    borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10,
  },
  refreshBtnText: { fontSize: 13, fontWeight: '700', color: '#334155' },
  exportBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#2563eb', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10,
  },
  exportBtnText: { fontSize: 13, fontWeight: '700', color: '#ffffff' },
  btnIcon: { marginRight: 6 },

  stageCard: {
    backgroundColor: '#ffffff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0',
    padding: 14, marginBottom: 14,
  },
  stageHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  stageDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  stageTitle: { fontSize: 15, fontWeight: '800', color: '#0f172a' },

  trackRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  trackNameCol: { flex: 1, paddingRight: 10 },
  trackName: { fontSize: 13, fontWeight: '600', color: '#1e293b' },
  trackCode: { fontSize: 10, color: '#94a3b8', marginTop: 1, fontWeight: '600' },
  trackStatCol: { alignItems: 'flex-end' },
  trackFraction: { fontSize: 11, color: '#64748b' },
  trackPercent: { fontSize: 15, fontWeight: '800', marginTop: 1 },
  notTrackedBadge: { backgroundColor: '#f1f5f9', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  notTrackedText: { fontSize: 10, fontWeight: '700', color: '#94a3b8' },

  insightBox: {
    flexDirection: 'row', alignItems: 'flex-start', borderRadius: 8,
    padding: 10, marginTop: 10,
  },
  insightIcon: { marginRight: 6, marginTop: 1 },
  insightText: { flex: 1, fontSize: 12, fontWeight: '600', lineHeight: 17 },

  compareHint: { fontSize: 11, color: '#94a3b8', marginBottom: 12, fontStyle: 'italic' },
  deltaText: { fontSize: 11, fontWeight: '700', marginTop: 2 },
  deltaUp: { color: '#15803d' },
  deltaDown: { color: '#dc2626' },
  deltaFlat: { color: '#94a3b8' },

  historyCard: {
    backgroundColor: '#ffffff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0',
    padding: 14, marginTop: 4, marginBottom: 16,
  },
  historyTitle: { fontSize: 15, fontWeight: '800', color: '#0f172a' },
  historySubtitle: { fontSize: 12, color: '#64748b', marginTop: 4, marginBottom: 12, lineHeight: 17 },

  snapshotSaveRow: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  snapshotNoteInput: {
    flex: 1, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 9, fontSize: 13, color: '#1e293b',
  },
  saveSnapshotBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#002060', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9,
  },
  saveSnapshotBtnText: { fontSize: 12, fontWeight: '700', color: '#ffffff' },

  historyEmptyText: { fontSize: 12, color: '#94a3b8', textAlign: 'center', paddingVertical: 16 },

  snapshotRow: { borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  snapshotRowHeader: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  snapshotRowToggle: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  deleteSnapshotBtn: { marginLeft: 10, padding: 2 },
  snapshotDate: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  snapshotMeta: { fontSize: 11, color: '#64748b', marginTop: 2 },

  snapshotDetail: { paddingBottom: 10, paddingLeft: 4 },
  snapshotDetailRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 4,
  },
  snapshotDetailName: { fontSize: 12, color: '#334155', flex: 1, paddingRight: 10 },
  snapshotDetailValue: { fontSize: 11, color: '#64748b', fontWeight: '600' },
});
