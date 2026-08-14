import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import PrivacyConsentGate from '../components/privacy-consent-gate';
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

// Public, unauthenticated page: look up your OWN combined PFO + CLP
// training history. Deliberately does not import the gated Page component
// from src/app/index.js — no session check here.
//
// Requires an exact Member ID *and* exact Last Name match (see
// scripts/sql/lock-down-public-lookup-access.sql) rather than an
// open-ended name search — the anon key this page runs under is embedded
// in every page's JS bundle, not gated by this page's URL, so anything
// short of "you must already know identifying info about the specific
// record you're asking for" would let anyone browse the whole roster.
export default function TrainingLookup() {
  const [memberIdInput, setMemberIdInput] = useState('');
  const [lastnameInput, setLastnameInput] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);
  const [historyError, setHistoryError] = useState('');
  const [pfoRow, setPfoRow] = useState(null);
  const [clpRows, setClpRows] = useState([]);

  async function handleLookup() {
    const memberId = memberIdInput.trim();
    const lastname = lastnameInput.trim();
    if (!memberId || !lastname) return;

    setLookingUp(true);
    setNotFound(false);
    setHistoryError('');
    try {
      const { data, error } = await supabase.rpc('lookup_own_training_record', {
        p_member_id: memberId,
        p_lastname: lastname,
      });
      if (error) throw error;

      recordSearchLog({
        event_type: 'search',
        query: `${memberId} / ${lastname}`,
        results_count: data ? 1 : 0,
      });

      if (!data) {
        setNotFound(true);
        return;
      }

      recordSearchLog({
        event_type: 'view_member',
        member_id_no: data.MemberIDNo?.toString(),
        member_name: `${data.Lastname}, ${data.Firstname}`,
      });

      setSelectedMember({ MemberIDNo: data.MemberIDNo, Firstname: data.Firstname, Lastname: data.Lastname });
      setPfoRow(data.pfo || null);
      setClpRows(data.clp || []);
    } catch (err) {
      console.error('Lookup failed:', err.message);
      setHistoryError('Something went wrong while loading training history. Please try again.');
    } finally {
      setLookingUp(false);
    }
  }

  function resetSearch() {
    setSelectedMember(null);
    setPfoRow(null);
    setClpRows([]);
    setHistoryError('');
    setNotFound(false);
    setMemberIdInput('');
    setLastnameInput('');
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
    <PrivacyConsentGate purpose="view your training record">
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Image source={require('../../assets/images/oracle-logo.png')} style={styles.headerLogo} resizeMode="contain" />
        <Text style={styles.headerTitle}>ORACLE</Text>
        <Text style={styles.headerSubtitle}>TRAINING RECORDS LOOKUP</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {!selectedMember ? (
          <View style={styles.searchCard}>
            <Text style={styles.searchLabel}>Enter your Member ID and Last Name to view your record</Text>

            <Text style={styles.inputLabel}>Member ID</Text>
            <View style={styles.searchInputWrap}>
              <Ionicons name="finger-print-outline" size={18} color="#64748b" style={styles.searchIcon} />
              <TextInput
                value={memberIdInput}
                onChangeText={setMemberIdInput}
                placeholder="e.g. PM-00123"
                placeholderTextColor="#94a3b8"
                style={styles.searchInput}
                autoCapitalize="characters"
                autoFocus={Platform.OS === 'web'}
                returnKeyType="next"
              />
            </View>

            <Text style={styles.inputLabel}>Last Name</Text>
            <View style={styles.searchInputWrap}>
              <Ionicons name="person-outline" size={18} color="#64748b" style={styles.searchIcon} />
              <TextInput
                value={lastnameInput}
                onChangeText={setLastnameInput}
                placeholder="e.g. Dela Cruz"
                placeholderTextColor="#94a3b8"
                style={styles.searchInput}
                returnKeyType="go"
                onSubmitEditing={handleLookup}
              />
            </View>

            <TouchableOpacity
              style={[styles.lookupBtn, (!memberIdInput.trim() || !lastnameInput.trim() || lookingUp) && styles.lookupBtnDisabled]}
              onPress={handleLookup}
              disabled={!memberIdInput.trim() || !lastnameInput.trim() || lookingUp}
            >
              {lookingUp ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.lookupBtnText}>View My Record</Text>}
            </TouchableOpacity>

            {notFound && (
              <Text style={styles.noResultsText}>No record matches that Member ID and Last Name. Please check both and try again.</Text>
            )}
          </View>
        ) : (
          <View style={styles.resultsCard}>
            <TouchableOpacity style={styles.backButton} onPress={resetSearch} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
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

            {historyError ? (
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
                          <Text style={styles.clpVenue}>{row.venue || 'Unknown venue'}</Text>
                          <Text style={styles.clpDates}>
                            {row.start_date} to {row.end_date}
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
    </PrivacyConsentGate>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { backgroundColor: '#002060', paddingVertical: 20, paddingHorizontal: 20, alignItems: 'center' },
  headerLogo: { width: 46, height: 40, marginBottom: 8 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#fff', letterSpacing: 2 },
  headerSubtitle: { fontSize: 11, color: '#93c5fd', letterSpacing: 1, fontWeight: '500', marginTop: 4 },

  body: { padding: 20, alignItems: 'center' },

  searchCard: {
    width: '100%', maxWidth: 520, backgroundColor: '#ffffff', borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: '#e2e8f0', marginTop: 12,
  },
  searchLabel: { fontSize: 14, fontWeight: '700', color: '#1e293b', marginBottom: 16, lineHeight: 20 },
  inputLabel: { fontSize: 11, fontWeight: '700', color: '#475569', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 6 },
  searchInputWrap: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: Platform.OS === 'ios' ? 12 : 4, backgroundColor: '#f8fafc',
    marginBottom: 14,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: '#0f172a', paddingVertical: 8 },
  noResultsText: { marginTop: 14, fontSize: 13, color: '#64748b', textAlign: 'center' },

  lookupBtn: {
    backgroundColor: '#2563eb', borderRadius: 10, paddingVertical: 13,
    alignItems: 'center', justifyContent: 'center', marginTop: 4,
  },
  lookupBtnDisabled: { opacity: 0.5 },
  lookupBtnText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },

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
