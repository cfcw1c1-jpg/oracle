import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Modal,
    Platform,
    ScrollView,
    Share,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { supabase } from '../../lib/supabase';

// Builds the public self-registration link for a batch. The link is
// scoped to public_token (a random UUID), not the sequential `id`, so it
// can't be walked/enumerated — see scripts/sql/add-clp-trainings-public-token.sql.
function buildPublicRegistrationLink(training) {
  const origin = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/clp-registration?token=${training.public_token}`;
}

// Supported assignment designations for Service Team entities
export const SERVICE_SUB_TYPES = [
  'Team Leader',
  'Assistant Team Leader',
  'Supervising Unit Head',
  'Supervising Leader',
  'Team Servant',
  'Prayer Warrior',
  'Music Ministry',
  'Facilitator',
  'Assistant Facilitator',
  'Service Team',
  'Secretariat',
];

export default function ClpMaintenance() {
  // --- INPUT FIELD REF ---
  const memberSearchInputRef = useRef(null);

  // Loading & Data States
  const [loading, setLoading] = useState(false);
  const [trainings, setTrainings] = useState([]);
  const [selectedTraining, setSelectedTraining] = useState(null);
  const [participants, setParticipants] = useState([]);

  // Modal Visibility States
  const [trainingModalVisible, setTrainingModalVisible] = useState(false);
  const [participantModalVisible, setParticipantModalVisible] = useState(false);

  // Form Input States
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [venue, setVenue] = useState('');
  
  const [isServiceTeam, setIsServiceTeam] = useState(false);
  const [selectedSubType, setSelectedSubType] = useState('Team Leader'); // Default assignment subset

  // --- MEMBER SEARCH DROPDOWN STATES ---
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchingMembers, setSearchingMembers] = useState(false);
  const [stagedMembers, setStagedMembers] = useState([]);

  // --- PUBLIC LINK SHARE STATE ---
  const [linkCopied, setLinkCopied] = useState(false);

  // --- DERIVED METRICS ---
  const activeParticipantsCount = participants.filter(p => p.type === 'participant').length;
  const serviceTeamCount = participants.filter(p => p.type === 'service_team').length;

  // --- CROSS-PLATFORM ALERT HELPER ---
  const showAlert = (title, message) => {
    if (Platform.OS === 'web') {
      window.alert(`${title}\n\n${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  // Load trainings on mount
  useEffect(() => {
    fetchTrainings();
  }, []);

  // Fetch participants whenever the selected training changes
  useEffect(() => {
    if (selectedTraining) {
      fetchParticipants(selectedTraining.id);
    } else {
      setParticipants([]);
    }
  }, [selectedTraining]);

  // Trigger dynamic lookup when name queries change
  useEffect(() => {
    if (searchQuery.trim().length >= 2) {
      searchMembersFromDb(searchQuery);
    } else {
      setSearchResults([]);
    }
  }, [searchQuery]);

  // --- API CALLS ---

  async function fetchTrainings() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('clp_trainings')
        .select('*')
        .order('start_date', { ascending: false });

      if (error) throw error;
      setTrainings(data || []);
      if (data && data.length > 0 && !selectedTraining) {
        setSelectedTraining(data[0]);
      }
    } catch (err) {
      showAlert('Error Fetching Trainings', err.message);
    } finally {
      setLoading(false);
    }
  }

  async function fetchParticipants(trainingId) {
    try {
      const { data, error } = await supabase
        .from('clp_training_participants')
        .select(`
          id,
          MemberIDNo,
          type,
          sub_type,
          members (Firstname, Lastname)
        `)
        .eq('clp_training_id', trainingId);

      if (error) throw error;
      setParticipants(data || []);
    } catch (err) {
      console.error('Error fetching participants:', err.message);
    }
  }

  async function searchMembersFromDb(query) {
    try {
      setSearchingMembers(true);
      const { data, error } = await supabase
        .from('members')
        .select('MemberIDNo, Firstname, Lastname')
        .or(`Firstname.ilike.%${query}%,Lastname.ilike.%${query}%`)
        .limit(5);

      if (error) throw error;
      
      const filtered = (data || []).filter(
        (m) => !stagedMembers.some((staged) => staged.MemberIDNo === m.MemberIDNo)
      );
      setSearchResults(filtered);
    } catch (err) {
      console.error('Error looking up members:', err.message);
    } finally {
      setSearchingMembers(false);
    }
  }

  async function handleAddTraining() {
    if (!startDate || !endDate || !venue) {
      showAlert('Validation Error', 'Please fill in all training fields.');
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('clp_trainings')
        .insert([{ start_date: startDate, end_date: endDate, venue }])
        .select();

      if (error) throw error;

      showAlert('Success', 'CLP Training Batch created successfully!');
      setTrainingModalVisible(false);
      setStartDate('');
      setEndDate('');
      setVenue('');
      
      await fetchTrainings();
      if (data && data[0]) setSelectedTraining(data[0]);
    } catch (err) {
      showAlert('Insertion Failed', err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddParticipant() {
    if (stagedMembers.length === 0) {
      showAlert('Validation Error', 'Please search and select at least one member.');
      return;
    }
    if (!selectedTraining) return;

    try {
      setLoading(true);
      const targetType = isServiceTeam ? 'service_team' : 'participant';
      const targetSubType = isServiceTeam ? selectedSubType : null;

      const insertRows = stagedMembers.map((member) => ({
        MemberIDNo: member.MemberIDNo,
        type: targetType,
        sub_type: targetSubType,
        clp_training_id: selectedTraining.id,
      }));

      const { error } = await supabase
        .from('clp_training_participants')
        .insert(insertRows);

      if (error) throw error;

      showAlert('Success', `Registered ${stagedMembers.length} members to batch.`);
      setParticipantModalVisible(false);
      resetParticipantForm();
      
      fetchParticipants(selectedTraining.id);
    } catch (err) {
      showAlert('Registration Failed', err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCopyPublicLink() {
    if (!selectedTraining) return;
    const url = buildPublicRegistrationLink(selectedTraining);

    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(url);
        setLinkCopied(true);
        setTimeout(() => setLinkCopied(false), 2000);
      } catch (err) {
        showAlert('Copy Failed', `Please copy the link manually:\n\n${url}`);
      }
      return;
    }

    try {
      await Share.share({ message: url });
    } catch (err) {
      if (err.message !== 'User did not share') showAlert('Share Failed', err.message);
    }
  }

  function resetParticipantForm() {
    setSearchQuery('');
    setSearchResults([]);
    setStagedMembers([]);
    setIsServiceTeam(false);
    setSelectedSubType('Team Leader');
  }

  function toggleStageMember(member) {
    setStagedMembers((prev) => [...prev, member]);
    setSearchQuery('');
    setSearchResults([]);
    
    // Auto-focus back to the search input after a user is appended
    setTimeout(() => {
      memberSearchInputRef.current?.focus();
    }, 50);
  }

  // Auto focus when modal mounts/opens completely
  function handleFocusOnModalOpen() {
    setTimeout(() => {
      memberSearchInputRef.current?.focus();
    }, 50);
  }

  function removeStagedMember(idNo) {
    setStagedMembers((prev) => prev.filter((m) => m.MemberIDNo !== idNo));
  }

  async function handleDeleteParticipant(item) {
    const title = 'Remove Participant';
    const message = 'Are you sure you want to remove this member from the training?';

    if (Platform.OS === 'web') {
      const confirmed = window.confirm(`${title}\n\n${message}`);
      if (confirmed) {
        executeDeletion(item);
      }
      return;
    }

    Alert.alert(
      title,
      message,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => executeDeletion(item),
        },
      ]
    );
  }

  async function executeDeletion(item) {
    try {
      const { error } = await supabase
        .from('clp_training_participants')
        .delete()
        .eq('MemberIDNo', item.MemberIDNo)
        .eq('clp_training_id', selectedTraining.id);

      if (error) {
        showAlert('Error', error.message);
      } else {
        fetchParticipants(selectedTraining.id);
      }
    } catch (err) {
      showAlert('System Error', err.message);
    }
  }

  const renderParticipantItem = ({ item, index }) => {
    const fullName = item.members
      ? `${item.members.Lastname}, ${item.members.Firstname}`
      : `ID: ${item.MemberIDNo}`;

    return (
      <View style={[styles.row, index % 2 === 1 && styles.rowAlternate]}>
        <View style={styles.flexCell}>
          <Text style={styles.mainText}>{fullName}</Text>
          <Text style={styles.subText}>ID: {item.MemberIDNo}</Text>
        </View>
        <View style={styles.typeBadgeContainer}>
          <View style={[styles.badge, item.type === 'service_team' ? styles.badgeService : styles.badgeParticipant]}>
            <Text style={[styles.badgeText, item.type === 'service_team' ? styles.textService : styles.textParticipant]}>
              {item.type === 'service_team' ? 'Service Team' : 'Participant'}
            </Text>
          </View>
          {item.type === 'service_team' && item.sub_type && (
            <Text style={styles.subTypeTableLabel}>{item.sub_type}</Text>
          )}
        </View>
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={() => handleDeleteParticipant(item)}
        >
          <Ionicons name="trash-outline" size={16} color="#ef4444" />
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header Panel */}
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Ionicons name="construct-outline" size={22} color="#0f172a" style={styles.titleIcon} />
          <Text style={styles.title}>CLP Training Maintenance</Text>
        </View>
        <Text style={styles.subtitle}>Configure active training venues, event intervals, and registries.</Text>
      </View>

      {/* Main Configurations Selector */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionLabel}>Select Active Training Batch:</Text>
          <TouchableOpacity
            style={styles.inlineAddBatchBtn}
            onPress={() => setTrainingModalVisible(true)}
          >
            <Ionicons name="add-outline" size={14} color="#334155" style={styles.inlineAddBatchBtnIcon} />
            <Text style={styles.inlineAddBatchBtnText}>Add New Batch</Text>
          </TouchableOpacity>
        </View>
        
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={Platform.OS === 'web'} 
          style={[styles.horizontalScroll, Platform.OS === 'web' && { overflowX: 'auto', WebkitOverflowScrolling: 'touch' }]}
        >
          {trainings.map((t) => {
            const isSelected = selectedTraining?.id === t.id;
            return (
              <TouchableOpacity
                key={t.id}
                style={[styles.batchChip, isSelected && styles.batchChipActive]}
                onPress={() => setSelectedTraining(t)}
              >
                <View style={styles.batchChipVenueRow}>
                  <Ionicons name="location-outline" size={12} color={isSelected ? '#2563eb' : '#334155'} style={styles.batchChipVenueIcon} />
                  <Text style={[styles.batchChipText, isSelected && styles.batchChipTextActive]} numberOfLines={1}>
                    {t.venue}
                  </Text>
                </View>
                <Text style={[styles.batchChipSubText, isSelected && styles.batchChipSubTextActive]}>
                  {t.start_date} to {t.end_date}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Selected Batch Metrics Grid */}
      {selectedTraining && (
        <View style={styles.metaRow}>
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Current Venue</Text>
            <Text style={styles.metaValue} numberOfLines={1}>{selectedTraining.venue}</Text>
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Active Participants</Text>
            <Text style={styles.metaValue}>{activeParticipantsCount}</Text>
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Service Team</Text>
            <Text style={styles.metaValue}>{serviceTeamCount}</Text>
          </View>
        </View>
      )}

      {/* Public Self-Registration Link */}
      {selectedTraining && (
        <View style={styles.linkCard}>
          <Ionicons name="link-outline" size={16} color="#002060" style={{ marginRight: 8 }} />
          <View style={styles.linkTextWrap}>
            <Text style={styles.linkLabel}>Public Registration Link</Text>
            <Text style={styles.linkUrl} numberOfLines={1}>{buildPublicRegistrationLink(selectedTraining)}</Text>
          </View>
          <TouchableOpacity style={styles.copyLinkBtn} onPress={handleCopyPublicLink}>
            <Ionicons name={linkCopied ? 'checkmark' : 'copy-outline'} size={14} color="#ffffff" style={{ marginRight: 4 }} />
            <Text style={styles.copyLinkBtnText}>{linkCopied ? 'Copied' : 'Copy'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Participant Matrix Log Registry Table */}
      <View style={styles.tableCard}>
        <View style={styles.tableHeader}>
          <Text style={styles.tableHeaderText}>Enrolled Roster Directory</Text>
          {selectedTraining && (
            <TouchableOpacity
              style={styles.addParticipantBtn}
              onPress={() => setParticipantModalVisible(true)}
            >
              <Ionicons name="add-outline" size={14} color="#ffffff" style={styles.addParticipantBtnIcon} />
              <Text style={styles.addParticipantBtnText}>Enlist Members</Text>
            </TouchableOpacity>
          )}
        </View>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#002060" />
          </View>
        ) : (
          <FlatList
            data={participants}
            renderItem={renderParticipantItem}
            keyExtractor={(item) => item.id.toString()}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>
                  {selectedTraining 
                    ? 'No members registered under this batch framework yet.' 
                    : 'Please select or construct a dynamic training batch above.'}
                </Text>
              </View>
            }
          />
        )}
      </View>

      {/* ================= MODAL: ADD TRAINING BATCH ================= */}
      <Modal visible={trainingModalVisible} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>New CLP Training Matrix Batch</Text>
            
            <Text style={styles.inputLabel}>Start Date</Text>
            {Platform.OS === 'web' ? (
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                style={webInputStyle}
              />
            ) : (
              <TextInput 
                style={styles.input} 
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#94a3b8"
                value={startDate} 
                onChangeText={setStartDate} 
              />
            )}

            <Text style={styles.inputLabel}>End Date</Text>
            {Platform.OS === 'web' ? (
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                style={webInputStyle}
              />
            ) : (
              <TextInput 
                style={styles.input} 
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#94a3b8"
                value={endDate} 
                onChangeText={setEndDate} 
              />
            )}

            <Text style={styles.inputLabel}>Venue Destination</Text>
            <TextInput 
              style={styles.input} 
              placeholder="e.g., Chapter Hall Room B"
              placeholderTextColor="#94a3b8"
              value={venue} 
              onChangeText={setVenue} 
            />

            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.btn, styles.btnCancel]} onPress={() => setTrainingModalVisible(false)}>
                <Text style={styles.btnTextCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.btnConfirm]} onPress={handleAddTraining}>
                <Text style={styles.btnTextConfirm}>Save Batch</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ================= MODAL: ENLIST PARTICIPANT ================= */}
      <Modal 
        visible={participantModalVisible} 
        animationType="slide" 
        transparent={true}
        onShow={handleFocusOnModalOpen} 
        onRequestClose={() => { setParticipantModalVisible(false); resetParticipantForm(); }}
      >
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={styles.modalScrollContainer} style={{ width: '100%' }} showsVerticalScrollIndicator={false}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Enlist Members to Batch Registry</Text>
              
              {stagedMembers.length > 0 && (
                <View style={{ marginBottom: 12 }}>
                  <Text style={styles.inputLabel}>Selected Queue ({stagedMembers.length})</Text>
                  <View style={styles.stagedContainer}>
                    {stagedMembers.map((member) => (
                      <View key={member.MemberIDNo} style={styles.stagedChip}>
                        <Text style={styles.stagedChipText}>
                          {member.Firstname} {member.Lastname}
                        </Text>
                        <TouchableOpacity
                          style={styles.stagedChipRemove}
                          onPress={() => removeStagedMember(member.MemberIDNo)}
                        >
                          <Ionicons name="close" size={13} color="#1e40af" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              <Text style={styles.inputLabel}>Search Member Name</Text>
              <TextInput 
                ref={memberSearchInputRef} 
                style={[styles.input, { marginBottom: 4 }]} 
                placeholder="Type name to find and append members..."
                placeholderTextColor="#94a3b8"
                value={searchQuery} 
                onChangeText={setSearchQuery}
              />
              
              {searchingMembers && (
                <ActivityIndicator size="small" color="#002060" style={{ marginVertical: 6 }} />
              )}

              {searchResults.length > 0 && (
                <View style={styles.dropdownContainer}>
                  {searchResults.map((member) => (
                    <TouchableOpacity
                      key={member.MemberIDNo}
                      style={styles.dropdownRowItem}
                      onPress={() => toggleStageMember(member)}
                    >
                      <Text style={styles.dropdownRowText}>
                        {member.Lastname}, {member.Firstname}
                      </Text>
                      <Text style={styles.dropdownRowSubText}>ID: {member.MemberIDNo}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              
              {searchQuery.trim().length >= 2 && searchResults.length === 0 && !searchingMembers && (
                <Text style={styles.noResultsInline}>No additional matching members found.</Text>
              )}

              <Text style={styles.inputLabel}>Registration Category</Text>
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
                  <View style={styles.subTypeSelectorGrid}>
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

              <View style={styles.modalActions}>
                <TouchableOpacity 
                  style={[styles.btn, styles.btnCancel]} 
                  onPress={() => { setParticipantModalVisible(false); resetParticipantForm(); }}
                >
                  <Text style={styles.btnTextCancel}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.btn, styles.btnConfirm, stagedMembers.length === 0 && styles.btnDisabled]} 
                  onPress={handleAddParticipant}
                  disabled={stagedMembers.length === 0}
                >
                  <Text style={styles.btnTextConfirm}>Enroll Members</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

    </View>
  );
}

const webInputStyle = {
  backgroundColor: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  padding: '10px 12px',
  fontSize: '13px',
  color: '#1e293b',
  marginBottom: '14px',
  fontFamily: 'sans-serif',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box'
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 10 : 0 },
  header: { paddingVertical: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  titleIcon: { marginRight: 8 },
  title: { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  subtitle: { fontSize: 13, color: '#64748b', marginTop: 4 },
  sectionCard: { backgroundColor: '#ffffff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 12 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#475569', textTransform: 'uppercase' },
  inlineAddBatchBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f1f5f9', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#cbd5e1' },
  inlineAddBatchBtnIcon: { marginRight: 4 },
  inlineAddBatchBtnText: { fontSize: 11, fontWeight: '700', color: '#334155' },
  horizontalScroll: { flexDirection: 'row' },
  batchChip: { backgroundColor: '#f1f5f9', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, marginRight: 8, borderWidth: 1, borderColor: '#e2e8f0', minWidth: 140, maxWidth: 180 },
  batchChipActive: { backgroundColor: '#eff6ff', borderColor: '#2563eb' },
  batchChipVenueRow: { flexDirection: 'row', alignItems: 'center' },
  batchChipVenueIcon: { marginRight: 4 },
  batchChipText: { flex: 1, fontSize: 13, fontWeight: '600', color: '#334155' },
  batchChipTextActive: { color: '#2563eb' },
  batchChipSubText: { fontSize: 10, color: '#64748b', marginTop: 2 },
  batchChipSubTextActive: { color: '#3b82f6' },
  metaRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  metaBlock: { flex: 1, backgroundColor: '#ffffff', borderRadius: 12, padding: 10, borderWidth: 1, borderColor: '#e2e8f0' },
  metaLabel: { fontSize: 10, fontWeight: '700', color: '#64748b', textTransform: 'uppercase' },
  metaValue: { fontSize: 14, fontWeight: '700', color: '#002060', marginTop: 2 },
  linkCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ffffff', borderRadius: 12, padding: 10, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 12 },
  linkTextWrap: { flex: 1, marginRight: 8 },
  linkLabel: { fontSize: 10, fontWeight: '700', color: '#64748b', textTransform: 'uppercase' },
  linkUrl: { fontSize: 12, color: '#002060', marginTop: 2, fontWeight: '600' },
  copyLinkBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#002060', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 6 },
  copyLinkBtnText: { color: '#ffffff', fontSize: 11, fontWeight: '700' },
  tableCard: { flex: 1, backgroundColor: '#ffffff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', overflow: 'hidden', marginBottom: 16 },
  tableHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8fafc', paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderColor: '#e2e8f0' },
  tableHeaderText: { fontSize: 12, fontWeight: '700', color: '#475569', textTransform: 'uppercase' },
  addParticipantBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#002060', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  addParticipantBtnIcon: { marginRight: 4 },
  addParticipantBtnText: { color: '#ffffff', fontSize: 11, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  rowAlternate: { backgroundColor: '#f8fafc' },
  flexCell: { flex: 1 },
  mainText: { fontSize: 13, fontWeight: '600', color: '#1e293b' },
  subText: { fontSize: 11, color: '#64748b', marginTop: 1 },
  typeBadgeContainer: { width: 140, alignItems: 'center', justifyContent: 'center' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeService: { backgroundColor: '#e0f2fe' },
  badgeParticipant: { backgroundColor: '#fef3c7' },
  badgeText: { fontSize: 10, fontWeight: '700' },
  textService: { color: '#0369a1' },
  textParticipant: { color: '#b45309' },
  subTypeTableLabel: { fontSize: 10, fontWeight: '500', color: '#64748b', marginTop: 3, textAlign: 'center' },
  deleteButton: { padding: 6 },
  centered: { padding: 40, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: { padding: 40, alignItems: 'center' },
  emptyText: { color: '#94a3b8', fontSize: 12, fontWeight: '500', textAlign: 'center', lineHeight: 18 },
  modalOverlay: { 
    flex: 1, 
    backgroundColor: 'rgba(15, 23, 42, 0.4)', 
    justifyContent: 'center', 
    alignItems: 'center', 
    padding: 20 
  },
  modalScrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 20,
  },
  modalContent: { 
    backgroundColor: '#ffffff', 
    borderRadius: 14, 
    padding: 20, 
    width: '100%',         
    maxWidth: 480,         
    shadowColor: '#000', 
    shadowOffset: { width: 0, height: 4 }, 
    shadowOpacity: 0.1, 
    shadowRadius: 10, 
    elevation: 5 
  },
  modalTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a', marginBottom: 16 },
  inputLabel: { fontSize: 11, fontWeight: '700', color: '#475569', textTransform: 'uppercase', marginBottom: 6 },
  input: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: '#1e293b', marginBottom: 14 },
  
  dropdownContainer: { backgroundColor: '#ffffff', borderRadius: 8, borderWidth: 1, borderColor: '#cbd5e1', marginBottom: 14, overflow: 'hidden' },
  dropdownRowItem: { padding: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9', backgroundColor: '#ffffff' },
  dropdownRowText: { fontSize: 13, fontWeight: '600', color: '#1e293b' },
  dropdownRowSubText: { fontSize: 11, color: '#64748b', marginTop: 1 },
  noResultsInline: { fontSize: 12, color: '#64748b', marginBottom: 14, paddingLeft: 4 },
  
  stagedContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, backgroundColor: '#f8fafc', padding: 8, borderRadius: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  stagedChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6 },
  stagedChipText: { fontSize: 12, fontWeight: '600', color: '#1e40af' },
  stagedChipRemove: { marginLeft: 6, paddingHorizontal: 2 },

  subTypeSelectorGrid: { 
    flexDirection: 'row', 
    flexWrap: 'wrap', 
    gap: 6, 
    paddingVertical: 4 
  },
  subTypeChip: { 
    backgroundColor: '#f1f5f9', 
    paddingHorizontal: 10, 
    paddingVertical: 6, 
    borderRadius: 6, 
    borderWidth: 1, 
    borderColor: '#e2e8f0'
  },
  subTypeChipActive: { backgroundColor: '#e0f2fe', borderColor: '#0284c7' },
  subTypeChipText: { fontSize: 11, color: '#475569', fontWeight: '500' },
  subTypeChipTextActive: { color: '#0369a1', fontWeight: '700' },

  btnDisabled: { backgroundColor: '#cbd5e1', opacity: 0.6 },
  toggleRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  toggleBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: '#f1f5f9', alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0' },
  toggleBtnActive: { backgroundColor: '#002060', borderColor: '#002060' },
  toggleBtnText: { fontSize: 12, fontWeight: '600', color: '#475569' },
  toggleBtnTextActive: { color: '#ffffff', fontWeight: '700' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 12 },
  btn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, minWidth: 80, alignItems: 'center' },
  btnCancel: { backgroundColor: '#f1f5f9' },
  btnConfirm: { backgroundColor: '#2563eb' },
  btnTextCancel: { color: '#475569', fontSize: 13, fontWeight: '600' },
  btnTextConfirm: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
});