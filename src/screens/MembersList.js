import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { supabase } from '../../lib/supabase';

export default function MembersList() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [updatingId, setUpdatingId] = useState(null); // Tracks network load per row toggle

  useEffect(() => {
    fetchMembers();
  }, []);

  async function fetchMembers() {
    try {
      const { data, error } = await supabase
        .from('members')
        .select('*')
        .order('Lastname', { ascending: true });

      if (error) throw error;
      setMembers(data || []);
    } catch (error) {
      console.error(error.message);
    } finally {
      setLoading(false);
    }
  }

  // Handle Dynamic Gender Toggle updates to Supabase
  async function toggleGender(memberId, currentGender, targetGender) {
    if (currentGender === targetGender) return; // Prevent unnecessary execution calls
    
    try {
      setUpdatingId(memberId);
      const { error } = await supabase
        .from('members')
        .update({ Gender: targetGender })
        .eq('MemberIDNo', memberId);

      if (error) throw error;

      // Update Local State Matrix Layout
      setMembers((prevMembers) =>
        prevMembers.map((m) => (m.MemberIDNo === memberId ? { ...m, Gender: targetGender } : m))
      );
    } catch (error) {
      const msg = `Failed updating gender status profile: ${error.message}`;
      Platform.OS === 'web' ? window.alert(msg) : Alert.alert('Database Exception', msg);
    } finally {
      setUpdatingId(null);
    }
  }

  // Real-time search filter
  const filteredMembers = useMemo(() => {
    const cleanQuery = searchQuery.trim().toLowerCase();
    if (!cleanQuery) return members;

    return members.filter((member) => {
      const first = member.Firstname?.toLowerCase() || '';
      const last = member.Lastname?.toLowerCase() || '';
      const idStr = member.MemberIDNo?.toString().toLowerCase() || '';
      return first.includes(cleanQuery) || last.includes(cleanQuery) || idStr.includes(cleanQuery);
    });
  }, [searchQuery, members]);

  if (loading) return <ActivityIndicator size="large" color="#002060" style={styles.centered} />;

  return (
    <View style={styles.container}>
      <View style={styles.heroSection}>
        <View style={styles.titleRow}>
          <Ionicons name="people-outline" size={22} color="#0f172a" style={styles.titleIcon} />
          <Text style={styles.title}>CFC Members Directory</Text>
        </View>
        <Text style={styles.subtitle}>Manage and browse active community profiles, assigned chapters, and household groups.</Text>
      </View>

      {/* Added Search Bar */}
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={16} color="#94a3b8" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search name or ID..."
          placeholderTextColor="#94a3b8"
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      </View>

      <FlatList
        data={filteredMembers}
        keyExtractor={(item) => item.MemberIDNo?.toString()}
        contentContainerStyle={styles.listPadding}
        renderItem={({ item }) => {
          const currentGender = item.Gender; // Expects 'Male' or 'Female'
          const isRowUpdating = updatingId === item.MemberIDNo;

          return (
            <View style={styles.card}>
              <View style={styles.infoSide}>
                <Text style={styles.name}>{item.Lastname}, {item.Firstname}</Text>
                <Text style={styles.meta}>ID: <Text style={styles.boldText}>{item.MemberIDNo}</Text></Text>
                <Text style={styles.subText}>Household Head: {item.NameOfHouseholdHead || 'N/A'}</Text>

                {/* Inline Gender Selector Toggles */}
                <View style={styles.genderToggleWrapper}>
                  <Text style={styles.genderLabel}>Gender: </Text>
                  
                  <TouchableOpacity
                    style={[styles.genderChip, currentGender === 'Male' && styles.maleChipActive]}
                    disabled={isRowUpdating}
                    onPress={() => toggleGender(item.MemberIDNo, currentGender, 'Male')}
                  >
                    <Text style={[styles.genderChipText, currentGender === 'Male' && styles.maleTextActive]}>Male</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.genderChip, currentGender === 'Female' && styles.femaleChipActive]}
                    disabled={isRowUpdating}
                    onPress={() => toggleGender(item.MemberIDNo, currentGender, 'Female')}
                  >
                    <Text style={[styles.genderChipText, currentGender === 'Female' && styles.femaleTextActive]}>Female</Text>
                  </TouchableOpacity>

                  {isRowUpdating && <ActivityIndicator size="small" color="#002060" style={{ marginLeft: 6 }} />}
                </View>
              </View>

              <View style={styles.badgeSide}>
                <View style={styles.roleBadge}><Text style={styles.roleBadgeText}>{item.pastoral_service || 'MEMBER'}</Text></View>
                <View style={styles.areaBadge}><Text style={styles.areaBadgeText}>{item.AreaName || 'No Area'}</Text></View>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {searchQuery ? "No members matched your search entry." : "No members found."}
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', paddingHorizontal: 16 },
  heroSection: { paddingVertical: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  titleIcon: { marginRight: 8 },
  title: { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  subtitle: { fontSize: 14, color: '#64748b', marginTop: 4, lineHeight: 20 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  searchContainer: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#ffffff', borderRadius: 10, paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 10 : 5, borderWidth: 1, borderColor: '#e2e8f0',
    marginBottom: 14, maxWidth: 360, shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 2, elevation: 1,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: '#1e293b', fontWeight: '500' },
  
  listPadding: { paddingBottom: 24 },
  card: { flexDirection: Platform.OS === 'web' ? 'row' : 'column', justifyContent: 'space-between', backgroundColor: '#ffffff', padding: 16, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: '#e2e8f0', ...Platform.select({
      web: { boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)' },
      default: { elevation: 1 }
    })
  },
  infoSide: { flex: 2 },
  badgeSide: { flexDirection: 'row', alignItems: 'center', marginTop: Platform.OS === 'web' ? 0 : 12, gap: 8, alignSelf: Platform.OS === 'web' ? 'center' : 'flex-start' },
  name: { fontSize: 16, fontWeight: '700', color: '#1e293b' },
  meta: { fontSize: 12, color: '#64748b', marginTop: 4 },
  subText: { fontSize: 13, color: '#475569', marginTop: 4 },
  boldText: { fontWeight: '600', color: '#0f172a' },
  roleBadge: { backgroundColor: '#eff6ff', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  roleBadgeText: { fontSize: 11, fontWeight: '700', color: '#002060' },
  areaBadge: { backgroundColor: '#f1f5f9', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  areaBadgeText: { fontSize: 11, fontWeight: '700', color: '#475569' },
  empty: { textAlign: 'center', color: '#94a3b8', marginTop: 40 },

  // Gender Inline Element Toggles
  genderToggleWrapper: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  genderLabel: { fontSize: 12, color: '#64748b', marginRight: 6, fontWeight: '500' },
  genderChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1, borderColor: '#cbd5e1', marginRight: 6, backgroundColor: '#f8fafc' },
  genderChipText: { fontSize: 11, fontWeight: '600', color: '#64748b' },
  
  maleChipActive: { backgroundColor: '#e0f2fe', borderColor: '#0284c7' },
  maleTextActive: { color: '#0369a1', fontWeight: '700' },
  
  femaleChipActive: { backgroundColor: '#fce7f3', borderColor: '#db2777' },
  femaleTextActive: { color: '#be185d', fontWeight: '700' }
});