import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { formatPlatform, subscribeToPresence } from '../lib/presence';

const NAVY = '#002060';
const ACCENT_BLUE = '#2563eb';
const NARROW_BREAKPOINT = 720;
const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200];
const AREA_PILL_LIMIT = 2;

// Matches the Sector/Cluster/Chapter palette used on the Areas screen so a
// badge reads the same way in both places.
const AREA_TYPE_STYLES = {
  Sector: { color: '#7c3aed', bg: '#ede9fe' },
  Cluster: { color: '#2563eb', bg: '#dbeafe' },
  Chapter: { color: '#16a34a', bg: '#dcfce7' },
};

function formatLastLogin(iso) {
  if (!iso) return 'Never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function showAlert(title, message) {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
}

// A random 14-char password with at least one of each character class, for
// the "Generate" button on the Add User form -- Supabase Auth's own minimum
// is 6 characters, but a generated one may as well be strong by default.
function generatePassword() {
  const lowers = 'abcdefghijkmnopqrstuvwxyz';
  const uppers = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const symbols = '!@#$%&*';
  const all = lowers + uppers + digits + symbols;
  const pick = (pool) => pool[Math.floor(Math.random() * pool.length)];
  const chars = [pick(lowers), pick(uppers), pick(digits), pick(symbols)];
  while (chars.length < 14) chars.push(pick(all));
  // Shuffle so the guaranteed classes aren't always in the same position.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
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

  const [addUserModalVisible, setAddUserModalVisible] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserFullName, setNewUserFullName] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserShowPassword, setNewUserShowPassword] = useState(false);
  const [newUserRoleId, setNewUserRoleId] = useState(null);
  const [creatingUser, setCreatingUser] = useState(false);

  const [onlineByProfile, setOnlineByProfile] = useState({});
  const [lastSignInByProfile, setLastSignInByProfile] = useState({});
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  useEffect(() => {
    loadAll();
  }, []);

  // Live "who's online right now" -- src/app/index.js tracks every signed-in
  // session onto the shared presence channel (profile_id + platform), this
  // just reads it. Keyed by profile_id, last-tracked entry wins if the same
  // account somehow has more than one open session.
  useEffect(() => {
    return subscribeToPresence((entries) => {
      const map = {};
      entries.forEach((e) => { map[e.profile_id] = e; });
      setOnlineByProfile(map);
    });
  }, []);

  async function loadAll() {
    try {
      setLoading(true);
      const [profilesRes, rolesRes, areasRes, userAreasRes, lastSignInRes] = await Promise.all([
        supabase.from('profiles').select('id, email, full_name, avatar_url, role_id, roles ( name )').order('email'),
        supabase.from('roles').select('*').order('name'),
        supabase.from('areas').select('id, name, type, parent_id').order('name'),
        supabase.from('user_areas').select('profile_id, area_id, areas ( name, type )'),
        // auth.users.last_sign_in_at isn't queryable from the client directly
        // -- see scripts/sql/add-portal-users-last-sign-in.sql. Fails soft
        // (empty column) rather than blocking the rest of the page if that
        // migration hasn't been run yet.
        supabase.rpc('get_portal_users_last_sign_in'),
      ]);
      if (profilesRes.error) throw profilesRes.error;
      if (rolesRes.error) throw rolesRes.error;
      if (areasRes.error) throw areasRes.error;
      if (userAreasRes.error) throw userAreasRes.error;
      if (lastSignInRes.error) console.warn('Error loading last sign-in times:', lastSignInRes.error.message);

      const grouped = {};
      (userAreasRes.data || []).forEach((row) => {
        if (!grouped[row.profile_id]) grouped[row.profile_id] = [];
        grouped[row.profile_id].push({ areaId: row.area_id, name: row.areas?.name, type: row.areas?.type });
      });

      const lastSignIn = {};
      (lastSignInRes.data || []).forEach((row) => { lastSignIn[row.profile_id] = row.last_sign_in_at; });

      setProfiles(profilesRes.data || []);
      setRoles(rolesRes.data || []);
      setAreas(areasRes.data || []);
      setUserAreasByProfile(grouped);
      setLastSignInByProfile(lastSignIn);
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

  function openAddUserModal() {
    setNewUserEmail('');
    setNewUserFullName('');
    setNewUserPassword(generatePassword());
    setNewUserShowPassword(true);
    setNewUserRoleId(null);
    setAddUserModalVisible(true);
  }

  function closeAddUserModal() {
    if (creatingUser) return;
    setAddUserModalVisible(false);
  }

  // The actual account creation runs server-side (see
  // supabase/functions/create-portal-user) since it needs the service_role
  // key to call the Auth admin API -- something that must never live in
  // this client bundle. This client only ever calls the Edge Function with
  // the signed-in admin's own JWT, which the function re-verifies itself.
  async function handleCreateUser() {
    const email = newUserEmail.trim();
    const password = newUserPassword;
    if (!email) {
      showAlert('Missing Email', 'Enter an email address for the new account.');
      return;
    }
    if (password.length < 6) {
      showAlert('Weak Password', 'Password must be at least 6 characters.');
      return;
    }

    setCreatingUser(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-portal-user', {
        body: { email, password, full_name: newUserFullName.trim() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      if (newUserRoleId) {
        const { error: roleError } = await supabase
          .from('profiles')
          .update({ role_id: newUserRoleId })
          .eq('id', data.id);
        if (roleError) throw roleError;
      }

      setAddUserModalVisible(false);
      await loadAll();
      onAccessChanged?.();
      showAlert(
        'Account Created',
        `${email} can now sign in with the password you set. Share it with them directly -- it won't be shown again here. Assign Areas from the table if needed.`
      );
    } catch (err) {
      showAlert('Error Creating Account', err.message);
    } finally {
      setCreatingUser(false);
    }
  }

  function openAreasModal(profile) {
    setTargetProfile(profile);
    setAreasModalVisible(true);
  }

  // Checking a parent Area already grants visibility into everything nested
  // under it (visible_area_ids() walks the tree recursively server-side) --
  // cascade the checkbox the same way, so checking "West 1" also shows its
  // Clusters/Chapters as checked instead of looking only half-applied.
  // Unchecking cascades the same way in reverse.
  function getDescendantAreaIds(areaId) {
    const children = areas.filter((a) => a.parent_id === areaId);
    return children.flatMap((c) => [c.id, ...getDescendantAreaIds(c.id)]);
  }

  async function toggleProfileArea(areaId) {
    if (!targetProfile) return;
    const assigned = new Set((userAreasByProfile[targetProfile.id] || []).map((a) => a.areaId));
    const idsToChange = [areaId, ...getDescendantAreaIds(areaId)];
    try {
      if (assigned.has(areaId)) {
        const { error } = await supabase
          .from('user_areas')
          .delete()
          .eq('profile_id', targetProfile.id)
          .in('area_id', idsToChange);
        if (error) throw error;
      } else {
        const idsToInsert = idsToChange.filter((id) => !assigned.has(id));
        const { error } = await supabase
          .from('user_areas')
          .insert(idsToInsert.map((area_id) => ({ profile_id: targetProfile.id, area_id })));
        if (error) throw error;
      }
      await loadAll();
    } catch (err) {
      showAlert('Error Updating Area Access', err.message);
    }
  }

  const areaTree = buildAreaTree(areas);
  const { page, pageCount, pageItems, setPage } = usePagination(profiles, pageSize);

  function handlePageSizeChange(size) {
    setPageSize(size);
    setPage(1);
  }

  function handleExport() {
    const rows = profiles.map((p) => ({
      name: p.full_name || '',
      email: p.email || '',
      role: p.roles?.name || 'Unassigned',
      areas: (userAreasByProfile[p.id] || []).map((a) => a.name).join('; ') || 'All Areas',
      lastLogin: onlineByProfile[p.id] ? 'Online now' : formatLastLogin(lastSignInByProfile[p.id]),
    }));
    exportCsv('portal-users', [
      { key: 'name', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'role', label: 'Role' },
      { key: 'areas', label: 'Areas' },
      { key: 'lastLogin', label: 'Last Login' },
    ], rows);
  }

  const onlineCount = Object.keys(onlineByProfile).length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Ionicons name="people-circle-outline" size={22} color="#0f172a" style={styles.titleIcon} />
          <Text style={styles.title}>Portal Users</Text>
          {onlineCount > 0 && (
            <View style={styles.onlinePill}>
              <View style={styles.onlinePillDot} />
              <Text style={styles.onlinePillText}>{onlineCount} online now</Text>
            </View>
          )}
        </View>
        <Text style={styles.subtitle}>Every account that has signed in, its role, and the areas it can view.</Text>
      </View>

      <View style={styles.body}>
        <TableCard
          style={styles.fillCard}
          title={`${profiles.length} Account${profiles.length === 1 ? '' : 's'}`}
          right={
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <ExportButton onPress={handleExport} />
              <TouchableOpacity style={styles.addUserBtn} onPress={openAddUserModal}>
                <Ionicons name="person-add-outline" size={14} color="#ffffff" style={{ marginRight: 4 }} />
                <Text style={styles.addUserBtnText}>Add User</Text>
              </TouchableOpacity>
            </View>
          }
        >
          {!isNarrow && (
            <TableHeaderRow
              columns={[
                { key: 'account', label: 'Account', style: styles.colAccount },
                { key: 'role', label: 'Role', style: styles.colRole },
                { key: 'areas', label: 'Areas', style: styles.colAreas },
                { key: 'lastLogin', label: 'Last Login', style: styles.colLastLogin },
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
              const presence = onlineByProfile[item.id];

              const avatar = (
                <View style={styles.avatarWrap}>
                  <InitialsBadge text={initials} imageUri={item.avatar_url} />
                  {!!presence && <View style={styles.onlineDot} />}
                </View>
              );

              const rolePill = item.roles
                ? <Pill label={item.roles.name} color="#1d4ed8" bg="#dbeafe" />
                : <Pill label="Unassigned" color="#64748b" bg="#f1f5f9" />;

              // Capped to keep every row a fixed height -- an account scoped
              // to a handful of Clusters/Chapters used to wrap into a wall
              // of pills here. Tapping the cell (same as the "Areas" action
              // link) opens the full list in the Assign Areas modal.
              const visibleAreas = assignedAreas.slice(0, AREA_PILL_LIMIT);
              const hiddenAreaCount = assignedAreas.length - visibleAreas.length;
              const areaPills = assignedAreas.length === 0
                ? <Pill label="All Areas" color="#64748b" bg="#f1f5f9" />
                : (
                  <TouchableOpacity style={styles.pillWrap} onPress={() => openAreasModal(item)} activeOpacity={0.6}>
                    {visibleAreas.map((a) => (
                      <Pill key={a.areaId} label={a.name} color={AREA_TYPE_STYLES[a.type]?.color} bg={AREA_TYPE_STYLES[a.type]?.bg} />
                    ))}
                    {hiddenAreaCount > 0 && <Pill label={`+${hiddenAreaCount} more`} color="#64748b" bg="#f1f5f9" />}
                  </TouchableOpacity>
                );

              const actions = (
                <View style={styles.actionsWrap}>
                  <ActionLink label="Areas" icon="git-network-outline" onPress={() => openAreasModal(item)} />
                  <ActionLink label="Change Role" icon="create-outline" onPress={() => openRoleModal(item)} />
                </View>
              );

              // Presence (live) wins over the last recorded sign-in when an
              // account is online right now -- otherwise this is whenever
              // auth.users.last_sign_in_at last updated (see
              // scripts/sql/add-portal-users-last-sign-in.sql).
              const lastLoginLabel = presence ? 'Online now' : formatLastLogin(lastSignInByProfile[item.id]);
              const lastLoginText = (
                <Text style={[styles.plainCellText, presence && styles.onlineText]} numberOfLines={1}>{lastLoginLabel}</Text>
              );

              if (isNarrow) {
                return (
                  <TableRow key={item.id} last={isLast} style={styles.narrowRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%' }}>
                      {avatar}
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={styles.mainText} numberOfLines={1}>{item.full_name || item.email || item.id}</Text>
                        {!!item.full_name && <Text style={styles.subText} numberOfLines={1}>{item.email}</Text>}
                        {!!presence && <Text style={styles.deviceText} numberOfLines={1}>Online · {formatPlatform(presence.platform)}</Text>}
                      </View>
                    </View>
                    <View style={styles.narrowMetaRow}>{rolePill}</View>
                    <View style={styles.narrowMetaRow}>{areaPills}</View>
                    <View style={styles.narrowMetaRow}>{lastLoginText}</View>
                    <View style={[styles.narrowMetaRow, { marginTop: 8 }]}>{actions}</View>
                  </TableRow>
                );
              }

              return (
                <TableRow key={item.id} last={isLast}>
                  <View style={[styles.colAccount, { flexDirection: 'row', alignItems: 'center' }]}>
                    {avatar}
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={styles.mainText} numberOfLines={1}>{item.full_name || item.email || item.id}</Text>
                      {!!item.full_name && <Text style={styles.subText} numberOfLines={1}>{item.email}</Text>}
                      {!!presence && <Text style={styles.deviceText} numberOfLines={1}>Online · {formatPlatform(presence.platform)}</Text>}
                    </View>
                  </View>
                  <View style={styles.colRole}>{rolePill}</View>
                  <View style={styles.colAreas}>{areaPills}</View>
                  <View style={styles.colLastLogin}>{lastLoginText}</View>
                  <View style={styles.colActions}>{actions}</View>
                </TableRow>
              );
            })}
            </ScrollView>
          )}

          <TablePagination
            page={page}
            pageCount={pageCount}
            totalCount={profiles.length}
            pageSize={pageSize}
            onChange={setPage}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageSizeChange={handlePageSizeChange}
          />
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

      <Modal visible={addUserModalVisible} transparent animationType="fade" onRequestClose={closeAddUserModal}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add User</Text>
            <Text style={styles.hintText}>
              Creates a real sign-in account directly -- share the password with them yourself, it is not emailed.
            </Text>

            <ScrollView style={{ maxHeight: 420, marginTop: 8 }}>
              <Text style={styles.fieldLabel}>Email *</Text>
              <TextInput
                style={styles.textInput}
                placeholder="name@example.com"
                placeholderTextColor="#94a3b8"
                value={newUserEmail}
                onChangeText={setNewUserEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                editable={!creatingUser}
              />

              <Text style={styles.fieldLabel}>Full Name</Text>
              <TextInput
                style={styles.textInput}
                placeholder="Optional"
                placeholderTextColor="#94a3b8"
                value={newUserFullName}
                onChangeText={setNewUserFullName}
                editable={!creatingUser}
              />

              <Text style={styles.fieldLabel}>Password *</Text>
              <View style={styles.passwordRow}>
                <TextInput
                  style={[styles.textInput, styles.passwordInput]}
                  value={newUserPassword}
                  onChangeText={setNewUserPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry={!newUserShowPassword}
                  editable={!creatingUser}
                />
                <TouchableOpacity
                  style={styles.passwordIconBtn}
                  onPress={() => setNewUserShowPassword((v) => !v)}
                  disabled={creatingUser}
                >
                  <Ionicons name={newUserShowPassword ? 'eye-off-outline' : 'eye-outline'} size={16} color="#64748b" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.passwordIconBtn}
                  onPress={() => { setNewUserPassword(generatePassword()); setNewUserShowPassword(true); }}
                  disabled={creatingUser}
                >
                  <Ionicons name="refresh-outline" size={16} color="#64748b" />
                </TouchableOpacity>
              </View>
              <Text style={styles.optionRowSubtext}>At least 6 characters. A strong one is pre-filled -- tap refresh for another.</Text>

              <Text style={styles.fieldLabel}>Role (optional)</Text>
              <View style={{ borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, maxHeight: 160 }}>
                <ScrollView>
                  <TouchableOpacity
                    style={[styles.optionRow, newUserRoleId === null && styles.optionRowActive]}
                    onPress={() => setNewUserRoleId(null)}
                    disabled={creatingUser}
                  >
                    <Text style={styles.optionRowText}>Unassigned (no page access)</Text>
                  </TouchableOpacity>
                  {roles.map((role) => (
                    <TouchableOpacity
                      key={role.id}
                      style={[styles.optionRow, newUserRoleId === role.id && styles.optionRowActive]}
                      onPress={() => setNewUserRoleId(role.id)}
                      disabled={creatingUser}
                    >
                      <Text style={styles.optionRowText}>{role.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </ScrollView>

            <View style={styles.modalButtonRow}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={closeAddUserModal} disabled={creatingUser}>
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleCreateUser} disabled={creatingUser}>
                {creatingUser ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.modalSaveBtnText}>Create</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
        </KeyboardAvoidingView>
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

  onlinePill: {
    flexDirection: 'row', alignItems: 'center', marginLeft: 10,
    paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20, backgroundColor: '#dcfce7',
  },
  onlinePillDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#16a34a', marginRight: 5 },
  onlinePillText: { fontSize: 11, fontWeight: '700', color: '#15803d' },

  body: { flex: 1, paddingHorizontal: 16, paddingBottom: 16 },
  fillCard: { flex: 1 },
  rowsScroll: { flex: 1 },

  colAccount: { flex: 2.2, minWidth: 160 },
  colRole: { flex: 1.1, minWidth: 100 },
  colAreas: { flex: 1.8, minWidth: 140 },
  colLastLogin: { flex: 1.5, minWidth: 140 },
  colActions: { flex: 1.4, minWidth: 150 },

  narrowRow: { flexDirection: 'column', alignItems: 'stretch' },
  narrowMetaRow: { marginTop: 6 },

  mainText: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  subText: { fontSize: 11, color: '#64748b', marginTop: 2 },
  deviceText: { fontSize: 11, color: '#16a34a', fontWeight: '600', marginTop: 2 },
  plainCellText: { fontSize: 12, color: '#475569', fontWeight: '500' },
  onlineText: { color: '#16a34a', fontWeight: '700' },

  avatarWrap: { position: 'relative' },
  onlineDot: {
    position: 'absolute', bottom: -1, right: -1, width: 11, height: 11, borderRadius: 6,
    backgroundColor: '#16a34a', borderWidth: 2, borderColor: '#ffffff',
  },

  pillWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  actionsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  modalCard: { backgroundColor: '#ffffff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 420 },
  modalTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  modalSubtitle: { fontSize: 12, color: '#64748b', marginTop: 2 },
  hintText: { fontSize: 11, color: '#94a3b8', marginTop: 8, lineHeight: 16 },
  modalCancelBtn: { marginTop: 16, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, backgroundColor: '#f1f5f9', alignSelf: 'flex-end' },
  modalCancelBtnText: { fontSize: 13, fontWeight: '700', color: '#334155' },
  modalButtonRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
  modalSaveBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, backgroundColor: NAVY, minWidth: 80, alignItems: 'center' },
  modalSaveBtnText: { fontSize: 13, fontWeight: '700', color: '#ffffff' },

  optionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 8, borderRadius: 8 },
  optionRowActive: { backgroundColor: '#eff6ff' },
  optionRowText: { fontSize: 13, color: '#1e293b', fontWeight: '600' },
  optionRowSubtext: { fontSize: 11, color: '#64748b', marginTop: 2 },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },

  addUserBtn: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 10,
    borderRadius: 8, backgroundColor: NAVY,
  },
  addUserBtnText: { fontSize: 12, fontWeight: '700', color: '#ffffff' },

  fieldLabel: { fontSize: 11, fontWeight: '700', color: '#64748b', marginTop: 14, marginBottom: 6, textTransform: 'uppercase' },
  textInput: {
    borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 12,
    paddingVertical: 10, fontSize: 13, color: '#1e293b',
  },
  passwordRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  passwordInput: { flex: 1 },
  passwordIconBtn: {
    width: 36, height: 36, borderRadius: 8, borderWidth: 1, borderColor: '#e2e8f0',
    alignItems: 'center', justifyContent: 'center',
  },
});
