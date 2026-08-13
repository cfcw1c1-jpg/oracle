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
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import {
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
const WIDE_BREAKPOINT = 900;

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

// Dynamic roles, and which pages (see the `pages` registry) each one can
// see in the sidebar. The Admin role is a role like any other here — its
// page grants are just seeded narrower by default (see
// scripts/sql/add-admin-roles-and-areas.sql) — so it can be edited too;
// it just can't be deleted outright, or nobody could administer the portal.
export default function RolesAccess({ onAccessChanged }) {
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_BREAKPOINT;

  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState([]);
  const [pages, setPages] = useState([]);
  const [selectedRoleId, setSelectedRoleId] = useState(null);
  const [rolePageKeys, setRolePageKeys] = useState(new Set());
  const [loadingRolePages, setLoadingRolePages] = useState(false);

  const [addRoleModalVisible, setAddRoleModalVisible] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDescription, setNewRoleDescription] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    if (selectedRoleId != null) loadRolePages(selectedRoleId);
    else setRolePageKeys(new Set());
  }, [selectedRoleId]);

  async function loadAll() {
    try {
      setLoading(true);
      const [rolesRes, pagesRes] = await Promise.all([
        supabase.from('roles').select('*').order('name'),
        supabase.from('pages').select('*').order('sort_order'),
      ]);
      if (rolesRes.error) throw rolesRes.error;
      if (pagesRes.error) throw pagesRes.error;
      setRoles(rolesRes.data || []);
      setPages(pagesRes.data || []);
      setSelectedRoleId((prev) => prev ?? rolesRes.data?.[0]?.id ?? null);
    } catch (err) {
      showAlert('Error Loading Roles', err.message);
    } finally {
      setLoading(false);
    }
  }

  const selectedRole = roles.find((r) => r.id === selectedRoleId) || null;

  async function loadRolePages(roleId) {
    try {
      setLoadingRolePages(true);
      const { data, error } = await supabase.from('role_pages').select('page_key').eq('role_id', roleId);
      if (error) throw error;
      setRolePageKeys(new Set((data || []).map((r) => r.page_key)));
    } catch (err) {
      showAlert('Error Loading Page Access', err.message);
    } finally {
      setLoadingRolePages(false);
    }
  }

  async function togglePage(pageKey) {
    if (!selectedRole) return;
    const currentlyAllowed = rolePageKeys.has(pageKey);
    try {
      if (currentlyAllowed) {
        const { error } = await supabase
          .from('role_pages')
          .delete()
          .eq('role_id', selectedRole.id)
          .eq('page_key', pageKey);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('role_pages')
          .insert([{ role_id: selectedRole.id, page_key: pageKey }]);
        if (error) throw error;
      }
      setRolePageKeys((prev) => {
        const next = new Set(prev);
        if (currentlyAllowed) next.delete(pageKey);
        else next.add(pageKey);
        return next;
      });
      onAccessChanged?.();
    } catch (err) {
      showAlert('Error Updating Page Access', err.message);
    }
  }

  async function handleAddRole() {
    if (!newRoleName.trim()) {
      showAlert('Validation Error', 'Please enter a role name.');
      return;
    }
    try {
      setSaving(true);
      const { data, error } = await supabase
        .from('roles')
        .insert([{ name: newRoleName.trim(), description: newRoleDescription.trim() || null }])
        .select();
      if (error) throw error;
      setAddRoleModalVisible(false);
      setNewRoleName('');
      setNewRoleDescription('');
      await loadAll();
      if (data?.[0]) setSelectedRoleId(data[0].id);
    } catch (err) {
      showAlert('Error Creating Role', err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleDeleteRole(role) {
    if (role.name === 'Admin') {
      showAlert('Not Allowed', 'The Admin role cannot be deleted.');
      return;
    }
    confirmAction(
      'Delete Role',
      `Delete "${role.name}"? Portal users with this role will become Unassigned.`,
      async () => {
        try {
          const { error } = await supabase.from('roles').delete().eq('id', role.id);
          if (error) throw error;
          if (selectedRoleId === role.id) setSelectedRoleId(null);
          await loadAll();
          onAccessChanged?.();
        } catch (err) {
          showAlert('Error Deleting Role', err.message);
        }
      }
    );
  }

  function handleExportRoles() {
    const rows = roles.map((r) => ({ name: r.name, description: r.description || '' }));
    exportCsv('roles', [
      { key: 'name', label: 'Role' },
      { key: 'description', label: 'Description' },
    ], rows);
  }

  function handleExportPageAccess() {
    if (!selectedRole) return;
    const rows = pages.map((p) => ({ page: p.label, status: rolePageKeys.has(p.key) ? 'Granted' : 'Not Granted' }));
    exportCsv(`page-access-${selectedRole.name}`, [
      { key: 'page', label: 'Page' },
      { key: 'status', label: 'Status' },
    ], rows);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Ionicons name="key-outline" size={22} color="#0f172a" style={styles.titleIcon} />
          <Text style={styles.title}>Roles & Page Access</Text>
        </View>
        <Text style={styles.subtitle}>Create roles and choose exactly which pages each one can see.</Text>
      </View>

      <View style={[styles.splitPanel, isWide && styles.splitPanelWide]}>
        <View style={styles.splitColumn}>
          <TableCard
            style={styles.fillCard}
            title={`${roles.length} Role${roles.length === 1 ? '' : 's'}`}
            right={
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <ExportButton onPress={handleExportRoles} />
                <TouchableOpacity style={styles.headerActionBtn} onPress={() => setAddRoleModalVisible(true)}>
                  <Ionicons name="add-outline" size={14} color="#334155" style={{ marginRight: 4 }} />
                  <Text style={styles.headerActionBtnText}>Add Role</Text>
                </TouchableOpacity>
              </View>
            }
          >
            {loading ? (
              <ActivityIndicator size="large" color={NAVY} style={{ padding: 30 }} />
            ) : roles.length === 0 ? (
              <EmptyRow label="No roles yet." />
            ) : (
              <ScrollView style={styles.listScroll}>
                {roles.map((role, index) => {
                  const isSelected = role.id === selectedRoleId;
                  return (
                    <TableRow
                      key={role.id}
                      selected={isSelected}
                      last={index === roles.length - 1}
                      onPress={() => setSelectedRoleId(role.id)}
                    >
                      <IconBadge name="key-outline" size={30} />
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={styles.mainText} numberOfLines={1}>{role.name}</Text>
                        {!!role.description && (
                          <Text style={styles.subText} numberOfLines={2}>{role.description}</Text>
                        )}
                      </View>
                      {role.name !== 'Admin' && (
                        <TouchableOpacity
                          style={styles.deleteButton}
                          onPress={() => handleDeleteRole(role)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Ionicons name="trash-outline" size={16} color="#ef4444" />
                        </TouchableOpacity>
                      )}
                    </TableRow>
                  );
                })}
              </ScrollView>
            )}
          </TableCard>
        </View>

        <View style={styles.splitColumn}>
          <TableCard
            style={styles.fillCard}
            title={selectedRole ? `Page Access — ${selectedRole.name}` : 'Page Access'}
            right={selectedRole ? <ExportButton onPress={handleExportPageAccess} /> : null}
          >
            {loadingRolePages ? (
              <ActivityIndicator color={NAVY} style={{ padding: 30 }} />
            ) : !selectedRole ? (
              <EmptyRow label="Select or add a role to configure its page access." />
            ) : (
              <ScrollView style={styles.listScroll}>
                {pages.map((page, index) => {
                  const allowed = rolePageKeys.has(page.key);
                  return (
                    <TableRow key={page.key} onPress={() => togglePage(page.key)} last={index === pages.length - 1}>
                      <Ionicons
                        name={allowed ? 'checkbox' : 'square-outline'}
                        size={20}
                        color={allowed ? ACCENT_BLUE : '#94a3b8'}
                        style={{ marginRight: 10 }}
                      />
                      <Text style={[styles.mainText, { flex: 1 }]}>{page.label}</Text>
                      <Pill
                        label={allowed ? 'Granted' : 'Not Granted'}
                        color={allowed ? '#15803d' : '#64748b'}
                        bg={allowed ? '#dcfce7' : '#f1f5f9'}
                      />
                    </TableRow>
                  );
                })}
              </ScrollView>
            )}
          </TableCard>
        </View>
      </View>

      <Modal visible={addRoleModalVisible} transparent animationType="fade" onRequestClose={() => setAddRoleModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add Role</Text>
            <TextInput
              style={styles.textInput}
              placeholder="Role name (e.g. Area Head)"
              placeholderTextColor="#94a3b8"
              value={newRoleName}
              onChangeText={setNewRoleName}
            />
            <TextInput
              style={[styles.textInput, { marginTop: 10 }]}
              placeholder="Description (optional)"
              placeholderTextColor="#94a3b8"
              value={newRoleDescription}
              onChangeText={setNewRoleDescription}
            />
            <View style={styles.modalButtonRow}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setAddRoleModalVisible(false)}>
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleAddRole} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.modalSaveBtnText}>Create</Text>}
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

  splitPanel: { flex: 1, flexDirection: 'column', gap: 16, paddingHorizontal: 16, paddingBottom: 16 },
  // No alignItems override here -- the default 'stretch' is what lets both
  // columns' fillCard/listScroll flex:1 actually cap to the row's height
  // instead of growing to fit every page in the list, which is what made
  // the Page Access list uncappable/unscrollable before.
  splitPanelWide: { flexDirection: 'row' },
  splitColumn: { flex: 1 },
  fillCard: { flex: 1 },

  listScroll: { flex: 1 },

  headerActionBtn: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 10,
    borderRadius: 8, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0',
  },
  headerActionBtnText: { fontSize: 12, fontWeight: '700', color: '#334155' },

  mainText: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  subText: { fontSize: 11, color: '#64748b', marginTop: 2 },
  deleteButton: { padding: 6 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  modalCard: { backgroundColor: '#ffffff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 420 },
  modalTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  modalButtonRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
  modalCancelBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, backgroundColor: '#f1f5f9' },
  modalCancelBtnText: { fontSize: 13, fontWeight: '700', color: '#334155' },
  modalSaveBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, backgroundColor: NAVY, minWidth: 80, alignItems: 'center' },
  modalSaveBtnText: { fontSize: 13, fontWeight: '700', color: '#ffffff' },

  textInput: {
    borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 12,
    paddingVertical: 10, fontSize: 13, color: '#1e293b',
  },
});
