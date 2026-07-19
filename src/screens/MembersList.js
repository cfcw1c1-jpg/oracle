import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { supabase } from '../../lib/supabase';

export default function MembersList() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

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
        <Text style={styles.title}>👥 CFC Members Directory</Text>
        <Text style={styles.subtitle}>Manage and browse active community profiles, assigned chapters, and household groups.</Text>
      </View>

      {/* Added Search Bar */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="🔍 Search name or ID..."
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
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.infoSide}>
              <Text style={styles.name}>{item.Lastname}, {item.Firstname}</Text>
              <Text style={styles.meta}>ID: <Text style={styles.boldText}>{item.MemberIDNo}</Text></Text>
              <Text style={styles.subText}>Household Head: {item.NameOfHouseholdHead || 'N/A'}</Text>
            </View>
            <View style={styles.badgeSide}>
              <View style={styles.roleBadge}><Text style={styles.roleBadgeText}>{item.pastoral_service || 'MEMBER'}</Text></View>
              <View style={styles.areaBadge}><Text style={styles.areaBadgeText}>{item.AreaName || 'No Area'}</Text></View>
            </View>
          </View>
        )}
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
  title: { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  subtitle: { fontSize: 14, color: '#64748b', marginTop: 4, lineHeight: 20 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  
  // Added Search Styles
  searchContainer: {
    backgroundColor: '#ffffff', borderRadius: 10, paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 10 : 5, borderWidth: 1, borderColor: '#e2e8f0',
    marginBottom: 14, maxWidth: 360, shadowColor: '#0f172a', 
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 2, elevation: 1,
  },
  searchInput: { fontSize: 14, color: '#1e293b', fontWeight: '500' },
  
  listPadding: { paddingBottom: 24 },
  card: { flexDirection: Platform.OS === 'web' ? 'row' : 'column', justifyContent: 'space-between', backgroundColor: '#ffffff', padding: 16, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: '#e2e8f0', ...Platform.select({
      web: { boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)' },
      default: { elevation: 1 }
    })
  },
  infoSide: { flex: 2 },
  badgeSide: { flexDirection: 'row', alignItems: 'center', marginTop: Platform.OS === 'web' ? 0 : 12, gap: 8 },
  name: { fontSize: 16, fontWeight: '700', color: '#1e293b' },
  meta: { fontSize: 12, color: '#64748b', marginTop: 4 },
  subText: { fontSize: 13, color: '#475569', marginTop: 4 },
  boldText: { fontWeight: '600', color: '#0f172a' },
  roleBadge: { backgroundColor: '#eff6ff', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  roleBadgeText: { fontSize: 11, fontWeight: '700', color: '#002060' },
  areaBadge: { backgroundColor: '#f1f5f9', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  areaBadgeText: { fontSize: 11, fontWeight: '700', color: '#475569' },
  empty: { textAlign: 'center', color: '#94a3b8', marginTop: 40 }
});