import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { EmptyRow, ExportButton, exportCsv, Pill, TableCard, TableRow } from '../components/admin-table';

const NARROW_BREAKPOINT = 720;

const NAVY = '#002060';

function showAlert(title, message) {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
}

// A member with no Status yet (legacy rows) counts as Active -- matches the
// convention used across Areas.js/DashboardHome.js.
function isActiveStatus(status) {
  return !status || status === 'Active';
}

function normalize(s) {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Same case-insensitive prefix match used for area-scoped RLS and the "#
// Members" badge on Areas -- a member's AreaName "matches" an Area if it
// starts with that Area's name (covers sub-variants like "West 1A" under
// an Area named "West 1").
function matchesAreaPrefix(memberAreaName, areaName) {
  const prefix = normalize(areaName);
  if (!prefix) return false;
  return normalize(memberAreaName).startsWith(prefix);
}

// Standard Levenshtein edit distance, used only to suggest the closest real
// Area name for a member's AreaName that doesn't match anything -- most
// mismatches are a typo (missing space, extra character, wrong case
// already handled by the prefix match above), and surfacing "did you mean
// X?" turns a manual hunt through the Areas list into a one-tap fix.
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function suggestArea(memberAreaName, areas) {
  const target = normalize(memberAreaName);
  if (!target || areas.length === 0) return null;
  let best = null;
  let bestDistance = Infinity;
  areas.forEach((area) => {
    const distance = levenshtein(target, normalize(area.name));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = area;
    }
  });
  // Scales with the text's length so short names still need a close match,
  // while longer ones tolerate a couple more character differences.
  const threshold = Math.max(2, Math.floor(target.length * 0.35));
  return bestDistance <= threshold ? best : null;
}

function SummaryStat({ label, value, color }) {
  return (
    <View style={styles.summaryStat}>
      <Text style={[styles.summaryValue, { color }]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

export default function DataHealth() {
  const { width } = useWindowDimensions();
  const isNarrow = width < NARROW_BREAKPOINT;

  const [loading, setLoading] = useState(true);
  const [areas, setAreas] = useState([]);
  const [members, setMembers] = useState([]);
  const [fixingId, setFixingId] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const [areasRes, membersRes] = await Promise.all([
        supabase.from('areas').select('id, name, type').order('name'),
        supabase.from('members').select('MemberIDNo, Lastname, Firstname, AreaName, Status'),
      ]);
      if (areasRes.error) throw areasRes.error;
      if (membersRes.error) throw membersRes.error;
      setAreas(areasRes.data || []);
      setMembers(membersRes.data || []);
    } catch (err) {
      showAlert('Error Loading Data Health', err.message);
    } finally {
      setLoading(false);
    }
  }

  const activeMembers = useMemo(() => members.filter((m) => isActiveStatus(m.Status)), [members]);

  const unmatchedMembers = useMemo(() => {
    return activeMembers
      .filter((m) => (m.AreaName || '').trim() && !areas.some((a) => matchesAreaPrefix(m.AreaName, a.name)))
      .map((m) => ({ ...m, suggestion: suggestArea(m.AreaName, areas) }))
      .sort((a, b) => (a.Lastname || '').localeCompare(b.Lastname || ''));
  }, [activeMembers, areas]);

  const noAreaMembers = useMemo(() => {
    return activeMembers
      .filter((m) => !(m.AreaName || '').trim())
      .sort((a, b) => (a.Lastname || '').localeCompare(b.Lastname || ''));
  }, [activeMembers]);

  const emptyAreas = useMemo(() => {
    return areas.filter((a) => !activeMembers.some((m) => matchesAreaPrefix(m.AreaName, a.name)));
  }, [areas, activeMembers]);

  async function applySuggestion(member) {
    if (!member.suggestion) return;
    setFixingId(member.MemberIDNo);
    try {
      const { error } = await supabase
        .from('members')
        .update({ AreaName: member.suggestion.name })
        .eq('MemberIDNo', member.MemberIDNo);
      if (error) throw error;
      await loadData();
    } catch (err) {
      showAlert('Fix Failed', err.message);
    } finally {
      setFixingId(null);
    }
  }

  function handleExport() {
    exportCsv(
      'data-health-unmatched-areas',
      [
        { key: 'id', label: 'Member ID' },
        { key: 'name', label: 'Name' },
        { key: 'areaName', label: 'AreaName (as entered)' },
        { key: 'suggestion', label: 'Suggested Area' },
      ],
      unmatchedMembers.map((m) => ({
        id: m.MemberIDNo,
        name: `${m.Lastname}, ${m.Firstname}`,
        areaName: m.AreaName,
        suggestion: m.suggestion?.name || '',
      }))
    );
  }

  if (loading) return <ActivityIndicator size="large" color={NAVY} style={styles.centered} />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Ionicons name="pulse-outline" size={22} color="#0f172a" style={styles.titleIcon} />
          <Text style={styles.title}>Data Health Check</Text>
        </View>
        <Text style={styles.subtitle}>
          Finds Directory records whose Area doesn&apos;t line up with the Areas hierarchy. These members are
          invisible to any area-restricted account and don&apos;t count toward that Area&apos;s totals.
        </Text>
      </View>

      <View style={styles.summaryRow}>
        <SummaryStat label="Unmatched Area" value={unmatchedMembers.length} color="#dc2626" />
        <SummaryStat label="No Area Set" value={noAreaMembers.length} color="#d97706" />
        <SummaryStat label="Areas With No Members" value={emptyAreas.length} color="#64748b" />
      </View>

      <TableCard
        title={`Unmatched Area (${unmatchedMembers.length})`}
        subtitle="Active members whose Area text doesn't prefix-match any real Area -- most often a typo."
        right={unmatchedMembers.length > 0 ? <ExportButton onPress={handleExport} /> : undefined}
      >
        {unmatchedMembers.length === 0 ? (
          <EmptyRow label="Every active member's Area matches the Areas hierarchy." />
        ) : (
          unmatchedMembers.map((m, index) => (
            <TableRow key={m.MemberIDNo} last={index === unmatchedMembers.length - 1} style={isNarrow ? styles.narrowRow : undefined}>
              <View style={isNarrow ? undefined : { flex: 1.6 }}>
                <Text style={styles.mainText} numberOfLines={1}>{m.Lastname}, {m.Firstname}</Text>
                <Text style={styles.subText}>ID: {m.MemberIDNo}</Text>
              </View>
              <View style={isNarrow ? { marginTop: 8, alignItems: 'flex-start' } : { flex: 1.1 }}>
                <Pill label={m.AreaName} color="#b91c1c" bg="#fee2e2" />
              </View>
              <View style={[styles.fixCol, isNarrow && styles.fixColNarrow]}>
                {m.suggestion ? (
                  <>
                    <Text style={styles.suggestText} numberOfLines={1}>→ {m.suggestion.name}?</Text>
                    <TouchableOpacity
                      style={styles.fixBtn}
                      onPress={() => applySuggestion(m)}
                      disabled={fixingId === m.MemberIDNo}
                    >
                      {fixingId === m.MemberIDNo ? (
                        <ActivityIndicator size="small" color="#ffffff" />
                      ) : (
                        <Text style={styles.fixBtnText}>Apply</Text>
                      )}
                    </TouchableOpacity>
                  </>
                ) : (
                  <Text style={styles.subText}>No close match</Text>
                )}
              </View>
            </TableRow>
          ))
        )}
      </TableCard>

      <TableCard
        title={`No Area Set (${noAreaMembers.length})`}
        subtitle="Active members with a blank Area -- always visible everywhere (unrestricted), but not counted under any Area."
        style={{ marginTop: 16 }}
      >
        {noAreaMembers.length === 0 ? (
          <EmptyRow label="Every active member has an Area set." />
        ) : (
          <>
            {noAreaMembers.slice(0, 100).map((m, index) => (
              <TableRow key={m.MemberIDNo} last={index === Math.min(noAreaMembers.length, 100) - 1}>
                <Text style={[styles.mainText, { flex: 1, marginRight: 8 }]} numberOfLines={1}>{m.Lastname}, {m.Firstname}</Text>
                <Text style={[styles.subText, { flexShrink: 0 }]}>ID: {m.MemberIDNo}</Text>
              </TableRow>
            ))}
            {noAreaMembers.length > 100 && (
              <Text style={styles.moreHint}>+{noAreaMembers.length - 100} more -- see Manage Members to fix these.</Text>
            )}
          </>
        )}
      </TableCard>

      <TableCard
        title={`Areas With No Members (${emptyAreas.length})`}
        subtitle="Areas whose name doesn't prefix-match any active Directory member."
        style={{ marginTop: 16, marginBottom: 24 }}
      >
        {emptyAreas.length === 0 ? (
          <EmptyRow label="Every Area has at least one matching member." />
        ) : (
          emptyAreas.map((a, index) => (
            <TableRow key={a.id} last={index === emptyAreas.length - 1}>
              <Text style={[styles.mainText, { flex: 1 }]} numberOfLines={1}>{a.name}</Text>
              <Pill label={a.type} color="#334155" bg="#f1f5f9" />
            </TableRow>
          ))
        )}
      </TableCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  scrollContent: { padding: 16 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  header: { paddingBottom: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  titleIcon: { marginRight: 8 },
  title: { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  subtitle: { fontSize: 13, color: '#64748b', marginTop: 4, lineHeight: 19 },

  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 16 },
  summaryStat: {
    flexGrow: 1, flexBasis: 160, backgroundColor: '#ffffff', borderRadius: 12,
    borderWidth: 1, borderColor: '#e2e8f0', padding: 14,
  },
  summaryValue: { fontSize: 26, fontWeight: '800' },
  summaryLabel: { fontSize: 11, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', marginTop: 2 },

  mainText: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  subText: { fontSize: 11, color: '#64748b', marginTop: 2 },
  moreHint: { fontSize: 12, color: '#94a3b8', padding: 14, textAlign: 'center' },

  narrowRow: { flexDirection: 'column', alignItems: 'stretch' },
  fixCol: { flex: 1.3, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  fixColNarrow: { justifyContent: 'flex-start', marginTop: 10 },
  suggestText: { fontSize: 12, fontWeight: '600', color: '#15803d', flexShrink: 1 },
  fixBtn: { backgroundColor: NAVY, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, minWidth: 56, alignItems: 'center' },
  fixBtnText: { fontSize: 11, fontWeight: '700', color: '#ffffff' },
});
