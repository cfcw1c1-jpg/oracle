import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { supabase } from '../../lib/supabase';

// Checkbox/Gender stay a fixed width (their content is compact and
// fixed-size); Name/Household/Role grow to fill the row on wide screens but
// won't shrink below their minWidth, so the table scrolls horizontally instead
// of squeezing text on narrow ones.
const CHECKBOX_COL = { width: 44 };
const NAME_COL = { flexGrow: 2.2, flexShrink: 1, flexBasis: 0, minWidth: 200 };
const HOUSEHOLD_COL = { flexGrow: 1.6, flexShrink: 1, flexBasis: 0, minWidth: 160 };
const GENDER_COL = { width: 120 };
const ROLE_COL = { flexGrow: 1.8, flexShrink: 1, flexBasis: 0, minWidth: 180 };
const TABLE_MIN_WIDTH = 44 + 200 + 160 + 120 + 180;

function getInitials(firstName, lastName) {
  const first = (firstName || '').trim().charAt(0);
  const last = (lastName || '').trim().charAt(0);
  return (first + last).toUpperCase() || '?';
}

// One tap flips Male<->Female directly; an unset gender defaults to Male on
// first tap so there's always a next value to switch to.
function getNextGender(currentGender) {
  if (currentGender === 'Male') return 'Female';
  if (currentGender === 'Female') return 'Male';
  return 'Male';
}

// PastoralService is stored as a short code; spell it out for display.
const ROLE_LABELS = {
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

function getRoleLabel(code) {
  if (!code || code === 'All') return code || 'Member';
  return ROLE_LABELS[code.trim().toUpperCase()] || code;
}

// A small "value: X ▾" pressable that opens a single-select list of options.
// Used three times below (Gender / Role / Area) so it's factored out once.
function FilterDropdown({ label, value, options, onChange, getLabel = (v) => v }) {
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.filterDropdownWrapper}>
      <TouchableOpacity style={styles.filterDropdownButton} onPress={() => setOpen((o) => !o)}>
        <Text style={styles.filterDropdownLabel} numberOfLines={1}>
          {label}: <Text style={styles.filterDropdownValue}>{getLabel(value)}</Text>
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={12} color="#64748b" />
      </TouchableOpacity>

      {open && (
        <View style={styles.filterDropdownMenu}>
          <ScrollView style={styles.filterDropdownScroll} nestedScrollEnabled>
            {options.map((option) => (
              <TouchableOpacity
                key={option}
                style={[styles.filterDropdownItem, option === value && styles.filterDropdownItemActive]}
                onPress={() => { onChange(option); setOpen(false); }}
              >
                <Text style={[styles.filterDropdownItemText, option === value && styles.filterDropdownItemTextActive]}>
                  {getLabel(option)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

export default function MembersList() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [updatingId, setUpdatingId] = useState(null); // Tracks network load per row toggle

  const [genderFilter, setGenderFilter] = useState('All');
  const [roleFilter, setRoleFilter] = useState('All');
  const [areaFilter, setAreaFilter] = useState('All');
  const [sortAsc, setSortAsc] = useState(true);

  const [selectedIds, setSelectedIds] = useState(new Set());

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

  const roleOptions = useMemo(() => {
    const values = new Set(members.map((m) => (m.PastoralService || 'MEMBER').trim()));
    return ['All', ...Array.from(values).sort()];
  }, [members]);

  const areaOptions = useMemo(() => {
    const values = new Set(members.map((m) => (m.AreaName || 'No Area').trim()));
    return ['All', ...Array.from(values).sort()];
  }, [members]);

  // Real-time search + filter
  const filteredMembers = useMemo(() => {
    const cleanQuery = searchQuery.trim().toLowerCase();

    const result = members.filter((member) => {
      const first = member.Firstname?.toLowerCase() || '';
      const last = member.Lastname?.toLowerCase() || '';
      const idStr = member.MemberIDNo?.toString().toLowerCase() || '';
      const matchesSearch = !cleanQuery || first.includes(cleanQuery) || last.includes(cleanQuery) || idStr.includes(cleanQuery);
      const matchesGender = genderFilter === 'All' || member.Gender === genderFilter;
      const matchesRole = roleFilter === 'All' || (member.PastoralService || 'MEMBER').trim() === roleFilter;
      const matchesArea = areaFilter === 'All' || (member.AreaName || 'No Area').trim() === areaFilter;
      return matchesSearch && matchesGender && matchesRole && matchesArea;
    });

    return result.sort((a, b) => {
      const cmp = (a.Lastname || '').localeCompare(b.Lastname || '');
      return sortAsc ? cmp : -cmp;
    });
  }, [searchQuery, members, genderFilter, roleFilter, areaFilter, sortAsc]);

  const allFilteredSelected = filteredMembers.length > 0 && filteredMembers.every((m) => selectedIds.has(m.MemberIDNo));

  function toggleSelectRow(memberId) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const allSelected = filteredMembers.length > 0 && filteredMembers.every((m) => prev.has(m.MemberIDNo));
      if (allSelected) return new Set();
      return new Set(filteredMembers.map((m) => m.MemberIDNo));
    });
  }

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

      <View style={styles.controlsRow}>
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

        <View style={styles.filterGroup}>
          <Ionicons name="filter-outline" size={14} color="#64748b" style={{ marginRight: 2 }} />
          <FilterDropdown label="Gender" value={genderFilter} options={['All', 'Male', 'Female']} onChange={setGenderFilter} />
          <FilterDropdown label="Role" value={roleFilter} options={roleOptions} onChange={setRoleFilter} getLabel={getRoleLabel} />
          <FilterDropdown label="Area" value={areaFilter} options={areaOptions} onChange={setAreaFilter} />
        </View>

        {selectedIds.size > 0 && (
          <View style={styles.selectedPill}>
            <Text style={styles.selectedPillText}>{selectedIds.size} selected</Text>
            <TouchableOpacity onPress={() => setSelectedIds(new Set())}>
              <Ionicons name="close-circle-outline" size={16} color="#475569" />
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View style={styles.tableCard}>
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ flexGrow: 1 }}>
          <View style={{ minWidth: TABLE_MIN_WIDTH, flex: 1 }}>
            {/* Table Header */}
            <View style={styles.tableHeaderRow}>
              <View style={[styles.headerCell, CHECKBOX_COL]}>
                <Pressable style={[styles.checkbox, allFilteredSelected && styles.checkboxChecked]} onPress={toggleSelectAll}>
                  {allFilteredSelected && <Ionicons name="checkmark" size={12} color="#ffffff" />}
                </Pressable>
              </View>
              <TouchableOpacity style={[styles.headerCell, NAME_COL]} onPress={() => setSortAsc((v) => !v)}>
                <Text style={styles.headerText}>NAME</Text>
                <Ionicons name={sortAsc ? 'chevron-up-outline' : 'chevron-down-outline'} size={12} color="#94a3b8" style={{ marginLeft: 4 }} />
              </TouchableOpacity>
              <View style={[styles.headerCell, HOUSEHOLD_COL]}>
                <Text style={styles.headerText}>HOUSEHOLD HEAD</Text>
              </View>
              <View style={[styles.headerCell, GENDER_COL]}>
                <Text style={styles.headerText}>GENDER</Text>
              </View>
              <View style={[styles.headerCell, ROLE_COL, { justifyContent: 'center' }]}>
                <Text style={styles.headerText}>ROLE & AREA</Text>
              </View>
            </View>

            <FlatList
              data={filteredMembers}
              keyExtractor={(item) => item.MemberIDNo?.toString()}
              renderItem={({ item }) => {
                const currentGender = item.Gender;
                const isRowUpdating = updatingId === item.MemberIDNo;
                const isSelected = selectedIds.has(item.MemberIDNo);

                return (
                  <View style={styles.tableRow}>
                    <View style={[styles.cell, CHECKBOX_COL]}>
                      <Pressable
                        style={[styles.checkbox, isSelected && styles.checkboxChecked]}
                        onPress={() => toggleSelectRow(item.MemberIDNo)}
                      >
                        {isSelected && <Ionicons name="checkmark" size={12} color="#ffffff" />}
                      </Pressable>
                    </View>

                    <View style={[styles.cell, styles.nameCell, NAME_COL]}>
                      <View style={styles.avatar}>
                        <Text style={styles.avatarText}>{getInitials(item.Firstname, item.Lastname)}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.nameText} numberOfLines={1}>{item.Lastname}, {item.Firstname}</Text>
                        <Text style={styles.idText}>ID: {item.MemberIDNo}</Text>
                      </View>
                    </View>

                    <View style={[styles.cell, HOUSEHOLD_COL]}>
                      <Text style={styles.householdText} numberOfLines={2}>{item.NameOfHouseholdHead || 'N/A'}</Text>
                    </View>

                    <View style={[styles.cell, GENDER_COL]}>
                      {isRowUpdating ? (
                        <ActivityIndicator size="small" color="#002060" />
                      ) : (
                        <TouchableOpacity
                          style={[styles.genderBadge, currentGender === 'Male' ? styles.maleBadge : currentGender === 'Female' ? styles.femaleBadge : styles.unknownBadge]}
                          onPress={() => toggleGender(item.MemberIDNo, currentGender, getNextGender(currentGender))}
                        >
                          <Text style={[styles.genderBadgeText, currentGender === 'Male' ? styles.maleBadgeText : currentGender === 'Female' ? styles.femaleBadgeText : styles.unknownBadgeText]}>
                            {currentGender || 'N/A'}
                          </Text>
                          <Ionicons
                            name="swap-horizontal"
                            size={12}
                            color={currentGender === 'Male' ? '#0369a1' : currentGender === 'Female' ? '#be185d' : '#64748b'}
                            style={styles.genderBadgeIcon}
                          />
                        </TouchableOpacity>
                      )}
                    </View>

                    <View style={[styles.cell, ROLE_COL, { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }]}>
                      <View style={styles.roleBadge}><Text style={styles.roleBadgeText}>{getRoleLabel(item.PastoralService)}</Text></View>
                      <View style={styles.areaBadge}><Text style={styles.areaBadgeText}>{item.AreaName || 'No Area'}</Text></View>
                    </View>
                  </View>
                );
              }}
              ListEmptyComponent={
                <Text style={styles.empty}>
                  {searchQuery || genderFilter !== 'All' || roleFilter !== 'All' || areaFilter !== 'All'
                    ? 'No members matched your search and filters.'
                    : 'No members found.'}
                </Text>
              }
            />
          </View>
        </ScrollView>
      </View>
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

  controlsRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 14, zIndex: 15 },
  searchContainer: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#ffffff', borderRadius: 10, paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 10 : 5, borderWidth: 1, borderColor: '#e2e8f0',
    maxWidth: 300, flexGrow: 1, shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 2, elevation: 1,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: '#1e293b', fontWeight: '500' },

  filterGroup: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  filterDropdownWrapper: { position: 'relative' },
  filterDropdownButton: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#ffffff',
    borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, gap: 4,
  },
  filterDropdownLabel: { fontSize: 12, fontWeight: '600', color: '#64748b' },
  filterDropdownValue: { color: '#0f172a', fontWeight: '700' },
  filterDropdownMenu: {
    position: 'absolute', top: 42, left: 0, minWidth: 150, maxHeight: 220,
    backgroundColor: '#ffffff', borderRadius: 8, borderWidth: 1, borderColor: '#cbd5e1',
    shadowColor: '#0f172a', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 8,
    elevation: 6, zIndex: 30,
  },
  filterDropdownScroll: { maxHeight: 220 },
  filterDropdownItem: { paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  filterDropdownItemActive: { backgroundColor: '#eff6ff' },
  filterDropdownItemText: { fontSize: 12, color: '#334155', fontWeight: '500' },
  filterDropdownItemTextActive: { color: '#002060', fontWeight: '700' },

  selectedPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#f1f5f9', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6,
  },
  selectedPillText: { fontSize: 12, fontWeight: '600', color: '#475569' },

  tableCard: { flex: 1, backgroundColor: '#ffffff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 16 },
  tableHeaderRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#e2e8f0', backgroundColor: '#f8fafc' },
  headerCell: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 },
  headerText: { fontSize: 11, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.3 },

  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  cell: { paddingHorizontal: 10, justifyContent: 'center' },
  nameCell: { flexDirection: 'row', alignItems: 'center' },

  checkbox: {
    width: 18, height: 18, borderRadius: 4, borderWidth: 2, borderColor: '#cbd5e1',
    backgroundColor: '#ffffff', justifyContent: 'center', alignItems: 'center',
  },
  checkboxChecked: { backgroundColor: '#002060', borderColor: '#002060' },

  avatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#eff6ff',
    justifyContent: 'center', alignItems: 'center', marginRight: 10,
  },
  avatarText: { fontSize: 12, fontWeight: '800', color: '#002060' },
  nameText: { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  idText: { fontSize: 11, color: '#94a3b8', marginTop: 2 },

  householdText: { fontSize: 13, color: '#475569' },

  genderBadge: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 20, borderWidth: 1, alignSelf: 'flex-start',
  },
  genderBadgeIcon: { marginLeft: 5 },
  genderBadgeText: { fontSize: 11, fontWeight: '700' },
  maleBadge: { backgroundColor: '#e0f2fe', borderColor: '#0284c7' },
  maleBadgeText: { color: '#0369a1' },
  femaleBadge: { backgroundColor: '#fce7f3', borderColor: '#db2777' },
  femaleBadgeText: { color: '#be185d' },
  unknownBadge: { backgroundColor: '#f1f5f9', borderColor: '#cbd5e1' },
  unknownBadgeText: { color: '#64748b' },

  roleBadge: { backgroundColor: '#eff6ff', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  roleBadgeText: { fontSize: 11, fontWeight: '700', color: '#002060' },
  areaBadge: { backgroundColor: '#f1f5f9', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  areaBadgeText: { fontSize: 11, fontWeight: '700', color: '#475569' },

  empty: { textAlign: 'center', color: '#94a3b8', marginTop: 40, marginBottom: 20 },
});
