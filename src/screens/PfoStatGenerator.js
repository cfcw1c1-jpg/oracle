import { Ionicons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { TRAINING_COLUMNS } from './PfoList';

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

// A member's PastoralService code is blank/"MEMBER" for rank-and-file members;
// any other code (UH, HH, CL, UL, etc.) marks a leadership role.
function isNonMemberRole(code) {
  const normalized = (code || '').trim().toUpperCase();
  return normalized !== '' && normalized !== 'MEMBER';
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
  const [leadersOnly, setLeadersOnly] = useState(false);

  useEffect(() => {
    generateStats();
  }, []);

  async function generateStats() {
    try {
      setLoading(true);

      const [{ data: members, error: memberError }, { data, error: pfoError }] = await Promise.all([
        supabase.from('members').select('MemberIDNo, PastoralService, Status'),
        supabase.from('pfo_members').select('*, members (PastoralService, Status)'),
      ]);

      if (memberError) throw memberError;
      if (pfoError) throw pfoError;

      setMembersRows(members || []);
      setPfoRows(data || []);
    } catch (err) {
      console.error('Error generating PFO formation statistics:', err.message);
    } finally {
      setLoading(false);
    }
  }

  // Non-Active members (Inactive/Deceased/SOLD/HANDMAID) are excluded from
  // every count below, regardless of the leaders-only toggle.
  const activeMembersRows = useMemo(
    () => membersRows.filter((m) => isActiveStatus(m.Status)),
    [membersRows]
  );

  // Denominator: everyone active, or just active members holding a non-"Member"
  // role (Unit Head, Household Head, Chapter Leader, etc.) when the checkbox is on.
  const activeTotalMembers = useMemo(() => {
    if (!leadersOnly) return activeMembersRows.length;
    return activeMembersRows.filter((m) => isNonMemberRole(m.PastoralService)).length;
  }, [leadersOnly, activeMembersRows]);

  // Numerator has to be drawn from the same subset as the denominator, otherwise
  // completions from non-Active or plain "Member" rows would inflate the percentage.
  const activePfoRows = useMemo(() => {
    const statusFiltered = pfoRows.filter((row) => isActiveStatus(row.members?.Status));
    if (!leadersOnly) return statusFiltered;
    return statusFiltered.filter((row) => isNonMemberRole(row.members?.PastoralService));
  }, [leadersOnly, pfoRows]);

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

  function buildTextReport() {
    const denominatorLabel = leadersOnly ? 'Total Members (Non-"Member" Roles Only)' : 'Total Active Members';
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
        <Text style={styles.summaryLabel}>{leadersOnly ? 'Total Members (Non-"Member" Roles Only)' : 'Total Active Members'}</Text>
        <Text style={styles.summaryValue}>{activeTotalMembers}</Text>
      </View>

      <TouchableOpacity style={styles.leadersOnlyRow} onPress={() => setLeadersOnly((prev) => !prev)}>
        <View style={[styles.checkbox, leadersOnly && styles.checkboxChecked]}>
          {leadersOnly && <Ionicons name="checkmark" size={13} color="#ffffff" />}
        </View>
        <Text style={styles.leadersOnlyText}>
          Only count non-&quot;Member&quot; roles (Unit Head, Household Head, Chapter Leader, etc.)
        </Text>
      </TouchableOpacity>

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

      {stageResults.map((stage) => (
        <View key={stage.key} style={styles.stageCard}>
          <View style={styles.stageHeader}>
            <View style={[styles.stageDot, { backgroundColor: stage.color }]} />
            <Text style={styles.stageTitle}>{stage.label}</Text>
          </View>

          {stage.trackResults.map((track) => (
            <View key={track.code} style={styles.trackRow}>
              <View style={styles.trackNameCol}>
                <Text style={styles.trackName}>{track.name}</Text>
                <Text style={styles.trackCode}>{track.code}</Text>
              </View>

              {track.tracked ? (
                <View style={styles.trackStatCol}>
                  <Text style={styles.trackFraction}>{track.completedCount} / {activeTotalMembers}</Text>
                  <Text style={[styles.trackPercent, { color: stage.color }]}>{track.percent.toFixed(1)}%</Text>
                </View>
              ) : (
                <View style={styles.notTrackedBadge}>
                  <Text style={styles.notTrackedText}>Not Tracked</Text>
                </View>
              )}
            </View>
          ))}

          <View style={[styles.insightBox, { backgroundColor: `${stage.color}1A` }]}>
            <Ionicons name="information-circle-outline" size={14} color={stage.color} style={styles.insightIcon} />
            <Text style={[styles.insightText, { color: stage.color }]}>{stage.insight}</Text>
          </View>
        </View>
      ))}
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

  leadersOnlyRow: {
    flexDirection: 'row', alignItems: 'center', marginBottom: 14,
  },
  checkbox: {
    width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: '#cbd5e1',
    backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center', marginRight: 10,
  },
  checkboxChecked: { backgroundColor: '#002060', borderColor: '#002060' },
  leadersOnlyText: { flex: 1, fontSize: 12, fontWeight: '600', color: '#334155', lineHeight: 17 },

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
});
