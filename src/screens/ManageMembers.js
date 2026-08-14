import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { ExportButton, exportCsv, TableCard, TablePagination, usePagination } from '../components/admin-table';

const NAVY = '#002060';
const ACCENT_BLUE = '#2563eb';
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200];
const NARROW_BREAKPOINT = 720;

const GENDER_OPTIONS = ['Male', 'Female'];
const STATUS_OPTIONS = ['Active', 'Inactive', 'Deceased', 'SOLD', 'HANDMAID'];

const STATUS_COLORS = {
  Active: { bg: '#dcfce7', border: '#16a34a', text: '#15803d' },
  Inactive: { bg: '#f1f5f9', border: '#94a3b8', text: '#64748b' },
  Deceased: { bg: '#f3f4f6', border: '#6b7280', text: '#374151' },
  SOLD: { bg: '#fef3c7', border: '#d97706', text: '#b45309' },
  HANDMAID: { bg: '#ede9fe', border: '#7c3aed', text: '#6d28d9' },
};
const UNKNOWN_STATUS_COLORS = { bg: '#f1f5f9', border: '#cbd5e1', text: '#64748b' };
function getStatusColors(status) {
  return STATUS_COLORS[status] || UNKNOWN_STATUS_COLORS;
}

// Same short codes MembersList.js offers when changing a member's role --
// shown as autocomplete suggestions here too, but the field itself stays
// free text so a value outside this list can still be typed and saved.
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

function emptyForm() {
  return {
    MemberIDNo: '',
    Lastname: '',
    Firstname: '',
    Gender: '',
    Status: 'Active',
    AreaName: '',
    NameOfHouseholdHead: '',
    PastoralService: '',
  };
}

function formFromMember(m) {
  return {
    MemberIDNo: m.MemberIDNo || '',
    Lastname: m.Lastname || '',
    Firstname: m.Firstname || '',
    Gender: m.Gender || '',
    Status: m.Status || 'Active',
    AreaName: m.AreaName || '',
    NameOfHouseholdHead: m.NameOfHouseholdHead || '',
    PastoralService: m.PastoralService || '',
  };
}

function getInitials(firstName, lastName) {
  const first = (firstName || '').trim().charAt(0);
  const last = (lastName || '').trim().charAt(0);
  return (first + last).toUpperCase() || '?';
}

// A plain text input that also offers a dropdown of existing values matching
// what's typed so far -- picking one just fills the field, it never
// restricts what can actually be saved.
function AutocompleteField({ label, value, onChangeText, suggestions, placeholder, getLabel }) {
  const [focused, setFocused] = useState(false);

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    const pool = q
      ? suggestions.filter((s) => s.toLowerCase().includes(q) && s.toLowerCase() !== q)
      : suggestions;
    return pool.slice(0, 8);
  }, [value, suggestions]);

  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#94a3b8"
        autoCorrect={false}
        onFocus={() => setFocused(true)}
        // A short delay lets the suggestion's own onPress land first --
        // otherwise blur closes the list before the tap registers.
        onBlur={() => setTimeout(() => setFocused(false), 150)}
      />
      {focused && matches.length > 0 && (
        <View style={styles.suggestionBox}>
          <ScrollView style={{ maxHeight: 180 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            {matches.map((s) => (
              <TouchableOpacity
                key={s}
                style={styles.suggestionItem}
                onPress={() => { onChangeText(s); setFocused(false); }}
              >
                <Text style={styles.suggestionText}>{getLabel ? getLabel(s) : s}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

function SelectField({ label, value, options, onChange, getLabel = (v) => v, placeholder = 'Select…' }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TouchableOpacity style={styles.selectButton} onPress={() => setOpen((o) => !o)}>
        <Text style={value ? styles.selectValueText : styles.selectPlaceholderText}>
          {value ? getLabel(value) : placeholder}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color="#64748b" />
      </TouchableOpacity>
      {open && (
        <View style={styles.suggestionBox}>
          {options.map((option) => (
            <TouchableOpacity
              key={option}
              style={[styles.suggestionItem, option === value && styles.suggestionItemActive]}
              onPress={() => { onChange(option); setOpen(false); }}
            >
              <Text style={[styles.suggestionText, option === value && styles.suggestionTextActive]}>
                {getLabel(option)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

export default function ManageMembers() {
  const { width } = useWindowDimensions();
  const isNarrow = width < NARROW_BREAKPOINT;

  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [pageSize, setPageSize] = useState(20);

  const [modalVisible, setModalVisible] = useState(false);
  const [modalMode, setModalMode] = useState('create'); // 'create' | 'edit'
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

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
    } catch (err) {
      console.error('Error loading members:', err.message);
    } finally {
      setLoading(false);
    }
  }

  const { areaNames, pastoralServices, householdHeads } = useMemo(() => {
    const areas = new Set();
    const services = new Set();
    const heads = new Set();
    members.forEach((m) => {
      if (m.AreaName?.trim()) areas.add(m.AreaName.trim());
      if (m.PastoralService?.trim()) services.add(m.PastoralService.trim());
      if (m.NameOfHouseholdHead?.trim()) heads.add(m.NameOfHouseholdHead.trim());
    });
    Object.keys(ROLE_LABELS).forEach((code) => services.add(code));
    return {
      areaNames: Array.from(areas).sort(),
      pastoralServices: Array.from(services).sort(),
      householdHeads: Array.from(heads).sort(),
    };
  }, [members]);

  const filteredMembers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => {
      const first = (m.Firstname || '').toLowerCase();
      const last = (m.Lastname || '').toLowerCase();
      const id = (m.MemberIDNo || '').toString().toLowerCase();
      const area = (m.AreaName || '').toLowerCase();
      // Matches the raw code (e.g. "CL") and its spelled-out label (e.g.
      // "Chapter Leader") -- getServiceLabel returns "CODE — Label", so
      // one .includes() check covers both.
      const pastoralService = getServiceLabel(m.PastoralService || 'MEMBER').toLowerCase();
      return first.includes(q) || last.includes(q) || id.includes(q) || area.includes(q) || pastoralService.includes(q);
    });
  }, [members, searchQuery]);

  const { page, pageCount, pageItems, setPage } = usePagination(filteredMembers, pageSize);

  function handleChangePageSize(size) {
    setPageSize(size);
    setPage(1);
  }

  function getServiceLabel(code) {
    const label = ROLE_LABELS[code.trim().toUpperCase()];
    return label ? `${code} — ${label}` : code;
  }

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openCreateModal() {
    setForm(emptyForm());
    setModalMode('create');
    setModalVisible(true);
  }

  function openEditModal(member) {
    setForm(formFromMember(member));
    setModalMode('edit');
    setModalVisible(true);
  }

  function closeModal() {
    if (saving) return;
    setModalVisible(false);
  }

  const canSave = form.MemberIDNo.trim() && form.Lastname.trim() && form.Firstname.trim() && !saving;

  async function handleSave() {
    const memberId = form.MemberIDNo.trim();
    const lastname = form.Lastname.trim();
    const firstname = form.Firstname.trim();
    if (!memberId || !lastname || !firstname) {
      showAlert('Missing Information', 'Member ID, Last Name, and First Name are required.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        Lastname: lastname,
        Firstname: firstname,
        Gender: form.Gender || null,
        Status: form.Status || 'Active',
        AreaName: form.AreaName.trim() || null,
        NameOfHouseholdHead: form.NameOfHouseholdHead.trim() || null,
        PastoralService: form.PastoralService.trim() || null,
      };

      if (modalMode === 'create') {
        const { data: existing, error: lookupError } = await supabase
          .from('members')
          .select('MemberIDNo')
          .eq('MemberIDNo', memberId)
          .maybeSingle();
        if (lookupError) throw lookupError;
        if (existing) {
          showAlert('Member Already Exists', `A member with ID "${memberId}" is already in the Directory.`);
          return;
        }

        const { error: insertError } = await supabase.from('members').insert([{ MemberIDNo: memberId, ...payload }]);
        if (insertError) throw insertError;
        showAlert('Member Added', `${lastname}, ${firstname} (ID: ${memberId}) was added.`);
      } else {
        const { error: updateError } = await supabase.from('members').update(payload).eq('MemberIDNo', memberId);
        if (updateError) throw updateError;
        showAlert('Member Updated', `${lastname}, ${firstname} was updated.`);
      }

      setModalVisible(false);
      fetchMembers();
    } catch (err) {
      showAlert('Save Failed', err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(member) {
    confirmAction(
      'Delete Member',
      `Remove ${member.Lastname}, ${member.Firstname} (ID: ${member.MemberIDNo}) permanently? This also removes their PFO training record. This cannot be undone.`,
      async () => {
        setDeletingId(member.MemberIDNo);
        try {
          // pfo_members has no enforced foreign key back to members, so it
          // won't be cleaned up automatically -- delete it explicitly first
          // to avoid leaving an orphaned training-progress row behind.
          const { error: pfoError } = await supabase.from('pfo_members').delete().eq('MemberIDNo', member.MemberIDNo);
          if (pfoError) throw pfoError;

          const { error } = await supabase.from('members').delete().eq('MemberIDNo', member.MemberIDNo);
          if (error) throw error;

          setMembers((prev) => prev.filter((m) => m.MemberIDNo !== member.MemberIDNo));
        } catch (err) {
          showAlert('Delete Failed', err.message);
        } finally {
          setDeletingId(null);
        }
      }
    );
  }

  function handleExport() {
    exportCsv(
      'members',
      [
        { key: 'MemberIDNo', label: 'Member ID' },
        { key: 'Lastname', label: 'Last Name' },
        { key: 'Firstname', label: 'First Name' },
        { key: 'Gender', label: 'Gender' },
        { key: 'Status', label: 'Status' },
        { key: 'AreaName', label: 'Area' },
        { key: 'NameOfHouseholdHead', label: 'Household Head' },
        { key: 'PastoralService', label: 'Pastoral Service' },
      ],
      filteredMembers
    );
  }

  if (loading) return <ActivityIndicator size="large" color="#002060" style={styles.centered} />;

  return (
    <View style={styles.container}>
      <View style={styles.heroSection}>
        <View style={styles.titleRow}>
          <Ionicons name="list-outline" size={22} color="#0f172a" style={styles.titleIcon} />
          <Text style={styles.title}>Manage Members</Text>
        </View>
        <Text style={styles.subtitle}>Every member, unfiltered by Area. Add, edit, or remove records directly.</Text>
      </View>

      <View style={styles.controlsRow}>
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={16} color="#94a3b8" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search name, ID, Area, or Pastoral Service..."
            placeholderTextColor="#94a3b8"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
        </View>

        <ExportButton onPress={handleExport} />

        <TouchableOpacity style={styles.addBtn} onPress={openCreateModal}>
          <Ionicons name="add-outline" size={15} color="#ffffff" style={{ marginRight: 4 }} />
          <Text style={styles.addBtnText}>Add Member</Text>
        </TouchableOpacity>
      </View>

      <TableCard style={{ flex: 1 }}>
        {!isNarrow && (
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.headerText, styles.nameCol]}>NAME</Text>
            <Text style={[styles.headerText, styles.householdCol]}>HOUSEHOLD HEAD</Text>
            <Text style={[styles.headerText, styles.genderCol]}>GENDER</Text>
            <Text style={[styles.headerText, styles.statusCol]}>STATUS</Text>
            <Text style={[styles.headerText, styles.roleCol]}>ROLE & AREA</Text>
            <Text style={[styles.headerText, styles.actionsCol]}>ACTIONS</Text>
          </View>
        )}

        <FlatList
          data={pageItems}
          keyExtractor={(item) => item.MemberIDNo?.toString()}
          renderItem={({ item }) => {
            const isDeleting = deletingId === item.MemberIDNo;

            const actions = isDeleting ? (
              <ActivityIndicator size="small" color="#002060" />
            ) : (
              <>
                <TouchableOpacity onPress={() => openEditModal(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="create-outline" size={18} color="#2563eb" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleDelete(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="trash-outline" size={18} color="#dc2626" />
                </TouchableOpacity>
              </>
            );

            if (isNarrow) {
              return (
                <View style={[styles.tableRow, styles.narrowRow]}>
                  <View style={styles.narrowTopRow}>
                    <View style={[styles.nameCell, { flex: 1 }]}>
                      <View style={styles.avatar}>
                        <Text style={styles.avatarText}>{getInitials(item.Firstname, item.Lastname)}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.nameText} numberOfLines={1}>{item.Lastname}, {item.Firstname}</Text>
                        <Text style={styles.idText}>ID: {item.MemberIDNo}</Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 14 }}>{actions}</View>
                  </View>

                  <Text style={styles.householdText}>{item.NameOfHouseholdHead || 'N/A'} · {item.Gender || 'Gender N/A'}</Text>

                  <View style={styles.narrowBadgeRow}>
                    <View style={[styles.statusBadge, { backgroundColor: getStatusColors(item.Status).bg, borderColor: getStatusColors(item.Status).border }]}>
                      <Text style={[styles.statusBadgeText, { color: getStatusColors(item.Status).text }]}>{item.Status || 'Active'}</Text>
                    </View>
                    <View style={styles.roleBadge}><Text style={styles.roleBadgeText}>{item.PastoralService || 'MEMBER'}</Text></View>
                    <View style={styles.areaBadge}><Text style={styles.areaBadgeText}>{item.AreaName || 'No Area'}</Text></View>
                  </View>
                </View>
              );
            }

            return (
              <View style={styles.tableRow}>
                <View style={[styles.cell, styles.nameCol, styles.nameCell]}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{getInitials(item.Firstname, item.Lastname)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.nameText} numberOfLines={1}>{item.Lastname}, {item.Firstname}</Text>
                    <Text style={styles.idText}>ID: {item.MemberIDNo}</Text>
                  </View>
                </View>

                <View style={[styles.cell, styles.householdCol]}>
                  <Text style={styles.householdText} numberOfLines={2}>{item.NameOfHouseholdHead || 'N/A'}</Text>
                </View>

                <View style={[styles.cell, styles.genderCol]}>
                  <Text style={styles.plainCellText}>{item.Gender || 'N/A'}</Text>
                </View>

                <View style={[styles.cell, styles.statusCol]}>
                  <View style={[styles.statusBadge, { backgroundColor: getStatusColors(item.Status).bg, borderColor: getStatusColors(item.Status).border }]}>
                    <Text style={[styles.statusBadgeText, { color: getStatusColors(item.Status).text }]}>{item.Status || 'Active'}</Text>
                  </View>
                </View>

                <View style={[styles.cell, styles.roleCol, { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }]}>
                  <View style={styles.roleBadge}><Text style={styles.roleBadgeText}>{item.PastoralService || 'MEMBER'}</Text></View>
                  <View style={styles.areaBadge}><Text style={styles.areaBadgeText}>{item.AreaName || 'No Area'}</Text></View>
                </View>

                <View style={[styles.cell, styles.actionsCol, { flexDirection: 'row', gap: 10 }]}>
                  {actions}
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <Text style={styles.empty}>{searchQuery ? 'No members matched your search.' : 'No members found.'}</Text>
          }
        />

        <View style={styles.tableFooter}>
          <View style={styles.pageSizeRow}>
            <Text style={styles.pageSizeLabel}>Show</Text>
            {PAGE_SIZE_OPTIONS.map((size) => {
              const isActive = pageSize === size;
              return (
                <TouchableOpacity
                  key={size}
                  style={[styles.pageSizeBadge, isActive && styles.pageSizeBadgeActive]}
                  onPress={() => handleChangePageSize(size)}
                >
                  <Text style={[styles.pageSizeBadgeText, isActive && styles.pageSizeBadgeTextActive]}>{size}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TablePagination page={page} pageCount={pageCount} totalCount={filteredMembers.length} pageSize={pageSize} onChange={setPage} />
        </View>
      </TableCard>

      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={closeModal}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={styles.modalScrollContainer} style={{ width: '100%' }} showsVerticalScrollIndicator={false}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>{modalMode === 'create' ? 'Add New Member' : 'Edit Member'}</Text>

              <View style={[styles.row, { zIndex: 40 }]}>
                <View style={styles.fieldWrap}>
                  <Text style={styles.fieldLabel}>Member ID *</Text>
                  <TextInput
                    style={[styles.input, modalMode === 'edit' && styles.inputDisabled]}
                    value={form.MemberIDNo}
                    onChangeText={(v) => setField('MemberIDNo', v)}
                    placeholder="e.g. PM-00123"
                    placeholderTextColor="#94a3b8"
                    autoCorrect={false}
                    autoCapitalize="characters"
                    editable={modalMode === 'create'}
                  />
                </View>
                <View style={styles.fieldWrap}>
                  <Text style={styles.fieldLabel}>Last Name *</Text>
                  <TextInput
                    style={styles.input}
                    value={form.Lastname}
                    onChangeText={(v) => setField('Lastname', v)}
                    placeholder="Dela Cruz"
                    placeholderTextColor="#94a3b8"
                    autoCorrect={false}
                  />
                </View>
                <View style={styles.fieldWrap}>
                  <Text style={styles.fieldLabel}>First Name *</Text>
                  <TextInput
                    style={styles.input}
                    value={form.Firstname}
                    onChangeText={(v) => setField('Firstname', v)}
                    placeholder="Juan"
                    placeholderTextColor="#94a3b8"
                    autoCorrect={false}
                  />
                </View>
              </View>

              <View style={[styles.row, { zIndex: 30 }]}>
                <View style={styles.fieldWrap}>
                  <Text style={styles.fieldLabel}>Gender</Text>
                  <View style={styles.genderToggleRow}>
                    {GENDER_OPTIONS.map((g) => {
                      const active = form.Gender === g;
                      return (
                        <TouchableOpacity
                          key={g}
                          style={[styles.genderToggle, active && styles.genderToggleActive]}
                          onPress={() => setField('Gender', active ? '' : g)}
                        >
                          <Text style={[styles.genderToggleText, active && styles.genderToggleTextActive]}>{g}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                <SelectField label="Status" value={form.Status} options={STATUS_OPTIONS} onChange={(v) => setField('Status', v)} />

                <AutocompleteField
                  label="Area"
                  value={form.AreaName}
                  onChangeText={(v) => setField('AreaName', v)}
                  suggestions={areaNames}
                  placeholder="e.g. West 1C2"
                />
              </View>

              <View style={[styles.row, { zIndex: 20 }]}>
                <AutocompleteField
                  label="Household Head"
                  value={form.NameOfHouseholdHead}
                  onChangeText={(v) => setField('NameOfHouseholdHead', v)}
                  suggestions={householdHeads}
                  placeholder="Name of household head"
                />

                <AutocompleteField
                  label="Pastoral Service"
                  value={form.PastoralService}
                  onChangeText={(v) => setField('PastoralService', v)}
                  suggestions={pastoralServices}
                  placeholder="e.g. MEMBER, CL, UL…"
                  getLabel={getServiceLabel}
                />
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity style={[styles.btn, styles.btnCancel]} onPress={closeModal} disabled={saving}>
                  <Text style={styles.btnTextCancel}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, styles.btnConfirm, !canSave && styles.btnDisabled]}
                  onPress={handleSave}
                  disabled={!canSave}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Text style={styles.btnTextConfirm}>{modalMode === 'create' ? 'Add Member' : 'Save Changes'}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
        </KeyboardAvoidingView>
      </Modal>
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

  controlsRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 14 },
  searchContainer: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#ffffff', borderRadius: 10, paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 10 : 5, borderWidth: 1, borderColor: '#e2e8f0',
    maxWidth: 300, flexGrow: 1, shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 2, elevation: 1,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: '#1e293b', fontWeight: '500' },

  addBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: NAVY, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9 },
  addBtnText: { fontSize: 12, fontWeight: '700', color: '#ffffff' },

  tableHeaderRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#e2e8f0', backgroundColor: '#f8fafc' },
  headerText: { fontSize: 11, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.3, paddingHorizontal: 4 },

  nameCol: { flexGrow: 2, flexShrink: 1, flexBasis: 0, minWidth: 160 },
  householdCol: { flexGrow: 1.4, flexShrink: 1, flexBasis: 0, minWidth: 140 },
  genderCol: { width: 80 },
  statusCol: { width: 110 },
  roleCol: { flexGrow: 1.6, flexShrink: 1, flexBasis: 0, minWidth: 160 },
  actionsCol: { width: 80 },

  tableRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  cell: { paddingHorizontal: 4, justifyContent: 'center' },
  nameCell: { flexDirection: 'row', alignItems: 'center' },

  narrowRow: { flexDirection: 'column', alignItems: 'stretch', gap: 8 },
  narrowTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  narrowBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },

  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#eff6ff', justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  avatarText: { fontSize: 12, fontWeight: '800', color: '#002060' },
  nameText: { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  idText: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  householdText: { fontSize: 13, color: '#475569' },
  plainCellText: { fontSize: 13, color: '#475569', fontWeight: '600' },

  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1, alignSelf: 'flex-start' },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },

  roleBadge: { backgroundColor: '#eff6ff', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  roleBadgeText: { fontSize: 11, fontWeight: '700', color: '#002060' },
  areaBadge: { backgroundColor: '#f1f5f9', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  areaBadgeText: { fontSize: 11, fontWeight: '700', color: '#475569' },

  empty: { textAlign: 'center', color: '#94a3b8', marginTop: 40, marginBottom: 20 },

  tableFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  pageSizeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 16, paddingVertical: 10 },
  pageSizeLabel: { fontSize: 11, fontWeight: '700', color: '#94a3b8', marginRight: 2 },
  pageSizeBadge: { minWidth: 30, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 20, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center' },
  pageSizeBadgeActive: { backgroundColor: '#002060', borderColor: '#002060' },
  pageSizeBadgeText: { fontSize: 11, fontWeight: '700', color: '#334155' },
  pageSizeBadgeTextActive: { color: '#ffffff' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.4)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalScrollContainer: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 20 },
  modalContent: {
    backgroundColor: '#ffffff', borderRadius: 14, padding: 20, width: '100%', maxWidth: 640, gap: 16,
    ...Platform.select({
      web: { boxShadow: '0 4px 10px 0 rgba(0,0,0,0.1)' },
      default: { elevation: 5 },
    }),
  },
  modalTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a' },

  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  fieldWrap: { flexGrow: 1, flexBasis: 220, position: 'relative' },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: '#475569', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#1e293b', backgroundColor: '#ffffff' },
  inputDisabled: { backgroundColor: '#f1f5f9', color: '#94a3b8' },

  selectButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#ffffff',
  },
  selectValueText: { fontSize: 14, color: '#1e293b', fontWeight: '600' },
  selectPlaceholderText: { fontSize: 14, color: '#94a3b8' },

  suggestionBox: {
    position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
    backgroundColor: '#ffffff', borderRadius: 8, borderWidth: 1, borderColor: '#cbd5e1',
    shadowColor: '#0f172a', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 8,
    elevation: 8, zIndex: 40, overflow: 'hidden',
  },
  suggestionItem: { paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  suggestionItemActive: { backgroundColor: '#eff6ff' },
  suggestionText: { fontSize: 13, color: '#334155', fontWeight: '500' },
  suggestionTextActive: { color: '#002060', fontWeight: '700' },

  genderToggleRow: { flexDirection: 'row', gap: 8 },
  genderToggle: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#ffffff' },
  genderToggleActive: { backgroundColor: NAVY, borderColor: NAVY },
  genderToggleText: { fontSize: 13, fontWeight: '700', color: '#334155' },
  genderToggleTextActive: { color: '#ffffff' },

  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, zIndex: 10 },
  btn: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 11, borderRadius: 8, minWidth: 110, alignItems: 'center', justifyContent: 'center' },
  btnCancel: { backgroundColor: '#f1f5f9' },
  btnConfirm: { backgroundColor: ACCENT_BLUE },
  btnDisabled: { backgroundColor: '#cbd5e1', opacity: 0.6 },
  btnTextCancel: { color: '#475569', fontSize: 13, fontWeight: '600' },
  btnTextConfirm: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
});
