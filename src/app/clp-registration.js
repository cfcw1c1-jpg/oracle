import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
import { SERVICE_SUB_TYPES } from '../screens/ClpMaintenance';

// Public, unauthenticated page: a member self-registers into ONE specific
// CLP training batch and picks their own role. Deliberately does not
// import the gated Page component from src/app/index.js — no session
// check here, mirrors src/app/training-lookup.js.
//
// Which batch is scoped by a `token` query param (?token=<uuid>) matching
// clp_trainings.public_token — there is no batch browser here, so a link
// only ever grants access to the one batch it was generated for. Links are
// generated from the admin ClpMaintenance screen ("Copy Public Link").
// Batch creation stays admin-only; see
// scripts/sql/enable-public-clp-registration-insert.sql and
// scripts/sql/add-clp-trainings-public-token.sql.
export default function ClpRegistration() {
  const { token } = useLocalSearchParams();

  const [training, setTraining] = useState(null);
  const [loadingTraining, setLoadingTraining] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);
  const debounceRef = useRef(null);

  const [isServiceTeam, setIsServiceTeam] = useState(false);
  const [selectedSubType, setSelectedSubType] = useState(SERVICE_SUB_TYPES[0]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
  const [success, setSuccess] = useState(false);

  async function fetchTraining(publicToken) {
    try {
      setLoadingTraining(true);
      setLoadError(false);
      const { data, error } = await supabase
        .from('clp_trainings')
        .select('*')
        .eq('public_token', publicToken)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        setLoadError(true);
      } else {
        setTraining(data);
      }
    } catch (err) {
      console.error('Failed to load training batch:', err.message);
      setLoadError(true);
    } finally {
      setLoadingTraining(false);
    }
  }

  useEffect(() => {
    if (typeof token === 'string' && token.length > 0) {
      fetchTraining(token);
    } else {
      setLoadingTraining(false);
      setLoadError(true);
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [token]);

  async function searchMembers(q) {
    try {
      setSearching(true);
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
      setResults(deduped.slice(0, 10));
    } catch (err) {
      console.error('Member search failed:', err.message);
      setResults([]);
    } finally {
      setSearching(false);
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
    setQuery('');
    setResults([]);
    setSubmitError('');
    setAlreadyRegistered(false);

    try {
      const { data, error } = await supabase
        .from('clp_training_participants')
        .select('id')
        .eq('clp_training_id', training.id)
        .eq('MemberIDNo', member.MemberIDNo)
        .maybeSingle();
      if (error) throw error;
      if (data) setAlreadyRegistered(true);
    } catch (err) {
      console.error('Failed to check existing registration:', err.message);
    }
  }

  async function handleSubmit() {
    if (!training || !selectedMember || alreadyRegistered) return;

    try {
      setSubmitting(true);
      setSubmitError('');
      const { error } = await supabase.from('clp_training_participants').insert([{
        MemberIDNo: selectedMember.MemberIDNo,
        type: isServiceTeam ? 'service_team' : 'participant',
        sub_type: isServiceTeam ? selectedSubType : null,
        clp_training_id: training.id,
      }]);
      if (error) throw error;
      setSuccess(true);
    } catch (err) {
      setSubmitError(err.message || 'Something went wrong while saving your registration.');
    } finally {
      setSubmitting(false);
    }
  }

  function registerAnother() {
    setQuery('');
    setResults([]);
    setSelectedMember(null);
    setIsServiceTeam(false);
    setSelectedSubType(SERVICE_SUB_TYPES[0]);
    setSubmitError('');
    setAlreadyRegistered(false);
    setSuccess(false);
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Image source={require('../../assets/images/oracle-logo.png')} style={styles.headerLogo} resizeMode="contain" />
        <Text style={styles.headerTitle}>ORACLE</Text>
        <Text style={styles.headerSubtitle}>CLP TRAINING REGISTRATION</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.card}>
          {loadingTraining ? (
            <ActivityIndicator size="large" color="#002060" style={styles.loadingSpacer} />
          ) : loadError || !training ? (
            <View style={styles.invalidWrap}>
              <Ionicons name="link-outline" size={40} color="#94a3b8" />
              <Text style={styles.invalidTitle}>Invalid or Expired Link</Text>
              <Text style={styles.invalidSubtitle}>
                This registration link isn&apos;t recognized. Please use the link shared by your CLP batch coordinator.
              </Text>
            </View>
          ) : !success ? (
            <>
              <View style={styles.selectedBatchBanner}>
                <Ionicons name="construct-outline" size={16} color="#002060" style={{ marginRight: 8 }} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.selectedBatchVenue} numberOfLines={1}>{training.venue}</Text>
                  <Text style={styles.selectedBatchDates}>{training.start_date} to {training.end_date}</Text>
                </View>
              </View>

              {/* STEP 1: FIND YOURSELF */}
              <Text style={styles.stepLabel}>Step 1 of 2</Text>
              <Text style={styles.stepTitle}>Find your name in the member directory</Text>

              {!selectedMember ? (
                <>
                  <View style={styles.searchInputWrap}>
                    <Ionicons name="search-outline" size={18} color="#64748b" style={{ marginRight: 8 }} />
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
                </>
              ) : (
                <>
                  <View style={styles.selectedMemberBanner}>
                    <View style={styles.memberAvatar}>
                      <Text style={styles.memberAvatarText}>
                        {(selectedMember.Firstname?.[0] || '') + (selectedMember.Lastname?.[0] || '')}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName}>{selectedMember.Lastname}, {selectedMember.Firstname}</Text>
                      <Text style={styles.memberId}>Member ID: {selectedMember.MemberIDNo}</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => { setSelectedMember(null); setAlreadyRegistered(false); }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="close-circle" size={22} color="#94a3b8" />
                    </TouchableOpacity>
                  </View>

                  {alreadyRegistered ? (
                    <View style={styles.warningBox}>
                      <Ionicons name="alert-circle-outline" size={16} color="#b45309" style={{ marginRight: 8 }} />
                      <Text style={styles.warningText}>This member is already registered for this batch.</Text>
                    </View>
                  ) : (
                    <>
                      {/* STEP 2: ROLE */}
                      <Text style={styles.stepLabel}>Step 2 of 2</Text>
                      <Text style={styles.stepTitle}>Select your role for this batch</Text>

                      <View style={styles.toggleRow}>
                        <TouchableOpacity
                          style={[styles.toggleBtn, !isServiceTeam && styles.toggleBtnActive]}
                          onPress={() => setIsServiceTeam(false)}
                        >
                          <Text style={[styles.toggleBtnText, !isServiceTeam && styles.toggleBtnTextActive]}>Participant</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.toggleBtn, isServiceTeam && styles.toggleBtnActive]}
                          onPress={() => setIsServiceTeam(true)}
                        >
                          <Text style={[styles.toggleBtnText, isServiceTeam && styles.toggleBtnTextActive]}>Service Team</Text>
                        </TouchableOpacity>
                      </View>

                      {isServiceTeam && (
                        <View style={{ marginBottom: 14 }}>
                          <Text style={styles.inputLabel}>Service Team Assignment Role</Text>
                          <View style={styles.subTypeGrid}>
                            {SERVICE_SUB_TYPES.map((role) => {
                              const isRoleSelected = selectedSubType === role;
                              return (
                                <TouchableOpacity
                                  key={role}
                                  style={[styles.subTypeChip, isRoleSelected && styles.subTypeChipActive]}
                                  onPress={() => setSelectedSubType(role)}
                                >
                                  <Text style={[styles.subTypeChipText, isRoleSelected && styles.subTypeChipTextActive]}>
                                    {role}
                                  </Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                        </View>
                      )}

                      {submitError ? <Text style={styles.errorText}>{submitError}</Text> : null}

                      <TouchableOpacity
                        style={[styles.submitBtn, submitting && styles.btnDisabled]}
                        onPress={handleSubmit}
                        disabled={submitting}
                      >
                        {submitting ? (
                          <ActivityIndicator size="small" color="#ffffff" />
                        ) : (
                          <Text style={styles.submitBtnText}>Complete Registration</Text>
                        )}
                      </TouchableOpacity>
                    </>
                  )}
                </>
              )}
            </>
          ) : (
            /* SUCCESS STATE */
            <View style={styles.successWrap}>
              <Ionicons name="checkmark-circle" size={48} color="#16a34a" />
              <Text style={styles.successTitle}>You&apos;re registered!</Text>
              <Text style={styles.successSubtitle}>
                {selectedMember.Lastname}, {selectedMember.Firstname} has been added to{' '}
                {training.venue} ({training.start_date} to {training.end_date}) as{' '}
                {isServiceTeam ? selectedSubType : 'a Participant'}.
              </Text>

              <TouchableOpacity style={styles.submitBtn} onPress={registerAnother}>
                <Text style={styles.submitBtnText}>Register Another Member</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { backgroundColor: '#002060', paddingVertical: 20, paddingHorizontal: 20, alignItems: 'center' },
  headerLogo: { width: 46, height: 40, marginBottom: 8 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#fff', letterSpacing: 2 },
  headerSubtitle: { fontSize: 11, color: '#93c5fd', letterSpacing: 1, fontWeight: '500', marginTop: 4 },

  body: { padding: 20, alignItems: 'center' },
  card: {
    width: '100%', maxWidth: 560, backgroundColor: '#ffffff', borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: '#e2e8f0', marginTop: 12,
  },

  stepLabel: { fontSize: 11, fontWeight: '700', color: '#2563eb', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  stepTitle: { fontSize: 15, fontWeight: '800', color: '#0f172a', marginBottom: 14 },

  loadingSpacer: { marginTop: 30, marginBottom: 30 },

  invalidWrap: { alignItems: 'center', paddingVertical: 20 },
  invalidTitle: { fontSize: 17, fontWeight: '800', color: '#0f172a', marginTop: 14 },
  invalidSubtitle: { fontSize: 13, color: '#64748b', textAlign: 'center', marginTop: 8, lineHeight: 19 },

  selectedBatchBanner: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#eff6ff', borderWidth: 1,
    borderColor: '#bfdbfe', borderRadius: 10, padding: 12, marginBottom: 20,
  },
  selectedBatchVenue: { fontSize: 13, fontWeight: '700', color: '#1e3a8a' },
  selectedBatchDates: { fontSize: 11, color: '#3b82f6', marginTop: 2 },

  searchInputWrap: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: Platform.OS === 'ios' ? 12 : 4, backgroundColor: '#f8fafc',
  },
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

  selectedMemberBanner: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', borderWidth: 1,
    borderColor: '#e2e8f0', borderRadius: 10, padding: 12, marginBottom: 18,
  },
  memberAvatar: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: '#002060',
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  memberAvatarText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  memberName: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  memberId: { fontSize: 11, color: '#64748b', marginTop: 1 },

  warningBox: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fffbeb', borderWidth: 1,
    borderColor: '#fde68a', borderRadius: 10, padding: 12,
  },
  warningText: { flex: 1, fontSize: 12, color: '#92400e', fontWeight: '600' },

  toggleRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  toggleBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: '#f1f5f9', alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0' },
  toggleBtnActive: { backgroundColor: '#002060', borderColor: '#002060' },
  toggleBtnText: { fontSize: 12, fontWeight: '600', color: '#475569' },
  toggleBtnTextActive: { color: '#ffffff', fontWeight: '700' },

  inputLabel: { fontSize: 11, fontWeight: '700', color: '#475569', textTransform: 'uppercase', marginBottom: 6 },
  subTypeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingVertical: 4 },
  subTypeChip: { backgroundColor: '#f1f5f9', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: '#e2e8f0' },
  subTypeChipActive: { backgroundColor: '#e0f2fe', borderColor: '#0284c7' },
  subTypeChipText: { fontSize: 11, color: '#475569', fontWeight: '500' },
  subTypeChipTextActive: { color: '#0369a1', fontWeight: '700' },

  errorText: { color: '#dc2626', fontSize: 12, marginBottom: 10, textAlign: 'center' },
  submitBtn: { backgroundColor: '#2563eb', borderRadius: 10, paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
  submitBtnText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  btnDisabled: { opacity: 0.6 },

  successWrap: { alignItems: 'center', paddingVertical: 10 },
  successTitle: { fontSize: 18, fontWeight: '800', color: '#0f172a', marginTop: 12 },
  successSubtitle: { fontSize: 13, color: '#64748b', textAlign: 'center', marginTop: 8, marginBottom: 20, lineHeight: 19 },
});
