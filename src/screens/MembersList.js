import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
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
import { TablePagination, usePagination } from '../components/admin-table';
import { parseTrainingName, TRAINING_COLUMNS } from './PfoList';

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200];

// Checkbox/Gender stay a fixed width (their content is compact and
// fixed-size); Name/Household/Role grow to fill the row on wide screens but
// won't shrink below their minWidth, so the table scrolls horizontally instead
// of squeezing text on narrow ones.
const CHECKBOX_COL = { width: 44 };
const NAME_COL = { flexGrow: 2.2, flexShrink: 1, flexBasis: 0, minWidth: 200 };
const HOUSEHOLD_COL = { flexGrow: 1.6, flexShrink: 1, flexBasis: 0, minWidth: 160 };
const GENDER_COL = { width: 120 };
const STATUS_COL = { width: 130 };
const ROLE_COL = { flexGrow: 1.8, flexShrink: 1, flexBasis: 0, minWidth: 180 };
const ACTIONS_COL = { width: 60 };
const TABLE_MIN_WIDTH = 44 + 200 + 160 + 120 + 130 + 180 + 60;

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

const ROLE_OPTION_CODES = Object.keys(ROLE_LABELS);

// A member without a Status yet is treated as Active (matches the
// dashboard's "Total Active Members" count, which predates this column).
const STATUS_OPTIONS = ['Active', 'Inactive', 'Deceased', 'SOLD', 'HANDMAID'];

function getStatusLabel(status) {
  return status || 'Active';
}

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
    YearRegistered: m.YearRegistered != null ? String(m.YearRegistered) : '',
  };
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

// A plain text input that also offers a dropdown of existing values matching
// what's typed so far -- picking one just fills the field, it never
// restricts what can actually be saved. Same component ManageMembers.js
// uses for its Area/Household Head fields.
function AutocompleteField({ label, value, onChangeText, suggestions, placeholder }) {
  const [focused, setFocused] = useState(false);

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    const pool = q
      ? suggestions.filter((s) => s.toLowerCase().includes(q) && s.toLowerCase() !== q)
      : suggestions;
    return pool.slice(0, 8);
  }, [value, suggestions]);

  return (
    // Boosting zIndex only while open/focused -- otherwise a sibling field
    // later in the same row (Status, Pastoral Service, ...) paints over this
    // one's dropdown regardless of the shared row-level zIndex, since paint
    // order within a stacking context follows DOM order, not row zIndex.
    <View style={[styles.fieldWrap, focused && { zIndex: 50 }]}>
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
                <Text style={styles.suggestionText}>{s}</Text>
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
    // Same per-field zIndex boost as AutocompleteField -- without it, an open
    // Status dropdown gets painted over by the Pastoral Service field next
    // to it in the same row.
    <View style={[styles.fieldWrap, open && { zIndex: 50 }]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TouchableOpacity style={styles.selectButton} onPress={() => setOpen((o) => !o)}>
        <Text style={value ? styles.selectValueText : styles.selectPlaceholderText}>
          {value ? getLabel(value) : placeholder}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color="#64748b" />
      </TouchableOpacity>
      {open && (
        <View style={styles.suggestionBox}>
          <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled>
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
          </ScrollView>
        </View>
      )}
    </View>
  );
}

// Admins/Moderators keep writing to `members` directly from this screen, as
// before. Any other role's edits here are queued in member_change_requests
// for one of them to review on the Change Requests page instead -- see
// scripts/sql/add-member-change-requests.sql.
const APPROVER_ROLES = new Set(['Admin', 'Moderator']);

export default function MembersList({ roleName }) {
  const canApproveChanges = APPROVER_ROLES.has(roleName);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [updatingId, setUpdatingId] = useState(null); // Tracks network load per row toggle
  const [assignedAreaNames, setAssignedAreaNames] = useState([]);

  const [genderFilter, setGenderFilter] = useState('All');
  const [roleFilter, setRoleFilter] = useState('All');
  const [areaFilter, setAreaFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [sortAsc, setSortAsc] = useState(true);
  const [pageSize, setPageSize] = useState(20);

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [roleMenuOpenFor, setRoleMenuOpenFor] = useState(null);
  const [changingRoleId, setChangingRoleId] = useState(null);
  const [statusMenuOpenFor, setStatusMenuOpenFor] = useState(null);
  const [changingStatusId, setChangingStatusId] = useState(null);

  // --- Edit Member Modal state ---
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [editOriginal, setEditOriginal] = useState(null); // Snapshot at open time, diffed against on save
  const [savingEdit, setSavingEdit] = useState(false);

  // FlatList renders each row in its own cell wrapper, so a zIndex set on our
  // row's own View never wins against sibling rows below it (they belong to
  // separate stacking contexts). CellRendererComponent lets us raise the
  // zIndex on that outer per-row wrapper instead, so the open row's dropdown
  // can actually paint above the rows underneath it.
  const RoleMenuAwareRow = useCallback(({ item, style, children, ...rest }) => {
    const isOpen = item && (roleMenuOpenFor === item.MemberIDNo || statusMenuOpenFor === item.MemberIDNo);
    return (
      <View style={[style, isOpen && { zIndex: 50 }]} {...rest}>
        {children}
      </View>
    );
  }, [roleMenuOpenFor, statusMenuOpenFor]);

  // --- Assign Talks Modal state ---
  const [assignModalVisible, setAssignModalVisible] = useState(false);
  const [stagedMemberIds, setStagedMemberIds] = useState(new Set());
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [talkSearchQuery, setTalkSearchQuery] = useState('');
  const [stagedTalkIds, setStagedTalkIds] = useState(new Set());
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    fetchMembers();
    loadAssignedAreas();
  }, []);

  const showAlert = (title, message) => {
    if (Platform.OS === 'web') {
      window.alert(`${title}\n\n${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  // The single write path every edit on this screen goes through. Approvers
  // apply the change immediately, same as before this feature existed. Any
  // other role gets the change queued instead -- local `members` state is
  // deliberately left untouched in that branch, since nothing has actually
  // happened to the record yet.
  async function applyOrQueueChange(memberId, changes, previousValues) {
    if (canApproveChanges) {
      const { error } = await supabase.from('members').update(changes).eq('MemberIDNo', memberId);
      if (error) throw error;
      setMembers((prev) => prev.map((m) => (m.MemberIDNo === memberId ? { ...m, ...changes } : m)));
      return false;
    }

    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('member_change_requests').insert([{
      member_id: memberId,
      requested_by: user?.id || null,
      requested_by_email: user?.email || null,
      changes,
      previous_values: previousValues,
    }]);
    if (error) throw error;
    return true;
  }

  // Areas explicitly assigned to the signed-in account (Portal Users ->
  // Areas). When any are assigned, the Area filter is narrowed to just
  // those (matches what area-scoping RLS already limits this account's
  // members to) instead of every AreaName scraped off the members table.
  // Unassigned/unrestricted accounts keep the full scraped list.
  async function loadAssignedAreas() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from('user_areas')
        .select('areas ( name )')
        .eq('profile_id', user.id);
      if (error) throw error;
      const names = (data || []).map((row) => row.areas?.name).filter(Boolean);
      setAssignedAreaNames(names);
    } catch (err) {
      console.error('Error loading assigned areas:', err.message);
    }
  }

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
      const queued = await applyOrQueueChange(memberId, { Gender: targetGender }, { Gender: currentGender });
      if (queued) showAlert('Submitted for Approval', 'This Gender change has been sent to an Admin/Moderator for review.');
    } catch (error) {
      const msg = `Failed updating gender status profile: ${error.message}`;
      Platform.OS === 'web' ? window.alert(msg) : Alert.alert('Database Exception', msg);
    } finally {
      setUpdatingId(null);
    }
  }

  // Handle Role updates to Supabase
  async function handleChangeRole(memberId, currentRole, targetRoleCode) {
    setRoleMenuOpenFor(null);
    if ((currentRole || '').trim().toUpperCase() === targetRoleCode) return; // No change

    try {
      setChangingRoleId(memberId);
      const queued = await applyOrQueueChange(memberId, { PastoralService: targetRoleCode }, { PastoralService: currentRole });
      if (queued) showAlert('Submitted for Approval', 'This Role change has been sent to an Admin/Moderator for review.');
    } catch (error) {
      showAlert('Database Exception', `Failed updating role: ${error.message}`);
    } finally {
      setChangingRoleId(null);
    }
  }

  // Handle Status updates to Supabase (Active / Inactive / Deceased / SOLD / HANDMAID)
  async function handleChangeStatus(memberId, currentStatus, targetStatus) {
    setStatusMenuOpenFor(null);
    if (getStatusLabel(currentStatus) === targetStatus) return; // No change

    try {
      setChangingStatusId(memberId);
      const queued = await applyOrQueueChange(memberId, { Status: targetStatus }, { Status: currentStatus });
      if (queued) showAlert('Submitted for Approval', 'This Status change has been sent to an Admin/Moderator for review.');
    } catch (error) {
      showAlert('Database Exception', `Failed updating status: ${error.message}`);
    } finally {
      setChangingStatusId(null);
    }
  }

  // --- Edit Member Modal handlers ---

  function openEditModal(member) {
    setEditForm(formFromMember(member));
    setEditOriginal(member);
    setEditModalVisible(true);
  }

  function closeEditModal() {
    if (savingEdit) return;
    setEditModalVisible(false);
  }

  function setEditField(key, value) {
    setEditForm((prev) => ({ ...prev, [key]: value }));
  }

  const canSaveEdit = !!(editForm && editForm.Lastname.trim() && editForm.Firstname.trim() && !savingEdit);

  async function handleSaveEdit() {
    if (!editForm) return;
    const lastname = editForm.Lastname.trim();
    const firstname = editForm.Firstname.trim();
    if (!lastname || !firstname) {
      showAlert('Missing Information', 'Last Name and First Name are required.');
      return;
    }

    const yearText = editForm.YearRegistered.trim();
    const yearRegistered = yearText ? Number(yearText) : null;
    if (yearText && !Number.isInteger(yearRegistered)) {
      showAlert('Invalid Year', 'Year Registered must be a whole number, e.g. 2024.');
      return;
    }

    setSavingEdit(true);
    try {
      const payload = {
        Lastname: lastname,
        Firstname: firstname,
        Gender: editForm.Gender || null,
        Status: editForm.Status || 'Active',
        AreaName: editForm.AreaName.trim() || null,
        NameOfHouseholdHead: editForm.NameOfHouseholdHead.trim() || null,
        PastoralService: editForm.PastoralService || null,
        YearRegistered: yearRegistered,
      };

      // Only the fields that actually changed go into the request -- both so
      // an approver reviews a clean diff instead of every field re-stated,
      // and so a save with no real changes is just a no-op close.
      const changes = {};
      const previousValues = {};
      Object.keys(payload).forEach((key) => {
        const oldVal = editOriginal ? (editOriginal[key] ?? null) : null;
        const newVal = payload[key];
        if ((oldVal === '' ? null : oldVal) !== (newVal === '' ? null : newVal)) {
          changes[key] = newVal;
          previousValues[key] = oldVal;
        }
      });

      if (Object.keys(changes).length === 0) {
        setEditModalVisible(false);
        return;
      }

      const queued = await applyOrQueueChange(editForm.MemberIDNo, changes, previousValues);
      setEditModalVisible(false);
      if (queued) {
        showAlert('Submitted for Approval', `${Object.keys(changes).length} field(s) sent to an Admin/Moderator for review.`);
      }
    } catch (err) {
      showAlert('Save Failed', err.message);
    } finally {
      setSavingEdit(false);
    }
  }

  // Existing Area/Household Head values across the directory, offered as
  // autocomplete suggestions in the edit form (same convention as
  // ManageMembers.js) -- the fields themselves stay free text.
  const { areaSuggestions, householdSuggestions } = useMemo(() => {
    const areas = new Set();
    const heads = new Set();
    members.forEach((m) => {
      if (m.AreaName?.trim()) areas.add(m.AreaName.trim());
      if (m.NameOfHouseholdHead?.trim()) heads.add(m.NameOfHouseholdHead.trim());
    });
    return {
      areaSuggestions: Array.from(areas).sort(),
      householdSuggestions: Array.from(heads).sort(),
    };
  }, [members]);

  const roleOptions = useMemo(() => {
    const values = new Set(members.map((m) => (m.PastoralService || 'MEMBER').trim()));
    return ['All', ...Array.from(values).sort()];
  }, [members]);

  const areaOptions = useMemo(() => {
    if (assignedAreaNames.length > 0) {
      return ['All', ...Array.from(new Set(assignedAreaNames)).sort()];
    }
    const values = new Set(members.map((m) => (m.AreaName || 'No Area').trim()));
    return ['All', ...Array.from(values).sort()];
  }, [members, assignedAreaNames]);

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
      // Prefix match (same convention as the Areas screen's member count and
      // the area-scoping RLS) so an Area named "West 1C2" also covers
      // AreaName variants like "West 1C2B"/"West 1C2D".
      const memberAreaName = (member.AreaName || '').trim();
      const matchesArea = areaFilter === 'All'
        || (areaFilter === 'No Area' ? !memberAreaName : memberAreaName.toLowerCase().startsWith(areaFilter.trim().toLowerCase()));
      const matchesStatus = statusFilter === 'All' || getStatusLabel(member.Status) === statusFilter;
      return matchesSearch && matchesGender && matchesRole && matchesArea && matchesStatus;
    });

    return result.sort((a, b) => {
      const cmp = (a.Lastname || '').localeCompare(b.Lastname || '');
      return sortAsc ? cmp : -cmp;
    });
  }, [searchQuery, members, genderFilter, roleFilter, areaFilter, statusFilter, sortAsc]);

  const { page, pageCount, pageItems, setPage } = usePagination(filteredMembers, pageSize);

  function handleChangePageSize(size) {
    setPageSize(size);
    setPage(1);
  }

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

  // --- Assign Talks Modal handlers ---

  function openAssignModal() {
    setStagedMemberIds(new Set(selectedIds));
    setStagedTalkIds(new Set());
    setMemberSearchQuery('');
    setTalkSearchQuery('');
    setAssignModalVisible(true);
  }

  function closeAssignModal() {
    setAssignModalVisible(false);
  }

  function toggleStagedMember(memberId) {
    setStagedMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }

  function toggleStagedTalk(talkId) {
    setStagedTalkIds((prev) => {
      const next = new Set(prev);
      if (next.has(talkId)) next.delete(talkId);
      else next.add(talkId);
      return next;
    });
  }

  const memberChecklistOptions = useMemo(() => {
    const cleanQuery = memberSearchQuery.trim().toLowerCase();
    if (!cleanQuery) return members;

    return members.filter((m) => {
      const first = m.Firstname?.toLowerCase() || '';
      const last = m.Lastname?.toLowerCase() || '';
      const idStr = m.MemberIDNo?.toString().toLowerCase() || '';
      return first.includes(cleanQuery) || last.includes(cleanQuery) || idStr.includes(cleanQuery);
    });
  }, [memberSearchQuery, members]);

  const filteredTalks = useMemo(() => {
    const cleanQuery = talkSearchQuery.trim().toLowerCase();
    if (!cleanQuery) return TRAINING_COLUMNS;

    return TRAINING_COLUMNS.filter((t) => {
      const labelMatch = t.label?.toLowerCase().includes(cleanQuery);
      const groupMatch = t.group?.toLowerCase().includes(cleanQuery);
      return labelMatch || groupMatch;
    });
  }, [talkSearchQuery]);

  async function handleAssignTalks() {
    if (stagedMemberIds.size === 0 || stagedTalkIds.size === 0) return;

    try {
      setAssigning(true);

      const talkIds = Array.from(stagedTalkIds);
      const memberIds = Array.from(stagedMemberIds);
      // Column names contain spaces/colons/hyphens, so they must be quoted
      // for PostgREST -- same convention PfoReports.js already uses.
      const quotedTalkColumns = talkIds.map((id) => `"${id}"`).join(', ');

      // Fetch each staged member's CURRENT value for every selected talk.
      // A member who already has a talk marked "Y" is left completely
      // untouched for that talk; only members who haven't taken it yet
      // (blank or "N") get flipped to "Y".
      const { data: existingRows, error: lookupError } = await supabase
        .from('pfo_members')
        .select(`MemberIDNo, ${quotedTalkColumns}`)
        .in('MemberIDNo', memberIds);
      if (lookupError) throw lookupError;

      const existingById = new Map((existingRows || []).map((row) => [row.MemberIDNo, row]));

      const insertRows = [];
      const updates = [];
      let newlySetCount = 0;
      let alreadyMarkedCount = 0;

      memberIds.forEach((memberId) => {
        const existingRow = existingById.get(memberId);

        if (!existingRow) {
          // No pfo_members row yet -- create one with every selected talk marked.
          const payload = { MemberIDNo: memberId };
          talkIds.forEach((id) => { payload[id] = 'Y'; });
          insertRows.push(payload);
          newlySetCount += talkIds.length;
          return;
        }

        // Only touch talks this member hasn't already taken.
        const payload = {};
        talkIds.forEach((id) => {
          const current = existingRow[id];
          if (current === 'Y' || current === 'y') {
            alreadyMarkedCount += 1;
          } else {
            payload[id] = 'Y';
            newlySetCount += 1;
          }
        });

        if (Object.keys(payload).length > 0) {
          updates.push({ memberId, payload });
        }
      });

      if (insertRows.length > 0) {
        const { error: insertError } = await supabase.from('pfo_members').insert(insertRows);
        if (insertError) throw insertError;
      }

      if (updates.length > 0) {
        const updateResults = await Promise.all(
          updates.map(({ memberId, payload }) =>
            supabase.from('pfo_members').update(payload).eq('MemberIDNo', memberId)
          )
        );
        const failedUpdate = updateResults.find((r) => r.error);
        if (failedUpdate) throw failedUpdate.error;
      }

      const skipNote = alreadyMarkedCount > 0
        ? ` ${alreadyMarkedCount} talk record(s) were already marked and left unchanged.`
        : '';
      showAlert(
        'Success',
        newlySetCount > 0
          ? `Marked ${newlySetCount} talk record(s) as attended.${skipNote}`
          : `Nothing to update -- all selected members already have these talks marked.`
      );
      setAssignModalVisible(false);
      setSelectedIds(new Set());
      setStagedMemberIds(new Set());
      setStagedTalkIds(new Set());
    } catch (err) {
      showAlert('Assignment Failed', err.message);
    } finally {
      setAssigning(false);
    }
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
          <FilterDropdown label="Status" value={statusFilter} options={['All', ...STATUS_OPTIONS]} onChange={setStatusFilter} />
        </View>

        {selectedIds.size > 0 && (
          <View style={styles.selectedPill}>
            <Text style={styles.selectedPillText}>{selectedIds.size} selected</Text>
            <TouchableOpacity onPress={() => setSelectedIds(new Set())} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle-outline" size={16} color="#475569" />
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity style={styles.assignBtn} onPress={openAssignModal}>
          <Ionicons name="add-outline" size={15} color="#ffffff" style={{ marginRight: 4 }} />
          <Text style={styles.assignBtnText}>Assign to Talks</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.tableCard}>
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ flexGrow: 1 }}>
          <View style={{ minWidth: TABLE_MIN_WIDTH, flex: 1 }}>
            {/* Table Header */}
            <View style={styles.tableHeaderRow}>
              <View style={[styles.headerCell, CHECKBOX_COL]}>
                <Pressable
                  style={[styles.checkbox, allFilteredSelected && styles.checkboxChecked]}
                  onPress={toggleSelectAll}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
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
              <View style={[styles.headerCell, STATUS_COL]}>
                <Text style={styles.headerText}>STATUS</Text>
              </View>
              <View style={[styles.headerCell, ROLE_COL, { justifyContent: 'center' }]}>
                <Text style={styles.headerText}>ROLE & AREA</Text>
              </View>
              <View style={[styles.headerCell, ACTIONS_COL, { justifyContent: 'center' }]}>
                <Text style={styles.headerText}>EDIT</Text>
              </View>
            </View>

            <FlatList
              data={pageItems}
              keyExtractor={(item) => item.MemberIDNo?.toString()}
              CellRendererComponent={RoleMenuAwareRow}
              renderItem={({ item }) => {
                const currentGender = item.Gender;
                const currentStatus = getStatusLabel(item.Status);
                const isRowUpdating = updatingId === item.MemberIDNo;
                const isSelected = selectedIds.has(item.MemberIDNo);
                const isRoleMenuOpen = roleMenuOpenFor === item.MemberIDNo;
                const isChangingRole = changingRoleId === item.MemberIDNo;
                const isStatusMenuOpen = statusMenuOpenFor === item.MemberIDNo;
                const isChangingStatus = changingStatusId === item.MemberIDNo;

                return (
                  <View style={[styles.tableRow, (isRoleMenuOpen || isStatusMenuOpen) && { zIndex: 50 }]}>
                    <View style={[styles.cell, CHECKBOX_COL]}>
                      <Pressable
                        style={[styles.checkbox, isSelected && styles.checkboxChecked]}
                        onPress={() => toggleSelectRow(item.MemberIDNo)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
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

                    <View style={[styles.cell, STATUS_COL]}>
                      <View style={styles.statusBadgeWrapper}>
                        {isChangingStatus ? (
                          <ActivityIndicator size="small" color="#002060" />
                        ) : (
                          <TouchableOpacity
                            style={[styles.statusBadge, { backgroundColor: getStatusColors(currentStatus).bg, borderColor: getStatusColors(currentStatus).border }]}
                            onPress={() => {
                              setRoleMenuOpenFor(null);
                              setStatusMenuOpenFor(isStatusMenuOpen ? null : item.MemberIDNo);
                            }}
                          >
                            <Text style={[styles.statusBadgeText, { color: getStatusColors(currentStatus).text }]}>
                              {currentStatus}
                            </Text>
                            <Ionicons
                              name={isStatusMenuOpen ? 'chevron-up' : 'chevron-down'}
                              size={11}
                              color={getStatusColors(currentStatus).text}
                              style={styles.statusBadgeIcon}
                            />
                          </TouchableOpacity>
                        )}

                        {isStatusMenuOpen && (
                          <View style={styles.statusMenu}>
                            {STATUS_OPTIONS.map((option) => {
                              const isCurrent = currentStatus === option;
                              return (
                                <TouchableOpacity
                                  key={option}
                                  style={[styles.roleMenuItem, isCurrent && styles.roleMenuItemActive]}
                                  onPress={() => handleChangeStatus(item.MemberIDNo, item.Status, option)}
                                >
                                  <Text style={[styles.roleMenuItemText, isCurrent && styles.roleMenuItemTextActive]}>
                                    {option}
                                  </Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                        )}
                      </View>
                    </View>

                    <View style={[styles.cell, ROLE_COL, { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }]}>
                      <View style={styles.roleBadgeWrapper}>
                        {isChangingRole ? (
                          <ActivityIndicator size="small" color="#002060" />
                        ) : (
                          <TouchableOpacity
                            style={styles.roleBadge}
                            onPress={() => {
                              setStatusMenuOpenFor(null);
                              setRoleMenuOpenFor(isRoleMenuOpen ? null : item.MemberIDNo);
                            }}
                          >
                            <Text style={styles.roleBadgeText}>{getRoleLabel(item.PastoralService)}</Text>
                            <Ionicons name={isRoleMenuOpen ? 'chevron-up' : 'chevron-down'} size={11} color="#002060" style={{ marginLeft: 4 }} />
                          </TouchableOpacity>
                        )}

                        {isRoleMenuOpen && (
                          <View style={styles.roleMenu}>
                            <ScrollView style={styles.roleMenuScroll} nestedScrollEnabled>
                              {ROLE_OPTION_CODES.map((code) => {
                                const isCurrent = (item.PastoralService || '').trim().toUpperCase() === code;
                                return (
                                  <TouchableOpacity
                                    key={code}
                                    style={[styles.roleMenuItem, isCurrent && styles.roleMenuItemActive]}
                                    onPress={() => handleChangeRole(item.MemberIDNo, item.PastoralService, code)}
                                  >
                                    <Text style={[styles.roleMenuItemText, isCurrent && styles.roleMenuItemTextActive]}>
                                      {ROLE_LABELS[code]}
                                    </Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </ScrollView>
                          </View>
                        )}
                      </View>

                      <View style={styles.areaBadge}><Text style={styles.areaBadgeText}>{item.AreaName || 'No Area'}</Text></View>
                    </View>

                    <View style={[styles.cell, ACTIONS_COL, { alignItems: 'center' }]}>
                      <TouchableOpacity onPress={() => openEditModal(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Ionicons name="create-outline" size={18} color="#2563eb" />
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              }}
              ListEmptyComponent={
                <Text style={styles.empty}>
                  {searchQuery || genderFilter !== 'All' || roleFilter !== 'All' || areaFilter !== 'All' || statusFilter !== 'All'
                    ? 'No members matched your search and filters.'
                    : 'No members found.'}
                </Text>
              }
            />
          </View>
        </ScrollView>

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

          <TablePagination
            page={page}
            pageCount={pageCount}
            totalCount={filteredMembers.length}
            pageSize={pageSize}
            onChange={setPage}
          />
        </View>
      </View>

      <Modal visible={assignModalVisible} animationType="slide" transparent onRequestClose={closeAssignModal}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={styles.modalScrollContainer} style={{ width: '100%' }} showsVerticalScrollIndicator={false}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Assign Talks to Members</Text>

              <Text style={styles.inputLabel}>Members ({stagedMemberIds.size})</Text>

              <View style={styles.modalSearchBar}>
                <Ionicons name="search" size={14} color="#94a3b8" style={{ marginRight: 6 }} />
                <TextInput
                  style={styles.modalSearchInput}
                  placeholder="Search members..."
                  placeholderTextColor="#94a3b8"
                  value={memberSearchQuery}
                  onChangeText={setMemberSearchQuery}
                  autoCorrect={false}
                />
              </View>

              <View style={styles.talkListBox}>
                <FlatList
                  data={memberChecklistOptions}
                  keyExtractor={(m) => m.MemberIDNo?.toString()}
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item: m }) => {
                    const isChecked = stagedMemberIds.has(m.MemberIDNo);
                    return (
                      <TouchableOpacity style={styles.talkRow} onPress={() => toggleStagedMember(m.MemberIDNo)}>
                        <Ionicons
                          name={isChecked ? 'checkbox' : 'square-outline'}
                          size={16}
                          color={isChecked ? '#002060' : '#94a3b8'}
                          style={{ marginRight: 8, marginTop: 2 }}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.talkRowText}>{m.Lastname}, {m.Firstname}</Text>
                          <Text style={styles.talkRowGroup}>ID: {m.MemberIDNo}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  }}
                  ListEmptyComponent={<Text style={styles.autocompleteEmpty}>No matching members.</Text>}
                />
              </View>

              <Text style={[styles.inputLabel, { marginTop: 18 }]}>Talks ({stagedTalkIds.size})</Text>
              {stagedTalkIds.size > 0 && (
                <View style={styles.stagedContainer}>
                  {TRAINING_COLUMNS.filter((t) => stagedTalkIds.has(t.id)).map((t) => (
                    <View key={t.id} style={styles.stagedChip}>
                      <Text style={styles.stagedChipText} numberOfLines={1}>{t.label}</Text>
                      <TouchableOpacity
                        style={styles.stagedChipRemove}
                        onPress={() => toggleStagedTalk(t.id)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="close" size={12} color="#1e40af" />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}

              <View style={styles.modalSearchBar}>
                <Ionicons name="search" size={14} color="#94a3b8" style={{ marginRight: 6 }} />
                <TextInput
                  style={styles.modalSearchInput}
                  placeholder="Search talks by name or group..."
                  placeholderTextColor="#94a3b8"
                  value={talkSearchQuery}
                  onChangeText={setTalkSearchQuery}
                  autoCorrect={false}
                />
              </View>

              <View style={styles.talkListBox}>
                <FlatList
                  data={filteredTalks}
                  keyExtractor={(t) => t.id}
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item: t }) => {
                    const isChecked = stagedTalkIds.has(t.id);
                    const title = parseTrainingName(t.id) || t.label;
                    return (
                      <TouchableOpacity style={styles.talkRow} onPress={() => toggleStagedTalk(t.id)}>
                        <Ionicons
                          name={isChecked ? 'checkbox' : 'square-outline'}
                          size={16}
                          color={isChecked ? '#002060' : '#94a3b8'}
                          style={{ marginRight: 8, marginTop: 2 }}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.talkRowCode}>{t.label}</Text>
                          <Text style={styles.talkRowText} numberOfLines={2}>{title}</Text>
                          <Text style={styles.talkRowGroup}>{t.group}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  }}
                  ListEmptyComponent={<Text style={styles.autocompleteEmpty}>No matching talks.</Text>}
                />
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity style={[styles.btn, styles.btnCancel]} onPress={closeAssignModal}>
                  <Text style={styles.btnTextCancel}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, styles.btnConfirm, (stagedMemberIds.size === 0 || stagedTalkIds.size === 0 || assigning) && styles.btnDisabled]}
                  onPress={handleAssignTalks}
                  disabled={stagedMemberIds.size === 0 || stagedTalkIds.size === 0 || assigning}
                >
                  {assigning ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.btnTextConfirm}>Assign</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={editModalVisible} animationType="slide" transparent onRequestClose={closeEditModal}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={styles.modalScrollContainer} style={{ width: '100%' }} showsVerticalScrollIndicator={false}>
            <View style={[styles.modalContent, styles.editModalContent]}>
              <Text style={styles.modalTitle}>Edit Member</Text>

              {editForm && (
                <>
                  <View style={[styles.row, { zIndex: 40 }]}>
                    <View style={styles.fieldWrap}>
                      <Text style={styles.fieldLabel}>Member ID</Text>
                      <TextInput style={[styles.input, styles.inputDisabled]} value={editForm.MemberIDNo} editable={false} />
                    </View>
                    <View style={styles.fieldWrap}>
                      <Text style={styles.fieldLabel}>Last Name *</Text>
                      <TextInput
                        style={styles.input}
                        value={editForm.Lastname}
                        onChangeText={(v) => setEditField('Lastname', v)}
                        placeholder="Dela Cruz"
                        placeholderTextColor="#94a3b8"
                        autoCorrect={false}
                      />
                    </View>
                    <View style={styles.fieldWrap}>
                      <Text style={styles.fieldLabel}>First Name *</Text>
                      <TextInput
                        style={styles.input}
                        value={editForm.Firstname}
                        onChangeText={(v) => setEditField('Firstname', v)}
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
                        {['Male', 'Female'].map((g) => {
                          const active = editForm.Gender === g;
                          return (
                            <TouchableOpacity
                              key={g}
                              style={[styles.genderToggle, active && styles.genderToggleActive]}
                              onPress={() => setEditField('Gender', active ? '' : g)}
                            >
                              <Text style={[styles.genderToggleText, active && styles.genderToggleTextActive]}>{g}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>

                    <SelectField label="Status" value={editForm.Status} options={STATUS_OPTIONS} onChange={(v) => setEditField('Status', v)} />

                    <SelectField
                      label="Pastoral Service"
                      value={editForm.PastoralService}
                      options={ROLE_OPTION_CODES}
                      onChange={(v) => setEditField('PastoralService', v)}
                      getLabel={getRoleLabel}
                      placeholder="Select role…"
                    />
                  </View>

                  <View style={[styles.row, { zIndex: 20 }]}>
                    <AutocompleteField
                      label="Area"
                      value={editForm.AreaName}
                      onChangeText={(v) => setEditField('AreaName', v)}
                      suggestions={areaSuggestions}
                      placeholder="e.g. West 1C2"
                    />

                    <AutocompleteField
                      label="Household Head"
                      value={editForm.NameOfHouseholdHead}
                      onChangeText={(v) => setEditField('NameOfHouseholdHead', v)}
                      suggestions={householdSuggestions}
                      placeholder="Name of household head"
                    />

                    <View style={styles.fieldWrap}>
                      <Text style={styles.fieldLabel}>Year Registered</Text>
                      <TextInput
                        style={styles.input}
                        value={editForm.YearRegistered}
                        onChangeText={(v) => setEditField('YearRegistered', v.replace(/[^0-9]/g, ''))}
                        placeholder="e.g. 2024"
                        placeholderTextColor="#94a3b8"
                        keyboardType="number-pad"
                        maxLength={4}
                      />
                    </View>
                  </View>
                </>
              )}

              <View style={styles.modalActions}>
                <TouchableOpacity style={[styles.btn, styles.btnCancel]} onPress={closeEditModal} disabled={savingEdit}>
                  <Text style={styles.btnTextCancel}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, styles.btnConfirm, !canSaveEdit && styles.btnDisabled]}
                  onPress={handleSaveEdit}
                  disabled={!canSaveEdit}
                >
                  {savingEdit ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.btnTextConfirm}>Save Changes</Text>}
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

  tableFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap',
    borderTopWidth: 1, borderTopColor: '#e2e8f0',
  },
  pageSizeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 16, paddingVertical: 10 },
  pageSizeLabel: { fontSize: 11, fontWeight: '700', color: '#94a3b8', marginRight: 2 },
  pageSizeBadge: {
    minWidth: 30, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 20,
    backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center',
  },
  pageSizeBadgeActive: { backgroundColor: '#002060', borderColor: '#002060' },
  pageSizeBadgeText: { fontSize: 11, fontWeight: '700', color: '#334155' },
  pageSizeBadgeTextActive: { color: '#ffffff' },
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

  roleBadgeWrapper: { position: 'relative' },
  roleBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#eff6ff', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  roleBadgeText: { fontSize: 11, fontWeight: '700', color: '#002060' },
  areaBadge: { backgroundColor: '#f1f5f9', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  areaBadgeText: { fontSize: 11, fontWeight: '700', color: '#475569' },

  statusBadgeWrapper: { position: 'relative', alignSelf: 'flex-start' },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 20, borderWidth: 1, alignSelf: 'flex-start',
  },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  statusBadgeIcon: { marginLeft: 5 },
  statusMenu: {
    position: 'absolute', top: 30, left: 0, minWidth: 140,
    backgroundColor: '#ffffff', borderRadius: 8, borderWidth: 1, borderColor: '#cbd5e1',
    shadowColor: '#0f172a', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 8,
    elevation: 8, zIndex: 60, paddingVertical: 4,
  },

  roleMenu: {
    position: 'absolute', top: 30, left: 0, minWidth: 190,
    backgroundColor: '#ffffff', borderRadius: 8, borderWidth: 1, borderColor: '#cbd5e1',
    shadowColor: '#0f172a', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 8,
    elevation: 8, zIndex: 60, paddingVertical: 4,
  },
  roleMenuScroll: { maxHeight: 220 },
  roleMenuItem: { paddingHorizontal: 12, paddingVertical: 9 },
  roleMenuItemActive: { backgroundColor: '#eff6ff' },
  roleMenuItemText: { fontSize: 12, fontWeight: '500', color: '#334155' },
  roleMenuItemTextActive: { color: '#002060', fontWeight: '700' },

  empty: { textAlign: 'center', color: '#94a3b8', marginTop: 40, marginBottom: 20 },

  assignBtn: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#002060',
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9,
  },
  assignBtnText: { fontSize: 12, fontWeight: '700', color: '#ffffff' },

  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.4)',
    justifyContent: 'center', alignItems: 'center', padding: 20,
  },
  modalScrollContainer: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 20 },
  modalContent: {
    backgroundColor: '#ffffff', borderRadius: 14, padding: 20, width: '100%', maxWidth: 520,
    ...Platform.select({
      web: { boxShadow: '0 4px 10px 0 rgba(0,0,0,0.1)' },
      default: { elevation: 5 },
    }),
  },
  modalTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a', marginBottom: 16 },
  inputLabel: { fontSize: 11, fontWeight: '700', color: '#475569', textTransform: 'uppercase', marginBottom: 6 },

  editModalContent: { maxWidth: 640, gap: 14 },
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
  genderToggleActive: { backgroundColor: '#002060', borderColor: '#002060' },
  genderToggleText: { fontSize: 13, fontWeight: '700', color: '#334155' },
  genderToggleTextActive: { color: '#ffffff' },

  stagedContainer: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6, backgroundColor: '#f8fafc',
    padding: 8, borderRadius: 8, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 10,
  },
  stagedChip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#eff6ff',
    borderWidth: 1, borderColor: '#bfdbfe', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, maxWidth: 220,
  },
  stagedChipText: { fontSize: 12, fontWeight: '600', color: '#1e40af' },
  stagedChipRemove: { marginLeft: 6, paddingHorizontal: 2 },

  modalSearchBar: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc',
    borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, marginBottom: 4,
  },
  modalSearchInput: { flex: 1, fontSize: 13, color: '#1e293b' },

  autocompleteEmpty: { fontSize: 12, color: '#94a3b8', textAlign: 'center', paddingVertical: 14 },

  talkListBox: {
    maxHeight: 240, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8,
    marginTop: 4, marginBottom: 16, overflow: 'hidden',
  },
  talkRow: {
    flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 12, paddingVertical: 9,
    borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  talkRowCode: { fontSize: 10, fontWeight: '800', color: '#2563eb' },
  talkRowText: { fontSize: 13, fontWeight: '600', color: '#1e293b', marginTop: 1 },
  talkRowGroup: { fontSize: 10, color: '#94a3b8', marginTop: 2, textTransform: 'uppercase', fontWeight: '700' },

  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  btn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, minWidth: 90, alignItems: 'center' },
  btnCancel: { backgroundColor: '#f1f5f9' },
  btnConfirm: { backgroundColor: '#2563eb' },
  btnDisabled: { backgroundColor: '#cbd5e1', opacity: 0.6 },
  btnTextCancel: { color: '#475569', fontSize: 13, fontWeight: '600' },
  btnTextConfirm: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
});
