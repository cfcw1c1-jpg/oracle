import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  ActionLink,
  EmptyRow,
  ExportButton,
  exportCsv,
  InitialsBadge,
  Pill,
  TableCard,
  TableHeaderRow,
  TablePagination,
  TableRow,
  usePagination,
} from '../components/admin-table';
import { supabase } from '../../lib/supabase';

const NAVY = '#002060';
const ACCENT_BLUE = '#2563eb';
const NARROW_BREAKPOINT = 720;
const PAGE_SIZE = 10;

// Matches the Sector/Cluster/Chapter palette used on the Areas screen so a
// badge reads the same way in both places.
const AREA_TYPE_STYLES = {
  Sector: { color: '#7c3aed', bg: '#ede9fe' },
  Cluster: { color: '#2563eb', bg: '#dbeafe' },
  Chapter: { color: '#16a34a', bg: '#dcfce7' },
};

function showAlert(title, message) {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
}

// An area can't be re-parented onto itself or its own descendants, but for
// display we just need every area indented under its parent — same
// approach as src/screens/Areas.js.
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

// Every signed-in portal account (auto-created on first login, see
// scripts/sql/add-admin-roles-and-areas.sql) and the dynamic role assigned
// to it. Assigning a role here is what grants that account any page access
// at all — a brand new account starts "Unassigned" and sees nothing.
//
// Areas assigned to an account (scripts/sql/add-user-area-scoping.sql)
// scope what they see in the Directory: no areas assigned = unrestricted,
// one or more assigned = only members whose AreaName falls under one of
// those areas (including nested Clusters/Chapters).
export default function PortalUsers({ onAccessChanged }) {
  const { width } = useWindowDimensions();
  const isNarrow = width < NARROW_BREAKPOINT;

  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState([]);
  const [roles, setRoles] = useState([]);
  const [areas, setAreas] = useState([]);
  const [userAreasByProfile, setUserAreasByProfile] = useState({});

  const [roleModalVisible, setRoleModalVisible] = useState(false);
  const [areasModalVisible, setAreasModalVisible] = useState(false);
  const [targetProfile, setTargetProfile] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    try {
      setLoading(true);
      const [profilesRes, rolesRes, areasRes, userAreasRes] = await Promise.all([
        supabase.from('profiles').select('id, email, full_name, role_id, roles ( name )').order('email'),
        supabase.from('roles').select('*').order('name'),
        supabase.from('areas').select('id, name, type, parent_id').order('name'),
        supabase.from('user_areas').select('profile_id, area_id, areas ( name, type )'),
      ]);
      if (profilesRes.error) throw profilesRes.error;
      if (rolesRes.error) throw rolesRes.error;
      if (areasRes.error) throw areasRes.error;
      if (userAreasRes.error) throw userAreasRes.error;

      const grouped = {};
      (userAreasRes.data || []).forEach((row) => {
        if (!grouped[row.profile_id]) grouped[row.profile_id] = [];
        grouped[row.profile_id].push({ areaId: row.area_id, name: row.areas?.name, type: row.areas?.type });
      });

      setProfiles(profilesRes.data || []);
      setRoles(rolesRes.data || []);
      setAreas(areasRes.data || []);
      setUserAreasByProfile(grouped);
    } catch (err) {
      showAlert('Error Loading Portal Users', err.message);
    } finally {
      setLoading(false);
    }
  }

  function openRoleModal(profile) {
    setTargetProfile(profile);
    setRoleModalVisible(true);
  }

  async function assignRole(roleId) {
    if (!targetProfile) return;
    try {
      setSaving(true);
      const { error } = await supabase
        .from('profiles')
        .update({ role_id: roleId })
        .eq('id', targetProfile.id);
      if (error) throw error;
      setRoleModalVisible(false);
      setTargetProfile(null);
      await loadAll();
      onAccessChanged?.();
    } catch (err) {
      showAlert('Error Assigning Role', err.message);
    } finally {
      setSaving(false);
    }
  }

  function openAreasModal(profile) {
    setTargetProfile(profile);
    setAreasModalVisible(true);
  }

  async function toggleProfileArea(areaId) {
    if (!targetProfile) return;
    const assigned = new Set((userAreasByProfile[targetProfile.id] || []).map((a) => a.areaId));
    try {
      if (assigned.has(areaId)) {
        const { error } = await supabase
          .from('user_areas')
          .delete()
          .eq('profile_id', targetProfile.id)
          .eq('area_id', areaId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('user_areas')
          .insert([{ profile_id: targetProfile.id, area_id: areaId }]);
        if (error) throw error;
      }
      await loadAll();
    } catch (err) {
      showAlert('Error Updating Area Access', err.message);
    }
  }

  const areaTree = buildAreaTree(areas);
  const { page, pageCount, pageItems, setPage } = usePagination(profiles, PAGE_SIZE);

  function handleExport() {
    const rows = profiles.map((p) => ({
      name: p.full_name || '',
      email: p.email || '',
      role: p.roles?.name || 'Unassigned',
      areas: (userAreasByProfile[p.id] || []).map((a) => a.name).join('; ') || 'All Areas',
    }));
    exportCsv('portal-users', [
      { key: 'name', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'role', label: 'Role' },
      { key: 'areas', label: 'Areas' },
    ], rows);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Ionicons name="people-circle-outline" size={22} color="#0f172a" style={styles.titleIcon} />
          <Text style={styles.title}>Portal Users</Text>
        </View>
        <Text style={styles.subtitle}>Every account that has signed in, its role, and the areas it can view.</Text>
      </View>

      <View style={styles.body}>
        <TableCard
          style={styles.fillCard}
          title={`${profiles.length} Account${profiles.length === 1 ? '' : 's'}`}
          right={<ExportButton onPress={handleExport} />}
        >
          {!isNarrow && (
            <TableHeaderRow
              columns={[
                { key: 'account', label: 'Account', style: styles.colAccount },
                { key: 'role', label: 'Role', style: styles.colRole },
                { key: 'areas', label: 'Areas', style: styles.colAreas },
                { key: 'actions', label: 'Actions', style: styles.colActions },
              ]}
            />
          )}

          {loading ? (
            <ActivityIndicator size="large" color={NAVY} style={{ padding: 30 }} />
          ) : pageItems.length === 0 ? (
            <EmptyRow label="No portal accounts yet." />
          ) : (
            <ScrollView style={styles.rowsScroll}>
            {pageItems.map((item, index) => {
              const assignedAreas = userAreasByProfile[item.id] || [];
              const initials = (item.full_name || item.email || '?').slice(0, 2).toUpperCase();
              const isLast = index === pageItems.length - 1;

              const rolePill = item.roles
                ? <Pill label={item.roles.name} color="#1d4ed8" bg="#dbeafe" />
                : <Pill label="Unassigned" color="#64748b" bg="#f1f5f9" />;

              const areaPills = assignedAreas.length === 0
                ? <Pill label="All Areas" color="#64748b" bg="#f1f5f9" />
                : (
                  <View style={styles.pillWrap}>
                    {assignedAreas.map((a) => (
                      <Pill key={a.areaId} label={a.name} color={AREA_TYPE_STYLES[a.type]?.color} bg={AREA_TYPE_STYLES[a.type]?.bg} />
                    ))}
                  </View>
                );

              const actions = (
                <View style={styles.actionsWrap}>
                  <ActionLink label="Areas" icon="git-network-outline" onPress={() => openAreasModal(item)} />
                  <ActionLink label="Change Role" icon="create-outline" onPress={() => openRoleModal(item)} />
                </View>
              );

              if (isNarrow) {
                return (
                  <TableRow key={item.id} last={isLast} style={styles.narrowRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%' }}>
                      <InitialsBadge text={initials} />
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={styles.mainText} numberOfLines={1}>{item.full_name || item.email || item.id}</Text>
                        {!!item.full_name && <Text style={styles.subText} numberOfLines={1}>{item.email}</Text>}
                      </View>
                    </View>
                    <View style={styles.narrowMetaRow}>{rolePill}</View>
                    <View style={styles.narrowMetaRow}>{areaPills}</View>
                    <View style={[styles.narrowMetaRow, { marginTop: 8 }]}>{actions}</View>
                  </TableRow>
                );
              }

              return (
                <TableRow key={item.id} last={isLast}>
                  <View style={[styles.colAccount, { flexDirection: 'row', alignItems: 'center' }]}>
                    <InitialsBadge text={initials} />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={styles.mainText} numberOfLines={1}>{item.full_name || item.email || item.id}</Text>
                      {!!item.full_name && <Text style={styles.subText} numberOfLines={1}>{item.email}</Text>}
                    </View>
                  </View>
                  <View style={styles.colRole}>{rolePill}</View>
                  <View style={styles.colAreas}>{areaPills}</View>
                  <View style={styles.colActions}>{actions}</View>
                </TableRow>
              );
            })}
            </ScrollView>
          )}

          <TablePagination page={page} pageCount={pageCount} totalCount={profiles.length} pageSize={PAGE_SIZE} onChange={setPage} />
        </TableCard>
      </View>

      <Modal visible={roleModalVisible} transparent animationType="fade" onRequestClose={() => setRoleModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Assign Role</Text>
            <Text style={styles.modalSubtitle} numberOfLines={1}>{targetProfile?.full_name || targetProfile?.email}</Text>

            <ScrollView style={{ maxHeight: 300, marginTop: 12 }}>
              <TouchableOpacity style={styles.optionRow} onPress={() => assignRole(null)} disabled={saving}>
                <Ionicons name="close-circle-outline" size={18} color="#64748b" style={{ marginRight: 10 }} />
                <Text style={styles.optionRowText}>Unassigned (no page access)</Text>
              </TouchableOpacity>
              {roles.map((role) => (
                <TouchableOpacity key={role.id} style={styles.optionRow} onPress={() => assignRole(role.id)} disabled={saving}>
                  <Ionicons name="key-outline" size={18} color={ACCENT_BLUE} style={{ marginRight: 10 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.optionRowText}>{role.name}</Text>
                    {!!role.description && <Text style={styles.optionRowSubtext}>{role.description}</Text>}
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setRoleModalVisible(false)}>
              <Text style={styles.modalCancelBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={areasModalVisible} transparent animationType="fade" onRequestClose={() => setAreasModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Assign Areas</Text>
            <Text style={styles.modalSubtitle} numberOfLines={1}>{targetProfile?.full_name || targetProfile?.email}</Text>
            <Text style={styles.hintText}>
              Checked areas (and everything nested under them) are the only members this account will see in the
              Directory. Leave none checked for unrestricted access.
            </Text>

            <ScrollView style={{ maxHeight: 320, marginTop: 8 }}>
              {areaTree.length === 0 && <Text style={styles.optionRowSubtext}>No areas created yet.</Text>}
              {areaTree.map((area) => {
                const assigned = new Set((userAreasByProfile[targetProfile?.id] || []).map((a) => a.areaId));
                const checked = assigned.has(area.id);
                return (
                  <TouchableOpacity
                    key={area.id}
                    style={[styles.checkboxRow, { marginLeft: area.depth * 16 }]}
                    onPress={() => toggleProfileArea(area.id)}
                  >
                    <Ionicons
                      name={checked ? 'checkbox' : 'square-outline'}
                      size={20}
                      color={checked ? ACCENT_BLUE : '#94a3b8'}
                      style={{ marginRight: 10 }}
                    />
                    <Text style={styles.optionRowText}>{area.name} <Text style={styles.subText}>({area.type})</Text></Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setAreasModalVisible(false)}>
              <Text style={styles.modalCancelBtnText}>Close</Text>
            </TouchableOpacity>
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

  colAccount: { flex: 2.2, minWidth: 160 },
  colRole: { flex: 1.1, minWidth: 100 },
  colAreas: { flex: 1.8, minWidth: 140 },
  colActions: { flex: 1.4, minWidth: 150 },

  narrowRow: { flexDirection: 'column', alignItems: 'stretch' },
  narrowMetaRow: { marginTop: 6 },

  mainText: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  subText: { fontSize: 11, color: '#64748b', marginTop: 2 },

  pillWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  actionsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  modalCard: { backgroundColor: '#ffffff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 420 },
  modalTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  modalSubtitle: { fontSize: 12, color: '#64748b', marginTop: 2 },
  hintText: { fontSize: 11, color: '#94a3b8', marginTop: 8, lineHeight: 16 },
  modalCancelBtn: { marginTop: 16, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, backgroundColor: '#f1f5f9', alignSelf: 'flex-end' },
  modalCancelBtnText: { fontSize: 13, fontWeight: '700', color: '#334155' },

  optionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 8, borderRadius: 8 },
  optionRowText: { fontSize: 13, color: '#1e293b', fontWeight: '600' },
  optionRowSubtext: { fontSize: 11, color: '#64748b', marginTop: 2 },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
});
