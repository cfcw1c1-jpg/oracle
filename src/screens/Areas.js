import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import {
  ActionLink,
  EmptyRow,
  ExportButton,
  exportCsv,
  IconBadge,
  Pill,
  TableCard,
  TableRow,
} from '../components/admin-table';

const NAVY = '#002060';
const ACCENT_BLUE = '#2563eb';
const AREA_TYPES = ['Sector', 'Cluster', 'Chapter'];

// Matches the Sector/Cluster/Chapter palette used across the admin screens
// so a badge reads the same way everywhere.
const AREA_TYPE_STYLES = {
  Sector: { color: '#7c3aed', bg: '#ede9fe', icon: 'planet-outline' },
  Cluster: { color: '#2563eb', bg: '#dbeafe', icon: 'layers-outline' },
  Chapter: { color: '#16a34a', bg: '#dcfce7', icon: 'home-outline' },
};

// A member with no Status yet (legacy rows) counts as Active; only an
// explicit non-Active status (Inactive/Deceased/SOLD/HANDMAID) excludes
// them — matches src/screens/DashboardHome.js.
function isActiveStatus(status) {
  return !status || status === 'Active';
}

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
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Confirm', style: 'destructive', onPress: onConfirm },
  ]);
}

// Self-referential Sector > Cluster > Chapter tree. Each area has a single
// head member (areas.head_member_id) and a roster of assigned members
// (area_members) — a member may head, or simply belong under, more than
// one area at a time.
function buildAreaTree(areas) {
  const byParent = new Map();
  areas.forEach((a) => {
    const key = a.parent_id || 'root';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(a);
  });
  function walk(parentKey, depth) {
    const children = (byParent.get(parentKey) || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    return children.flatMap((a) => [{ ...a, depth }, ...walk(a.id, depth + 1)]);
  }
  return walk('root', 0);
}

// An area can't be re-parented onto itself or onto one of its own
// descendants — that would cut the subtree off from the tree entirely.
function getDescendantIds(areas, rootId) {
  const ids = new Set();
  const stack = [rootId];
  while (stack.length) {
    const current = stack.pop();
    areas.forEach((a) => {
      if (a.parent_id === current && !ids.has(a.id)) {
        ids.add(a.id);
        stack.push(a.id);
      }
    });
  }
  return ids;
}

// Both the "# Members" badge and the "Members Under This Area" list in the
// manage modal are derived the same way — from the members table itself,
// members."AreaName" LIKE '{area.name}%' — rather than a separately curated
// roster, so the two always agree and both reflect the actual Directory
// data (and match sub-variants like "West 1A"/"West 1 - Unit 3" under an
// Area named "West 1").
function matchesAreaPrefix(memberAreaName, areaName) {
  const prefix = (areaName || '').trim().toLowerCase();
  if (!prefix) return false;
  return (memberAreaName || '').trim().toLowerCase().startsWith(prefix);
}

function countMembersByAreaPrefix(allMembers, areaName) {
  return allMembers.filter((m) => isActiveStatus(m.Status) && matchesAreaPrefix(m.AreaName, areaName)).length;
}

function getMembersByAreaPrefix(allMembers, areaName) {
  return allMembers
    .filter((m) => isActiveStatus(m.Status) && matchesAreaPrefix(m.AreaName, areaName))
    .sort((a, b) => (a.Lastname || '').localeCompare(b.Lastname || ''));
}

// For a Chapter-type area, the natural head candidates are its own members
// already tagged "CH" (Chapter Head) in the Directory's Pastoral Service
// field -- Sector/Cluster have no equivalent role code, so head assignment
// for those stays a plain member search.
function getChapterHeadCandidates(allMembers, areaName) {
  return getMembersByAreaPrefix(allMembers, areaName)
    .filter((m) => (m.PastoralService || '').trim().toUpperCase() === 'CH');
}

export default function Areas() {
  const [loading, setLoading] = useState(true);
  const [areas, setAreas] = useState([]);
  const [allMembers, setAllMembers] = useState([]);
  const [selectedAreaId, setSelectedAreaId] = useState(null);

  const [manageModalVisible, setManageModalVisible] = useState(false);

  const [areaModalVisible, setAreaModalVisible] = useState(false);
  const [areaModalMode, setAreaModalMode] = useState('add'); // 'add' | 'edit'
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState('Sector');
  const [formParentId, setFormParentId] = useState(null);
  const [saving, setSaving] = useState(false);

  const [headSearchQuery, setHeadSearchQuery] = useState('');
  const [headSearchResults, setHeadSearchResults] = useState([]);
  const headSearchInputRef = useRef(null);

  useEffect(() => {
    loadAreas();
  }, []);

  useEffect(() => {
    setHeadSearchQuery('');
    setHeadSearchResults([]);
  }, [selectedAreaId]);

  useEffect(() => {
    if (headSearchQuery.trim().length >= 2) searchMembers(headSearchQuery, setHeadSearchResults);
    else setHeadSearchResults([]);
  }, [headSearchQuery]);

  async function loadAreas() {
    try {
      setLoading(true);
      const [areasRes, membersRes] = await Promise.all([
        supabase
          .from('areas')
          .select('id, name, type, parent_id, head_member_id, members ( Firstname, Lastname )')
          .order('name'),
        supabase.from('members').select('MemberIDNo, Firstname, Lastname, AreaName, Status, PastoralService'),
      ]);
      if (areasRes.error) throw areasRes.error;
      if (membersRes.error) throw membersRes.error;
      setAreas(areasRes.data || []);
      setAllMembers(membersRes.data || []);
    } catch (err) {
      showAlert('Error Loading Areas', err.message);
    } finally {
      setLoading(false);
    }
  }

  async function searchMembers(query, setResults) {
    try {
      const { data, error } = await supabase
        .from('members')
        .select('MemberIDNo, Firstname, Lastname')
        .or(`Firstname.ilike.%${query}%,Lastname.ilike.%${query}%`)
        .limit(5);
      if (error) throw error;
      setResults(data || []);
    } catch (err) {
      console.error('Error searching members:', err.message);
    }
  }

  function openAddAreaModal() {
    setAreaModalMode('add');
    setFormName('');
    setFormType('Sector');
    setFormParentId(null);
    setAreaModalVisible(true);
  }

  // Editing only ever happens through this — clicking a row (or "Manage")
  // opens the head/members modal instead, it never triggers field editing.
  function openEditAreaModal(area) {
    setSelectedAreaId(area.id);
    setAreaModalMode('edit');
    setFormName(area.name);
    setFormType(area.type);
    setFormParentId(area.parent_id);
    setAreaModalVisible(true);
  }

  function openManageModal(area) {
    setSelectedAreaId(area.id);
    setManageModalVisible(true);
  }

  async function handleSaveArea() {
    if (!formName.trim()) {
      showAlert('Validation Error', 'Please enter an area name.');
      return;
    }
    try {
      setSaving(true);
      if (areaModalMode === 'edit') {
        const { error } = await supabase
          .from('areas')
          .update({ name: formName.trim(), type: formType, parent_id: formParentId })
          .eq('id', selectedAreaId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('areas')
          .insert([{ name: formName.trim(), type: formType, parent_id: formParentId }])
          .select();
        if (error) throw error;
        if (data?.[0]) setSelectedAreaId(data[0].id);
      }
      setAreaModalVisible(false);
      await loadAreas();
    } catch (err) {
      showAlert(areaModalMode === 'edit' ? 'Error Updating Area' : 'Error Creating Area', err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleDeleteArea(area) {
    const hasChildren = areas.some((a) => a.parent_id === area.id);
    confirmAction(
      'Delete Area',
      hasChildren
        ? `"${area.name}" has sub-areas nested under it. Deleting it will delete all of those too. Continue?`
        : `Delete "${area.name}"?`,
      async () => {
        try {
          const { error } = await supabase.from('areas').delete().eq('id', area.id);
          if (error) throw error;
          if (selectedAreaId === area.id) setSelectedAreaId(null);
          await loadAreas();
        } catch (err) {
          showAlert('Error Deleting Area', err.message);
        }
      }
    );
  }

  async function assignHead(member) {
    if (!selectedAreaId) return;
    try {
      const { error } = await supabase
        .from('areas')
        .update({ head_member_id: member.MemberIDNo })
        .eq('id', selectedAreaId);
      if (error) throw error;
      setHeadSearchQuery('');
      setHeadSearchResults([]);
      await loadAreas();
    } catch (err) {
      showAlert('Error Assigning Head', err.message);
    }
  }

  async function removeHead() {
    if (!selectedAreaId) return;
    try {
      const { error } = await supabase.from('areas').update({ head_member_id: null }).eq('id', selectedAreaId);
      if (error) throw error;
      await loadAreas();
    } catch (err) {
      showAlert('Error Removing Head', err.message);
    }
  }

  const tree = buildAreaTree(areas);
  const selectedArea = areas.find((a) => a.id === selectedAreaId) || null;
  const stagedHeadIds = new Set(selectedArea?.head_member_id ? [selectedArea.head_member_id] : []);
  const derivedAreaMembers = selectedArea ? getMembersByAreaPrefix(allMembers, selectedArea.name) : [];
  const chapterHeadCandidates = selectedArea?.type === 'Chapter'
    ? getChapterHeadCandidates(allMembers, selectedArea.name).filter((m) => !stagedHeadIds.has(m.MemberIDNo))
    : [];

  function handleExportAreas() {
    const rows = tree.map((area) => ({
      name: area.name,
      type: area.type,
      parent: areas.find((a) => a.id === area.parent_id)?.name || '',
      head: area.members ? `${area.members.Firstname} ${area.members.Lastname}` : '',
      members: countMembersByAreaPrefix(allMembers, area.name),
    }));
    exportCsv('areas', [
      { key: 'name', label: 'Area' },
      { key: 'type', label: 'Type' },
      { key: 'parent', label: 'Parent' },
      { key: 'head', label: 'Head' },
      { key: 'members', label: 'Members' },
    ], rows);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Ionicons name="git-network-outline" size={22} color="#0f172a" style={styles.titleIcon} />
          <Text style={styles.title}>Areas</Text>
        </View>
        <Text style={styles.subtitle}>Build the Sector / Cluster / Chapter hierarchy and assign heads and members.</Text>
      </View>

      <View style={styles.body}>
        <TableCard
          style={styles.fillCard}
          title={`${areas.length} Area${areas.length === 1 ? '' : 's'}`}
          right={
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <ExportButton onPress={handleExportAreas} />
              <TouchableOpacity style={styles.headerActionBtn} onPress={openAddAreaModal}>
                <Ionicons name="add-outline" size={14} color="#334155" style={{ marginRight: 4 }} />
                <Text style={styles.headerActionBtnText}>Add Area</Text>
              </TouchableOpacity>
            </View>
          }
        >
          <Text style={styles.editorLabel}>Editor</Text>

          {loading ? (
            <ActivityIndicator size="large" color={NAVY} style={{ padding: 30 }} />
          ) : tree.length === 0 ? (
            <EmptyRow label="No areas yet. Add a Sector to get started." />
          ) : (
            <ScrollView style={styles.rowsScroll} contentContainerStyle={styles.treeScrollContent}>
              <View style={styles.flowMarkerRow}>
                <Ionicons name="arrow-down-outline" size={12} color="#94a3b8" />
                <Text style={styles.flowMarkerText}>Start</Text>
              </View>

              {tree.map((area) => {
                const headName = area.members ? `${area.members.Firstname} ${area.members.Lastname}` : null;
                const typeStyle = AREA_TYPE_STYLES[area.type];
                const memberCount = countMembersByAreaPrefix(allMembers, area.name);

                return (
                  <TouchableOpacity
                    key={area.id}
                    style={[styles.treeRow, { paddingLeft: 6 + area.depth * 34 }]}
                    onPress={() => openManageModal(area)}
                    activeOpacity={0.7}
                  >
                    {area.depth > 0 && <Text style={styles.hookGlyph}>↳</Text>}
                    <View style={[styles.treeBar, { backgroundColor: typeStyle.color }]} />

                    <View style={styles.treeContent}>
                      <View style={styles.treeMainInfo}>
                        <IconBadge name={typeStyle.icon} color={typeStyle.color} bg={typeStyle.bg} size={38} />
                        <Text style={styles.mainText} numberOfLines={1}>{area.name}</Text>
                        <Pill label={area.type} color={typeStyle.color} bg={typeStyle.bg} />
                      </View>
                      <View style={styles.treeMetaInfo}>
                        <Pill label={headName || 'No head'} color="#334155" bg="#f1f5f9" />
                        <Pill label={`${memberCount} member${memberCount === 1 ? '' : 's'}`} color="#334155" bg="#f1f5f9" />
                        <View style={styles.actionsWrap}>
                          <ActionLink label="Manage" icon="options-outline" onPress={() => openManageModal(area)} />
                          <ActionLink label="Edit" icon="create-outline" color="#334155" onPress={() => openEditAreaModal(area)} />
                          <TouchableOpacity onPress={() => handleDeleteArea(area)}>
                            <Ionicons name="trash-outline" size={18} color="#ef4444" />
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}

              <View style={styles.flowMarkerRow}>
                <Ionicons name="ellipse-outline" size={10} color="#94a3b8" />
                <Text style={styles.flowMarkerText}>End · {areas.length} area{areas.length === 1 ? '' : 's'}</Text>
              </View>
            </ScrollView>
          )}
        </TableCard>
      </View>

      <Modal visible={manageModalVisible} transparent animationType="fade" onRequestClose={() => setManageModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, styles.manageModalCard]}>
            <Text style={styles.modalTitle}>{selectedArea ? `${selectedArea.name} — ${selectedArea.type}` : 'Manage Area'}</Text>

            <ScrollView style={styles.manageScroll}>
              <Text style={styles.subSectionLabel}>Head of Area</Text>
              {selectedArea?.members ? (
                <TableRow style={styles.compactRow} last>
                  <IconBadge name="person-outline" size={28} />
                  <Text style={[styles.mainText, { flex: 1, marginLeft: 10 }]}>
                    {selectedArea.members.Firstname} {selectedArea.members.Lastname}
                  </Text>
                  <TouchableOpacity onPress={removeHead}>
                    <Ionicons name="close-circle" size={18} color="#ef4444" />
                  </TouchableOpacity>
                </TableRow>
              ) : (
                <Text style={styles.hintText}>No head assigned yet.</Text>
              )}

              {selectedArea?.type === 'Chapter' && (
                <>
                  <Text style={styles.hintText}>
                    Tagged &quot;Chapter Head&quot; under this Area:
                  </Text>
                  {chapterHeadCandidates.length === 0 ? (
                    <Text style={styles.hintText}>
                      None yet — set a member&apos;s Pastoral Service to &quot;CH&quot; from Manage Members, or search below.
                    </Text>
                  ) : (
                    chapterHeadCandidates.map((m) => (
                      <TouchableOpacity key={m.MemberIDNo} style={styles.optionRow} onPress={() => assignHead(m)}>
                        <Ionicons name="ribbon-outline" size={16} color={ACCENT_BLUE} style={{ marginRight: 10 }} />
                        <Text style={styles.optionRowText}>{m.Lastname}, {m.Firstname}</Text>
                      </TouchableOpacity>
                    ))
                  )}
                </>
              )}

              <View style={styles.searchBox}>
                <Ionicons name="search-outline" size={14} color="#94a3b8" style={{ marginRight: 6 }} />
                <TextInput
                  ref={headSearchInputRef}
                  style={styles.searchInput}
                  placeholder={selectedArea?.type === 'Chapter' ? 'Search any other member...' : 'Search member to assign as head...'}
                  placeholderTextColor="#94a3b8"
                  value={headSearchQuery}
                  onChangeText={setHeadSearchQuery}
                />
              </View>
              {headSearchResults.filter((m) => !stagedHeadIds.has(m.MemberIDNo)).map((m) => (
                <TouchableOpacity key={m.MemberIDNo} style={styles.optionRow} onPress={() => assignHead(m)}>
                  <Ionicons name="person-add-outline" size={16} color={ACCENT_BLUE} style={{ marginRight: 10 }} />
                  <Text style={styles.optionRowText}>{m.Firstname} {m.Lastname}</Text>
                </TouchableOpacity>
              ))}

              <View style={styles.divider} />

              <Text style={styles.subSectionLabel}>Members Under This Area ({derivedAreaMembers.length})</Text>
              <Text style={styles.hintText}>
                Matched automatically from the Directory by Area name — same list the “{derivedAreaMembers.length} member{derivedAreaMembers.length === 1 ? '' : 's'}” badge counts. To move a member in or out, edit their Area from Manage Members.
              </Text>

              {derivedAreaMembers.slice(0, 50).map((m, index) => (
                <TableRow key={m.MemberIDNo} style={styles.compactRow} last={index === Math.min(derivedAreaMembers.length, 50) - 1}>
                  <IconBadge name="person-outline" size={28} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.mainText}>{m.Lastname}, {m.Firstname}</Text>
                    <Text style={styles.subText}>{m.AreaName}</Text>
                  </View>
                </TableRow>
              ))}
              {derivedAreaMembers.length > 50 && (
                <Text style={styles.hintText}>+{derivedAreaMembers.length - 50} more — see Manage Members for the full list.</Text>
              )}
              {derivedAreaMembers.length === 0 && (
                <Text style={styles.hintText}>No members in the Directory match this Area yet.</Text>
              )}
            </ScrollView>

            <TouchableOpacity style={styles.modalCancelBtnStandalone} onPress={() => setManageModalVisible(false)}>
              <Text style={styles.modalCancelBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={areaModalVisible} transparent animationType="fade" onRequestClose={() => setAreaModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{areaModalMode === 'edit' ? 'Edit Area' : 'Add Area'}</Text>
            <TextInput
              style={styles.textInput}
              placeholder="Area name (e.g. West 1)"
              placeholderTextColor="#94a3b8"
              value={formName}
              onChangeText={setFormName}
            />

            <Text style={styles.fieldLabel}>Type</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {AREA_TYPES.map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[styles.typeChip, formType === type && styles.typeChipActive]}
                  onPress={() => setFormType(type)}
                >
                  <Text style={[styles.typeChipText, formType === type && styles.typeChipTextActive]}>{type}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Parent Area (optional)</Text>
            <ScrollView style={{ maxHeight: 160, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8 }}>
              <TouchableOpacity
                style={[styles.optionRow, formParentId === null && styles.optionRowActive]}
                onPress={() => setFormParentId(null)}
              >
                <Text style={styles.optionRowText}>No parent (top-level)</Text>
              </TouchableOpacity>
              {areas
                .filter((area) => {
                  if (areaModalMode !== 'edit' || !selectedArea) return true;
                  if (area.id === selectedArea.id) return false;
                  return !getDescendantIds(areas, selectedArea.id).has(area.id);
                })
                .map((area) => (
                  <TouchableOpacity
                    key={area.id}
                    style={[styles.optionRow, formParentId === area.id && styles.optionRowActive]}
                    onPress={() => setFormParentId(area.id)}
                  >
                    <Text style={styles.optionRowText}>{area.name} ({area.type})</Text>
                  </TouchableOpacity>
                ))}
            </ScrollView>

            <View style={styles.modalButtonRow}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setAreaModalVisible(false)}>
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleSaveArea} disabled={saving}>
                {saving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalSaveBtnText}>{areaModalMode === 'edit' ? 'Save' : 'Create'}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },

  header: { padding: 16, paddingBottom: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  titleIcon: { marginRight: 8 },
  title: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  subtitle: { fontSize: 12, color: '#64748b', marginTop: 4 },

  body: { flex: 1, paddingHorizontal: 16, paddingBottom: 16 },
  fillCard: { flex: 1 },
  rowsScroll: { flex: 1 },
  treeScrollContent: { paddingHorizontal: 16, paddingBottom: 12 },

  editorLabel: {
    fontSize: 10, fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.6,
    paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },

  flowMarkerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  flowMarkerText: { fontSize: 11, fontWeight: '700', color: '#94a3b8', fontStyle: 'italic' },

  treeRow: { flexDirection: 'row', alignItems: 'stretch', paddingVertical: 18, minHeight: 64 },
  hookGlyph: { fontSize: 22, color: '#cbd5e1', marginRight: 6, alignSelf: 'center' },
  treeBar: { width: 4, borderRadius: 2, marginRight: 16 },
  treeContent: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    flexWrap: 'wrap', rowGap: 10, columnGap: 16,
  },
  treeMainInfo: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1 },
  treeMetaInfo: { flexDirection: 'row', alignItems: 'center', gap: 18, flexWrap: 'wrap' },

  headerActionBtn: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 10,
    borderRadius: 8, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0',
  },
  headerActionBtnText: { fontSize: 12, fontWeight: '700', color: '#334155' },

  subSectionLabel: { fontSize: 12, fontWeight: '700', color: '#334155', marginTop: 8, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.3 },
  hintText: { fontSize: 12, color: '#94a3b8', marginBottom: 8 },

  mainText: { fontSize: 13, fontWeight: '800', color: '#0f172a' },
  subText: { fontSize: 11, color: '#64748b' },

  actionsWrap: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 16 },

  compactRow: { borderRadius: 10, backgroundColor: '#f8fafc', borderBottomWidth: 0, marginBottom: 8, paddingVertical: 8 },

  searchBox: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', borderWidth: 1,
    borderColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 4,
  },
  searchInput: { flex: 1, fontSize: 13, color: '#1e293b', padding: 0 },

  optionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 8, borderRadius: 8 },
  optionRowActive: { backgroundColor: '#eff6ff' },
  optionRowText: { fontSize: 13, color: '#1e293b', fontWeight: '600' },

  divider: { height: 1, backgroundColor: '#f1f5f9', marginVertical: 8 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  modalCard: { backgroundColor: '#ffffff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 420 },
  manageModalCard: { maxWidth: 480, maxHeight: '85%' },
  manageScroll: { marginTop: 8 },
  modalTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  modalButtonRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
  modalCancelBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, backgroundColor: '#f1f5f9' },
  modalCancelBtnStandalone: { marginTop: 16, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, backgroundColor: '#f1f5f9', alignSelf: 'flex-end' },
  modalCancelBtnText: { fontSize: 13, fontWeight: '700', color: '#334155' },
  modalSaveBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, backgroundColor: NAVY, minWidth: 80, alignItems: 'center' },
  modalSaveBtnText: { fontSize: 13, fontWeight: '700', color: '#ffffff' },

  textInput: {
    borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 12,
    paddingVertical: 10, fontSize: 13, color: '#1e293b',
  },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: '#64748b', marginTop: 14, marginBottom: 6, textTransform: 'uppercase' },
  typeChip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0' },
  typeChipActive: { backgroundColor: NAVY, borderColor: NAVY },
  typeChipText: { fontSize: 12, fontWeight: '700', color: '#334155' },
  typeChipTextActive: { color: '#ffffff' },
});
