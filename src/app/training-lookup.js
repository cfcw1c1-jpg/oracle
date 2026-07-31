import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { parseTrainingName, TRAINING_COLUMNS } from '../screens/PfoList';

// "Structural Status" holds non-training demographic flags (SMB/UM), not
// real modules, so it's excluded from the module-completion breakdown.
const MODULE_GROUPS = [...new Set(TRAINING_COLUMNS.map((c) => c.group))].filter(
  (group) => group !== 'Structural Status'
);

async function recordSearchLog(entry) {
  try {
    await supabase.from('training_lookup_logs').insert([entry]);
  } catch (err) {
    console.warn('Failed to record search log:', err?.message);
  }
}

// Public, unauthenticated page: search a member by name and view their
// combined PFO + CLP training history. Deliberately does not import the
// gated Page component from src/app/index.js — no session check here.
export default function TrainingLookup() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [pfoRow, setPfoRow] = useState(null);
  const [clpRows, setClpRows] = useState([]);
  const debounceRef = useRef(null);

  // Clear any pending debounced search on unmount.
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  async function searchMembers(q) {
    let resultsCount = null;
    try {
      setSearching(true);
      // Two separate ilike() calls instead of a single .or() DSL string —
      // .or() treats ".", ",", "(", ")" as filter syntax, so a searched
      // name containing any of those (e.g. "Q." in a middle initial) would
      // break the server-side parser. ilike() takes the pattern as an
      // opaque, safely-encoded value with no such risk.
      const pattern = `%${q}%`;
      const [{ data: byFirst, error: firstError }, { data: byLast, error: lastError }] = await Promise.all([
        supabase.from('members').select('MemberIDNo, Firstname, Lastname').ilike('Firstname', pattern).limit(10),
        supabase.from('members').select('MemberIDNo, Firstname, Lastname').ilike('Lastname', pattern).limit(10),
      ]);
      if (firstError) throw firstError;
      if (lastError) throw lastError;

      const merged = [...(byFirst || []), ...(byLast || [])];
      const deduped = [...new Map(merged.map((m) => [m.MemberIDNo, m])).values()];
      deduped.sort((a, b) => (a.Lastname || '').localeCompare(b.Lastname || ''));
      const limited = deduped.slice(0, 10);

      setResults(limited);
      resultsCount = limited.length;
    } catch (err) {
      console.error('Member search failed:', err.message);
      setResults([]);
    } finally {
      setSearching(false);
      recordSearchLog({ event_type: 'search', query: q, results_count: resultsCount });
    }
  }

  function handleQueryChange(text) {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = text.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => searchMembers(trimmed), 350);
  }

  async function selectMember(member) {
    setSelectedMember(member);
    setResults([]);
    setQuery('');
    setHistoryError('');
    setLoadingHistory(true);
    recordSearchLog({
      event_type: 'view_member',
      member_id_no: member.MemberIDNo?.toString(),
      member_name: `${member.Lastname}, ${member.Firstname}`,
    });
    try {
      const [{ data: pfoData, error: pfoError }, { data: clpData, error: clpError }] = await Promise.all([
        supabase.from('pfo_members').select('*').eq('MemberIDNo', member.MemberIDNo).maybeSingle(),
        supabase
          .from('clp_training_participants')
          .select('id, type, sub_type, clp_trainings ( start_date, end_date, venue )')
          .eq('MemberIDNo', member.MemberIDNo),
      ]);
      if (pfoError) throw pfoError;
      if (clpError) throw clpError;
      setPfoRow(pfoData || null);
      setClpRows(clpData || []);
    } catch (err) {
      console.error('Failed to load training history:', err.message);
      setHistoryError('Something went wrong while loading training history. Please try again.');
    } finally {
      setLoadingHistory(false);
    }
  }

  function resetSearch() {
    setSelectedMember(null);
    setPfoRow(null);
    setClpRows([]);
    setHistoryError('');
    setQuery('');
    setResults([]);
  }

  const completedPfo = pfoRow
    ? TRAINING_COLUMNS.filter((col) => pfoRow[col.id] === 'Y' || pfoRow[col.id] === 'y')
    : [];

  const groupedPfo = completedPfo.reduce((acc, col) => {
    if (!acc[col.group]) acc[col.group] = [];
    acc[col.group].push(col);
    return acc;
  }, {});

  const moduleCompletion = MODULE_GROUPS.map((group) => {
    const cols = TRAINING_COLUMNS.filter((c) => c.group === group);
    const completed = pfoRow
      ? cols.filter((c) => pfoRow[c.id] === 'Y' || pfoRow[c.id] === 'y').length
      : 0;
    const total = cols.length;
    return { group, completed, total, pct: total > 0 ? Math.round((completed / total) * 100) : 0 };
  });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>ORACLE</Text>
        <Text style={styles.headerSubtitle}>TRAINING RECORDS LOOKUP</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {!selectedMember ? (
          <View style={styles.searchCard}>
            <Text style={styles.searchLabel}>Search for a member by name</Text>
            <View style={styles.searchInputWrap}>
              <Ionicons name="search-outline" size={18} color="#64748b" style={styles.searchIcon} />
              <TextInput
                value={query}
                onChangeText={handleQueryChange}
                placeholder="e.g. Dela Cruz, Juan"
                placeholderTextColor="#94a3b8"
                style={styles.searchInput}
                autoFocus={Platform.OS === 'web'}
              />
              {searching && <ActivityIndicator size="small" color="#002060" />}
            </View>

            {results.length > 0 && (
              <View style={styles.resultsList}>
                {results.map((m) => (
                  <TouchableOpacity key={m.MemberIDNo} style={styles.resultItem} onPress={() => selectMember(m)}>
                    <View style={styles.resultAvatar}>
                      <Text style={styles.resultAvatarText}>
                        {(m.Firstname?.[0] || '') + (m.Lastname?.[0] || '')}
                      </Text>
                    </View>
                    <View>
                      <Text style={styles.resultName}>{m.Lastname}, {m.Firstname}</Text>
                      <Text style={styles.resultId}>ID: {m.MemberIDNo}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {!searching && query.trim().length > 0 && results.length === 0 && (
              <Text style={styles.noResultsText}>No matching members found.</Text>
            )}
          </View>
        ) : (
          <View style={styles.resultsCard}>
            <TouchableOpacity style={styles.backButton} onPress={resetSearch}>
              <Ionicons name="arrow-back-outline" size={16} color="#002060" />
              <Text style={styles.backButtonText}>Search another member</Text>
            </TouchableOpacity>

            <View style={styles.memberHeaderRow}>
              <View style={styles.memberAvatar}>
                <Text style={styles.memberAvatarText}>
                  {(selectedMember.Firstname?.[0] || '') + (selectedMember.Lastname?.[0] || '')}
                </Text>
              </View>
              <View>
                <Text style={styles.memberName}>{selectedMember.Lastname}, {selectedMember.Firstname}</Text>
                <Text style={styles.memberId}>Member ID: {selectedMember.MemberIDNo}</Text>
              </View>
            </View>

            {loadingHistory ? (
              <ActivityIndicator size="large" color="#002060" style={styles.loadingSpacer} />
            ) : historyError ? (
              <Text style={styles.errorText}>{historyError}</Text>
            ) : (
              <>
                <View style={styles.sectionBlock}>
                  <Text style={styles.sectionTitle}>Completion by Module</Text>
                  {moduleCompletion.map((m) => (
                    <View key={m.group} style={styles.moduleRow}>
                      <View style={styles.moduleRowHeader}>
                        <Text style={styles.moduleName} numberOfLines={1}>{m.group}</Text>
                        <Text style={styles.modulePct}>{m.pct}% ({m.completed}/{m.total})</Text>
                      </View>
                      <View style={styles.progressTrack}>
                        <View
                          style={[
                            styles.progressFill,
                            { width: `${m.pct}%` },
                            m.pct === 100 && styles.progressFillComplete,
                          ]}
                        />
                      </View>
                    </View>
                  ))}
                </View>

                <View style={styles.sectionBlock}>
                  <Text style={styles.sectionTitle}>PFO Trainings Completed ({completedPfo.length})</Text>
                  {completedPfo.length === 0 ? (
                    <Text style={styles.emptyText}>No PFO trainings on record yet.</Text>
                  ) : (
                    Object.entries(groupedPfo).map(([group, cols]) => (
                      <View key={group} style={styles.groupBlock}>
                        <Text style={styles.groupLabel}>{group}</Text>
                        {cols.map((col) => (
                          <View key={col.id} style={styles.trainingRow}>
                            <Ionicons name="checkmark-circle" size={16} color="#16a34a" />
                            <Text style={styles.trainingRowText}>{parseTrainingName(col.id) || col.label}</Text>
                          </View>
                        ))}
                      </View>
                    ))
                  )}
                </View>

                <View style={styles.sectionBlock}>
                  <Text style={styles.sectionTitle}>CLP Trainings Attended ({clpRows.length})</Text>
                  {clpRows.length === 0 ? (
                    <Text style={styles.emptyText}>No CLP training batches on record yet.</Text>
                  ) : (
                    clpRows.map((row) => (
                      <View key={row.id} style={styles.clpRow}>
                        <Ionicons name="construct-outline" size={16} color="#002060" style={styles.clpIcon} />
                        <View style={styles.clpTextWrap}>
                          <Text style={styles.clpVenue}>{row.clp_trainings?.venue || 'Unknown venue'}</Text>
                          <Text style={styles.clpDates}>
                            {row.clp_trainings?.start_date} to {row.clp_trainings?.end_date}
                          </Text>
                        </View>
                        <Text style={styles.clpRole}>
                          {row.type === 'service_team' ? (row.sub_type || 'Service Team') : 'Participant'}
                        </Text>
                      </View>
                    ))
                  )}
                </View>
              </>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { backgroundColor: '#002060', paddingVertical: 20, paddingHorizontal: 20, alignItems: 'center' },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#fff', letterSpacing: 2 },
  headerSubtitle: { fontSize: 11, color: '#93c5fd', letterSpacing: 1, fontWeight: '500', marginTop: 4 },

  body: { padding: 20, alignItems: 'center' },

  searchCard: {
    width: '100%', maxWidth: 520, backgroundColor: '#ffffff', borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: '#e2e8f0', marginTop: 12,
  },
  searchLabel: { fontSize: 14, fontWeight: '700', color: '#1e293b', marginBottom: 12 },
  searchInputWrap: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: Platform.OS === 'ios' ? 12 : 4, backgroundColor: '#f8fafc',
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: '#0f172a', paddingVertical: 8 },
  noResultsText: { marginTop: 14, fontSize: 13, color: '#64748b', textAlign: 'center' },

  resultsList: { marginTop: 14, borderTopWidth: 1, borderColor: '#f1f5f9', paddingTop: 6 },
  resultItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4, borderRadius: 8 },
  resultAvatar: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: '#002060',
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  resultAvatarText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  resultName: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  resultId: { fontSize: 11, color: '#64748b', marginTop: 1 },

  resultsCard: {
    width: '100%', maxWidth: 640, backgroundColor: '#ffffff', borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: '#e2e8f0', marginTop: 12,
  },
  backButton: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  backButtonText: { color: '#002060', fontWeight: '700', fontSize: 13, marginLeft: 6 },

  memberHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  memberAvatar: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: '#002060',
    alignItems: 'center', justifyContent: 'center', marginRight: 14,
  },
  memberAvatarText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  memberName: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  memberId: { fontSize: 12, color: '#64748b', marginTop: 2 },

  loadingSpacer: { marginTop: 40, marginBottom: 40 },
  errorText: { color: '#dc2626', fontSize: 13, textAlign: 'center', marginTop: 20 },

  sectionBlock: { marginTop: 8, marginBottom: 20 },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: '#0f172a', marginBottom: 10 },
  emptyText: { fontSize: 13, color: '#94a3b8' },

  moduleRow: { marginBottom: 12 },
  moduleRowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  moduleName: { fontSize: 12, fontWeight: '600', color: '#334155', flexShrink: 1, marginRight: 8 },
  modulePct: { fontSize: 12, fontWeight: '700', color: '#002060' },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: '#e2e8f0', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4, backgroundColor: '#2563eb' },
  progressFillComplete: { backgroundColor: '#16a34a' },

  groupBlock: { marginBottom: 12 },
  groupLabel: { fontSize: 11, fontWeight: '700', color: '#64748b', letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase' },
  trainingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  trainingRowText: { fontSize: 13, color: '#1e293b', marginLeft: 8 },

  clpRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12,
    backgroundColor: '#f8fafc', borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: '#f1f5f9',
  },
  clpIcon: { marginRight: 4 },
  clpTextWrap: { flex: 1 },
  clpVenue: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  clpDates: { fontSize: 11, color: '#64748b', marginTop: 2 },
  clpRole: { fontSize: 11, fontWeight: '700', color: '#002060', backgroundColor: '#e0e7ff', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
});
