import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { EmptyRow, ExportButton, exportCsv, InitialsBadge, TablePagination, usePagination } from '../components/admin-table';

const NAVY = '#002060';
const PAGE_SIZE = 10; // Groups per page, not individual requests -- a busy requestor's requests all land on the same page together.
const NARROW_BREAKPOINT = 760;

const STATUS_STYLES = {
  pending: { color: '#d97706', label: 'Awaiting Approval' },
  on_going: { color: '#2563eb', label: 'On-Going' },
  approved: { color: '#16a34a', label: 'Approved' },
  rejected: { color: '#dc2626', label: 'Rejected' },
};

function formatTimestamp(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatValue(v) {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

// Requesters have no display name on file, just an email -- initials come
// from the local-part instead (e.g. "jane.doe@..." -> "JD").
function getInitialsFromEmail(email) {
  if (!email) return '?';
  const parts = email.split('@')[0].split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

function showAlert(title, message) {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
  } else {
    console.error(`${title}: ${message}`);
  }
}

// Same colored-dot status language as My Change Requests, so both screens
// read as one system.
function StatusDot({ status }) {
  const style = STATUS_STYLES[status] || { color: '#64748b', label: status };
  return (
    <View style={styles.statusDotRow}>
      <View style={[styles.statusDot, { backgroundColor: style.color }]} />
      <Text style={[styles.statusDotText, { color: style.color }]} numberOfLines={1}>{style.label}</Text>
    </View>
  );
}

// Approval queue for edits submitted from the CFC Members Directory by any
// account that isn't itself an Admin/Moderator (see MembersList.js's
// applyOrQueueChange) -- nothing here has touched the members table yet.
// Approving applies request.changes to members and marks the request
// reviewed; rejecting only marks it reviewed, changing nothing.
//
// Same table language as MyChangeRequests.js (avatar + name, dot status,
// CHANGES/STATUS/SUBMITTED columns), with one addition: all pending
// requests submitted by the same account are grouped under one requestor
// header row (even when they touch different members), so a reviewer sees
// everything a given person has queued up together and can either work
// through them one at a time below, or approve the whole group in one
// "Approve All".
export default function MemberChangeQueue({ onOpenConversation }) {
  const { width } = useWindowDimensions();
  const isNarrow = width < NARROW_BREAKPOINT;

  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [processingId, setProcessingId] = useState(null);
  const [processingGroupId, setProcessingGroupId] = useState(null);
  const [messagingId, setMessagingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedGroupId, setExpandedGroupId] = useState(null);

  const [rejectModalVisible, setRejectModalVisible] = useState(false);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => {
    loadRequests();

    const channel = supabase
      .channel('member_change_queue_feed')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'member_change_requests' },
        () => loadRequests()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function loadRequests() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('member_change_requests')
        .select('*, members ( Firstname, Lastname )')
        .order('created_at', { ascending: false })
        .limit(300);
      if (error) throw error;
      setRequests(data || []);
    } catch (err) {
      showAlert('Error Loading Change Requests', err.message);
    } finally {
      setLoading(false);
    }
  }

  const filteredRequests = useMemo(
    () => requests.filter((r) => statusFilter === 'all' || r.status === statusFilter),
    [requests, statusFilter]
  );

  // Groups keep the same-requestor requests together and adjacent, ordered
  // by that group's most recent request -- same "newest activity first"
  // feel the flat list had, just at the requestor level instead of the row
  // level. Requests with no requester account on file (deleted account) get
  // their own singleton group each, keyed by request id, rather than being
  // merged into one anonymous bucket.
  const groupedRequests = useMemo(() => {
    const map = new Map();
    filteredRequests.forEach((r) => {
      const key = r.requested_by || `__no_requester_${r.id}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    });
    return Array.from(map.values()).sort(
      (a, b) => new Date(b[0].created_at).getTime() - new Date(a[0].created_at).getTime()
    );
  }, [filteredRequests]);

  const { page, pageCount, pageItems: pageGroups, setPage } = usePagination(groupedRequests, PAGE_SIZE);

  async function applyApproval(request) {
    const { error: updateError } = await supabase
      .from('members')
      .update(request.changes)
      .eq('MemberIDNo', request.member_id);
    if (updateError) throw updateError;
  }

  // Claims the request (status -> on_going, assigned to whoever clicked),
  // opens (or reuses) a direct conversation with the requester via the same
  // RPC Messages.js's "New Message" modal uses, then hands off to the
  // Messages tab already pointed at that conversation. The request stays
  // actionable afterward -- Approve/Reject still work once the discussion
  // is done, this just tracks who picked it up and where the conversation
  // about it lives.
  async function handleMessageRequester(request) {
    if (!request.requested_by) {
      showAlert('Cannot Start Conversation', 'This request has no requester account on file (it may have been deleted).');
      return;
    }
    try {
      setMessagingId(request.id);
      const { data: { user } } = await supabase.auth.getUser();

      const { data: conversationId, error: convError } = await supabase.rpc(
        'start_direct_conversation',
        { other_profile_id: request.requested_by }
      );
      if (convError) throw convError;

      const { error: updateError } = await supabase
        .from('member_change_requests')
        .update({
          status: 'on_going',
          assigned_to: user?.id || null,
          assigned_to_email: user?.email || null,
          conversation_id: conversationId,
        })
        .eq('id', request.id);
      if (updateError) throw updateError;

      setRequests((prev) => prev.map((r) => (
        r.id === request.id
          ? { ...r, status: 'on_going', assigned_to_email: user?.email || null, conversation_id: conversationId }
          : r
      )));

      onOpenConversation?.(conversationId);
    } catch (err) {
      showAlert('Error Starting Conversation', err.message);
    } finally {
      setMessagingId(null);
    }
  }

  async function handleApprove(request) {
    try {
      setProcessingId(request.id);
      const { data: { user } } = await supabase.auth.getUser();
      await applyApproval(request);

      const reviewedAt = new Date().toISOString();
      const { error: reviewError } = await supabase
        .from('member_change_requests')
        .update({ status: 'approved', reviewed_by: user?.id || null, reviewed_by_email: user?.email || null, reviewed_at: reviewedAt })
        .eq('id', request.id);
      if (reviewError) throw reviewError;

      setRequests((prev) => prev.map((r) => (
        r.id === request.id ? { ...r, status: 'approved', reviewed_by_email: user?.email || null, reviewed_at: reviewedAt } : r
      )));
    } catch (err) {
      showAlert('Approval Failed', err.message);
    } finally {
      setProcessingId(null);
    }
  }

  // Applies each pending request's changes in submission order (oldest
  // first), so if two requests for the same member touched the same field,
  // the more recently submitted value is the one left standing -- then
  // marks the whole batch approved in one update.
  async function handleApproveAll(groupKey, pendingList) {
    try {
      setProcessingGroupId(groupKey);
      const { data: { user } } = await supabase.auth.getUser();
      const ordered = [...pendingList].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      for (const request of ordered) {
        // eslint-disable-next-line no-await-in-loop -- must apply in submission order, not in parallel
        await applyApproval(request);
      }

      const reviewedAt = new Date().toISOString();
      const ids = ordered.map((r) => r.id);
      const { error: reviewError } = await supabase
        .from('member_change_requests')
        .update({ status: 'approved', reviewed_by: user?.id || null, reviewed_by_email: user?.email || null, reviewed_at: reviewedAt })
        .in('id', ids);
      if (reviewError) throw reviewError;

      setRequests((prev) => prev.map((r) => (
        ids.includes(r.id) ? { ...r, status: 'approved', reviewed_by_email: user?.email || null, reviewed_at: reviewedAt } : r
      )));
    } catch (err) {
      showAlert('Bulk Approval Failed', err.message);
    } finally {
      setProcessingGroupId(null);
    }
  }

  function openRejectModal(request) {
    setRejectTarget(request);
    setRejectReason('');
    setRejectModalVisible(true);
  }

  function closeRejectModal() {
    if (processingId) return;
    setRejectModalVisible(false);
    setRejectTarget(null);
  }

  async function handleReject() {
    if (!rejectTarget) return;
    try {
      setProcessingId(rejectTarget.id);
      const { data: { user } } = await supabase.auth.getUser();
      const reviewedAt = new Date().toISOString();
      const reason = rejectReason.trim() || null;

      const { error } = await supabase
        .from('member_change_requests')
        .update({ status: 'rejected', reviewed_by: user?.id || null, reviewed_by_email: user?.email || null, reviewed_at: reviewedAt, rejection_reason: reason })
        .eq('id', rejectTarget.id);
      if (error) throw error;

      setRequests((prev) => prev.map((r) => (
        r.id === rejectTarget.id ? { ...r, status: 'rejected', reviewed_by_email: user?.email || null, reviewed_at: reviewedAt, rejection_reason: reason } : r
      )));
      setRejectModalVisible(false);
      setRejectTarget(null);
    } catch (err) {
      showAlert('Rejection Failed', err.message);
    } finally {
      setProcessingId(null);
    }
  }

  function handleExport() {
    const rows = filteredRequests.map((r) => ({
      time: formatTimestamp(r.created_at),
      member: `${r.members?.Lastname || ''}, ${r.members?.Firstname || ''}`,
      memberId: r.member_id,
      status: r.status,
      requestedBy: r.requested_by_email || '',
      assignedTo: r.assigned_to_email || '',
      reviewedBy: r.reviewed_by_email || '',
      changes: Object.entries(r.changes || {}).map(([k, v]) => `${k}: ${formatValue(r.previous_values?.[k])} -> ${formatValue(v)}`).join('; '),
      rejectionReason: r.rejection_reason || '',
    }));
    exportCsv('member-change-requests', [
      { key: 'time', label: 'Submitted' },
      { key: 'member', label: 'Member' },
      { key: 'memberId', label: 'Member ID' },
      { key: 'status', label: 'Status' },
      { key: 'requestedBy', label: 'Requested By' },
      { key: 'assignedTo', label: 'Assigned To' },
      { key: 'reviewedBy', label: 'Reviewed By' },
      { key: 'changes', label: 'Changes' },
      { key: 'rejectionReason', label: 'Rejection Reason' },
    ], rows);
  }

  return (
    <View style={styles.container}>
      <View style={styles.body}>
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Change Requests ({filteredRequests.length})</Text>
            <View style={styles.cardHeaderRight}>
              <View style={styles.filterRow}>
                {['pending', 'on_going', 'approved', 'rejected', 'all'].map((s) => {
                  const isActive = statusFilter === s;
                  const style = STATUS_STYLES[s];
                  return (
                    <TouchableOpacity key={s} style={styles.filterItem} onPress={() => setStatusFilter(s)}>
                      <Text style={[styles.filterItemText, isActive && { color: style?.color || NAVY, fontWeight: '800' }]}>
                        {s === 'all' ? 'All' : style.label}
                      </Text>
                      {isActive && <View style={[styles.filterUnderline, { backgroundColor: style?.color || NAVY }]} />}
                    </TouchableOpacity>
                  );
                })}
              </View>
              <ExportButton onPress={handleExport} />
            </View>
          </View>

          {!loading && !isNarrow && (
            <View style={styles.headerRow}>
              <Text style={[styles.headerCell, styles.colName]}>REQUESTOR</Text>
              <Text style={[styles.headerCell, styles.colChanges]}>CHANGES</Text>
              <Text style={[styles.headerCell, styles.colStatus]}>STATUS</Text>
              <Text style={[styles.headerCell, styles.colDate]}>SUBMITTED</Text>
              <Text style={[styles.headerCell, styles.colRequester]}>MEMBER</Text>
              <Text style={[styles.headerCell, styles.colAction]}>ACTIONS</Text>
              <View style={styles.colExpand} />
            </View>
          )}

          {loading ? (
            <ActivityIndicator size="large" color={NAVY} style={{ padding: 30 }} />
          ) : pageGroups.length === 0 ? (
            <EmptyRow label={statusFilter === 'pending' ? 'No pending change requests -- all caught up.' : 'No matching change requests.'} />
          ) : (
            <ScrollView style={styles.rowsScroll}>
              {pageGroups.map((group) => {
                const first = group[0];
                const groupKey = first.requested_by || `__no_requester_${first.id}`;
                const requesterEmail = first.requested_by_email;
                const memberCount = new Set(group.map((r) => r.member_id)).size;
                const pendingInGroup = group.filter((r) => r.status === 'pending');
                const onGoingInGroup = group.filter((r) => r.status === 'on_going');
                // Still-open requests for this requestor -- on_going ones stay
                // eligible for Approve All too, since claiming a request
                // (via Message) is meant to inform the decision, not block it.
                const actionableInGroup = [...pendingInGroup, ...onGoingInGroup];
                const groupBadgeStatus = pendingInGroup.length > 0 ? 'pending' : (onGoingInGroup.length > 0 ? 'on_going' : null);
                const isGroupProcessing = processingGroupId === groupKey;
                const isGroupExpanded = expandedGroupId === groupKey;

                return (
                  <View key={groupKey} style={styles.memberGroup}>
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => setExpandedGroupId(isGroupExpanded ? null : groupKey)}
                      style={[styles.row, styles.groupHeaderRow, isNarrow && styles.rowNarrow]}
                    >
                      <View style={[styles.nameCell, styles.colName]}>
                        <InitialsBadge text={getInitialsFromEmail(requesterEmail)} size={38} color="#2563eb" bg="#dbeafe" />
                        <View style={{ flex: 1, marginLeft: 10 }}>
                          <View style={styles.nameWithStatusRow}>
                            <Text style={styles.nameText} numberOfLines={1}>{requesterEmail || 'Unknown Requester'}</Text>
                            {!!groupBadgeStatus && <StatusDot status={groupBadgeStatus} />}
                          </View>
                          <Text style={styles.idText} numberOfLines={1}>
                            {memberCount} member{memberCount === 1 ? '' : 's'} · {group.length} request{group.length === 1 ? '' : 's'}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.colAction}>
                        {actionableInGroup.length > 1 && (
                          <TouchableOpacity
                            style={styles.approveAllBtn}
                            onPress={() => handleApproveAll(groupKey, actionableInGroup)}
                            disabled={isGroupProcessing || !!processingId}
                          >
                            {isGroupProcessing ? (
                              <ActivityIndicator size="small" color="#ffffff" />
                            ) : (
                              <Text style={styles.approveAllBtnText}>Approve All ({actionableInGroup.length})</Text>
                            )}
                          </TouchableOpacity>
                        )}
                      </View>
                      <View style={styles.colExpand}>
                        <Ionicons name={isGroupExpanded ? 'chevron-up' : 'chevron-down'} size={18} color="#2563eb" />
                      </View>
                    </TouchableOpacity>

                    {isGroupExpanded && group.map((r) => {
                      const isProcessing = processingId === r.id;
                      const isMessaging = messagingId === r.id;
                      const isActionable = r.status === 'pending' || r.status === 'on_going';
                      const isRejected = r.status === 'rejected';
                      const isExpanded = expandedId === r.id;
                      const changeEntries = Object.entries(r.changes || {});
                      const changeKeys = changeEntries.map(([k]) => k);
                      const rowMemberName = `${r.members?.Lastname || ''}, ${r.members?.Firstname || ''}`.trim();

                      return (
                        <View key={r.id}>
                          <TouchableOpacity
                            activeOpacity={0.7}
                            onPress={() => setExpandedId(isExpanded ? null : r.id)}
                            style={[styles.row, styles.itemRow, isNarrow && styles.rowNarrow, isRejected && styles.rowRejected]}
                          >
                            {isRejected && <View style={styles.rejectedAccent} />}
                            {!isNarrow && <View style={styles.colName} />}

                            <View style={isNarrow ? styles.narrowMetaBlock : styles.colChanges}>
                              <Text style={styles.changesCount}>{changeEntries.length} Field{changeEntries.length === 1 ? '' : 's'}</Text>
                              <Text style={styles.changesList} numberOfLines={1}>{changeKeys.join(', ') || 'No fields changed'}</Text>
                            </View>

                            <View style={isNarrow ? styles.narrowMetaBlock : styles.colStatus}>
                              <StatusDot status={r.status} />
                            </View>

                            <View style={isNarrow ? styles.narrowMetaBlock : styles.colDate}>
                              <Text style={styles.plainCellText} numberOfLines={1}>{formatTimestamp(r.created_at)}</Text>
                            </View>

                            <View style={isNarrow ? styles.narrowMetaBlock : styles.colRequester}>
                              <Text style={styles.plainCellText} numberOfLines={1}>{rowMemberName || 'Unknown Member'} · ID: {r.member_id}</Text>
                            </View>

                            <View style={[styles.colAction, isNarrow && { width: '100%', alignItems: 'flex-start', marginTop: 4 }]}>
                              {isActionable ? (
                                <View style={styles.itemActions}>
                                  <TouchableOpacity
                                    style={styles.iconBtnMessage}
                                    onPress={() => handleMessageRequester(r)}
                                    disabled={isProcessing || isGroupProcessing || isMessaging}
                                  >
                                    {isMessaging ? (
                                      <ActivityIndicator size="small" color="#ffffff" />
                                    ) : (
                                      <Ionicons name="chatbubble-ellipses-outline" size={15} color="#ffffff" />
                                    )}
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    style={styles.iconBtnReject}
                                    onPress={() => openRejectModal(r)}
                                    disabled={isProcessing || isGroupProcessing || isMessaging}
                                  >
                                    <Ionicons name="close" size={16} color="#dc2626" />
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    style={styles.iconBtnApprove}
                                    onPress={() => handleApprove(r)}
                                    disabled={isProcessing || isGroupProcessing || isMessaging}
                                  >
                                    {isProcessing ? (
                                      <ActivityIndicator size="small" color="#ffffff" />
                                    ) : (
                                      <Ionicons name="checkmark" size={16} color="#ffffff" />
                                    )}
                                  </TouchableOpacity>
                                </View>
                              ) : (
                                <Text style={styles.reviewedMeta} numberOfLines={2}>
                                  by {r.reviewed_by_email || 'Unknown'}
                                </Text>
                              )}
                            </View>

                            <View style={styles.colExpand}>
                              <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color="#94a3b8" />
                            </View>
                          </TouchableOpacity>

                          {isExpanded && (
                            <View style={styles.diffPanel}>
                              {r.status === 'on_going' && r.assigned_to_email && (
                                <Text style={styles.assignedMetaText}>Being handled by: {r.assigned_to_email}</Text>
                              )}
                              {changeEntries.length === 0 ? (
                                <Text style={styles.diffEmptyText}>No field changes in this request.</Text>
                              ) : (
                                changeEntries.map(([key, newVal]) => (
                                  <View key={key} style={styles.diffRow}>
                                    <Text style={styles.diffKey} numberOfLines={1}>{key}</Text>
                                    <Text style={styles.diffFrom} numberOfLines={2}>{formatValue(r.previous_values?.[key])}</Text>
                                    <Ionicons name="arrow-forward" size={12} color="#94a3b8" style={{ marginHorizontal: 6 }} />
                                    <Text style={styles.diffTo} numberOfLines={2}>{formatValue(newVal)}</Text>
                                  </View>
                                ))
                              )}
                              {isRejected && r.rejection_reason && (
                                <Text style={styles.rejectionReasonText}>Reason: {r.rejection_reason}</Text>
                              )}
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                );
              })}
            </ScrollView>
          )}

          <TablePagination page={page} pageCount={pageCount} totalCount={groupedRequests.length} pageSize={PAGE_SIZE} onChange={setPage} />
        </View>
      </View>

      <Modal visible={rejectModalVisible} transparent animationType="fade" onRequestClose={closeRejectModal}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Reject Change Request</Text>
            <Text style={styles.modalSubtitle}>
              {rejectTarget ? `${rejectTarget.members?.Lastname || ''}, ${rejectTarget.members?.Firstname || ''} (ID: ${rejectTarget.member_id})` : ''}
            </Text>
            <TextInput
              style={styles.reasonInput}
              placeholder="Optional reason (shown to the requester)"
              placeholderTextColor="#94a3b8"
              value={rejectReason}
              onChangeText={setRejectReason}
              multiline
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, styles.cancelBtn]} onPress={closeRejectModal} disabled={!!processingId}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.confirmRejectBtn]} onPress={handleReject} disabled={!!processingId}>
                {processingId ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.confirmRejectBtnText}>Confirm Reject</Text>}
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
  body: { flex: 1, padding: 16 },

  card: {
    flex: 1, backgroundColor: '#ffffff', borderRadius: 16, borderWidth: 1, borderColor: '#eef1f6', overflow: 'hidden',
    ...Platform.select({
      web: { boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 8px 24px rgba(15,23,42,0.04)' },
      default: { shadowColor: '#0f172a', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
    }),
  },
  cardHeader: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between',
    gap: 10, padding: 18, paddingBottom: 14,
  },
  cardTitle: { fontSize: 20, fontWeight: '800', color: '#1e293b' },
  cardHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 14 },

  filterRow: { flexDirection: 'row', gap: 16 },
  filterItem: { alignItems: 'center', paddingBottom: 4 },
  filterItemText: { fontSize: 12, fontWeight: '600', color: '#94a3b8' },
  filterUnderline: { height: 2, width: '100%', borderRadius: 1, marginTop: 5 },

  headerRow: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 10,
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#f1f5f9', backgroundColor: '#fafbfc',
  },
  headerCell: { fontSize: 10, fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 },

  rowsScroll: { flex: 1 },
  memberGroup: { borderBottomWidth: 8, borderBottomColor: '#f8fafc' },

  row: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#f4f6f9', position: 'relative',
  },
  rowNarrow: { flexWrap: 'wrap', rowGap: 8 },
  groupHeaderRow: { backgroundColor: '#eff6ff' },
  itemRow: {},
  rowRejected: { backgroundColor: '#fef4f4' },
  rejectedAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: '#dc2626' },

  colName: { flex: 2.2, minWidth: 190 },
  colChanges: { flex: 1.8, minWidth: 160 },
  colStatus: { flex: 1.3, minWidth: 130 },
  colDate: { flex: 1.4, minWidth: 140 },
  colRequester: { flex: 1.6, minWidth: 150 },
  colAction: { width: 150, alignItems: 'flex-end' },
  colExpand: { width: 24, alignItems: 'flex-end' },
  narrowMetaBlock: { width: '48%' },

  nameCell: { flexDirection: 'row', alignItems: 'center' },
  nameWithStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  nameText: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  idText: { fontSize: 11, color: '#64748b', marginTop: 2 },

  changesCount: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  changesList: { fontSize: 11, color: '#94a3b8', marginTop: 2 },

  statusDotRow: { flexDirection: 'row', alignItems: 'center' },
  statusDot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  statusDotText: { fontSize: 12, fontWeight: '700' },

  plainCellText: { fontSize: 12, color: '#475569', fontWeight: '500' },
  reviewedMeta: { fontSize: 11, color: '#94a3b8', textAlign: 'right' },

  approveAllBtn: {
    backgroundColor: '#002060', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9,
    alignItems: 'center', justifyContent: 'center', minWidth: 130,
  },
  approveAllBtnText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },

  itemActions: { flexDirection: 'row', gap: 6 },
  iconBtnMessage: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: '#2563eb',
    alignItems: 'center', justifyContent: 'center',
  },
  iconBtnApprove: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: '#16a34a',
    alignItems: 'center', justifyContent: 'center',
  },
  iconBtnReject: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: '#fee2e2', borderWidth: 1, borderColor: '#fecaca',
    alignItems: 'center', justifyContent: 'center',
  },

  diffPanel: { backgroundColor: '#f8fafc', paddingHorizontal: 18, paddingLeft: 44, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f4f6f9' },
  diffEmptyText: { fontSize: 12, color: '#94a3b8' },
  diffRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, flexWrap: 'wrap' },
  diffKey: {
    minWidth: 130, flexBasis: 130, flexShrink: 0, fontSize: 11, fontWeight: '700', color: '#0f172a',
    fontFamily: Platform.select({ ios: 'Courier', android: 'monospace', web: 'ui-monospace, monospace', default: 'monospace' }),
  },
  diffFrom: { flex: 1, fontSize: 12, color: '#b91c1c' },
  diffTo: { flex: 1, fontSize: 12, color: '#15803d', fontWeight: '600' },
  assignedMetaText: { fontSize: 12, color: '#2563eb', marginBottom: 8, fontWeight: '600' },
  rejectionReasonText: { fontSize: 12, color: '#b91c1c', marginTop: 10, fontStyle: 'italic' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  modalCard: { backgroundColor: '#ffffff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 420 },
  modalTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  modalSubtitle: { fontSize: 12, color: '#64748b', marginTop: 4, marginBottom: 12 },
  reasonInput: {
    borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 13, color: '#1e293b', minHeight: 70, textAlignVertical: 'top',
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
  modalBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, alignItems: 'center', justifyContent: 'center', minWidth: 90 },
  cancelBtn: { backgroundColor: '#f1f5f9' },
  cancelBtnText: { color: '#334155', fontSize: 13, fontWeight: '700' },
  confirmRejectBtn: { backgroundColor: '#dc2626' },
  confirmRejectBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
});
