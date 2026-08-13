import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { EmptyRow, InitialsBadge, TablePagination, usePagination } from '../components/admin-table';

const NAVY = '#002060';
const PAGE_SIZE = 20;
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

function getInitials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
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

// A colored dot + label, matching the tri-state chip language used
// throughout this screen (mirrors the reference table's Policy/Status
// columns) without leaning on a filled pill background.
function StatusDot({ status }) {
  const style = STATUS_STYLES[status] || { color: '#64748b', label: status };
  return (
    <View style={styles.statusDotRow}>
      <View style={[styles.statusDot, { backgroundColor: style.color }]} />
      <Text style={[styles.statusDotText, { color: style.color }]} numberOfLines={1}>{style.label}</Text>
    </View>
  );
}

// Read-only status tracker for the signed-in account's own Directory edits
// -- for anyone whose role isn't Admin/Moderator, those don't touch members
// directly (see MembersList.js's applyOrQueueChange); this is where they
// can check whether a submission is still waiting, got approved, or was
// rejected (and why). RLS already limits member_change_requests SELECT to
// an account's own rows for non-approvers, but the query still filters by
// requested_by explicitly so this page always means "mine", full stop.
export default function MyChangeRequests() {
  const { width } = useWindowDimensions();
  const isNarrow = width < NARROW_BREAKPOINT;

  const [userId, setUserId] = useState(null);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (cancelled) return;
      setUserId(user?.id || null);
      if (user?.id) loadRequests(user.id);
      else setLoading(false);
    });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!userId) return undefined;

    const channel = supabase
      .channel('my_change_requests_feed')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'member_change_requests', filter: `requested_by=eq.${userId}` },
        () => loadRequests(userId)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  async function loadRequests(uid) {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('member_change_requests')
        .select('*, members ( Firstname, Lastname )')
        .eq('requested_by', uid)
        .order('created_at', { ascending: false })
        .limit(300);
      if (error) throw error;
      setRequests(data || []);
    } catch (err) {
      showAlert('Error Loading Your Change Requests', err.message);
    } finally {
      setLoading(false);
    }
  }

  const filteredRequests = useMemo(
    () => requests.filter((r) => statusFilter === 'all' || r.status === statusFilter),
    [requests, statusFilter]
  );

  const { page, pageCount, pageItems, setPage } = usePagination(filteredRequests, PAGE_SIZE);

  return (
    <View style={styles.container}>
      <View style={styles.body}>
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>My Change Requests ({filteredRequests.length})</Text>
            <View style={styles.filterRow}>
              {['all', 'pending', 'on_going', 'approved', 'rejected'].map((s) => {
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
          </View>

          {!loading && !isNarrow && (
            <View style={styles.headerRow}>
              <Text style={[styles.headerCell, styles.colName]}>NAME</Text>
              <Text style={[styles.headerCell, styles.colChanges]}>CHANGES</Text>
              <Text style={[styles.headerCell, styles.colStatus]}>STATUS</Text>
              <Text style={[styles.headerCell, styles.colDate]}>SUBMITTED</Text>
              <Text style={[styles.headerCell, styles.colReviewer]}>HANDLED BY</Text>
              <View style={styles.colAction} />
            </View>
          )}

          {loading ? (
            <ActivityIndicator size="large" color={NAVY} style={{ padding: 30 }} />
          ) : pageItems.length === 0 ? (
            <EmptyRow label={statusFilter === 'all' ? "You haven't submitted any Directory edits yet." : 'No matching requests.'} />
          ) : (
            <ScrollView style={styles.rowsScroll}>
              {pageItems.map((r, index) => {
                const memberName = `${r.members?.Lastname || ''}, ${r.members?.Firstname || ''}`.trim();
                const changeEntries = Object.entries(r.changes || {});
                const changeKeys = changeEntries.map(([k]) => k);
                const isExpanded = expandedId === r.id;
                const isRejected = r.status === 'rejected';

                return (
                  <View key={r.id}>
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => setExpandedId(isExpanded ? null : r.id)}
                      style={[
                        styles.row,
                        isNarrow && styles.rowNarrow,
                        index === pageItems.length - 1 && !isExpanded && styles.rowLast,
                        isRejected && styles.rowRejected,
                      ]}
                    >
                      {isRejected && <View style={styles.rejectedAccent} />}

                      <View style={[styles.nameCell, styles.colName]}>
                        <InitialsBadge text={getInitials(memberName)} size={38} color="#2563eb" bg="#eff6ff" />
                        <View style={{ flex: 1, marginLeft: 10 }}>
                          <Text style={styles.nameText} numberOfLines={1}>{memberName || 'Unknown Member'}</Text>
                          <Text style={styles.idText} numberOfLines={1}>ID: {r.member_id}</Text>
                        </View>
                      </View>

                      <View style={[isNarrow ? styles.narrowMetaBlock : styles.colChanges]}>
                        <Text style={styles.changesCount}>{changeEntries.length} Field{changeEntries.length === 1 ? '' : 's'}</Text>
                        <Text style={styles.changesList} numberOfLines={1}>{changeKeys.join(', ') || 'No fields changed'}</Text>
                      </View>

                      <View style={isNarrow ? styles.narrowMetaBlock : styles.colStatus}>
                        <StatusDot status={r.status} />
                      </View>

                      <View style={isNarrow ? styles.narrowMetaBlock : styles.colDate}>
                        <Text style={styles.plainCellText} numberOfLines={1}>{formatTimestamp(r.created_at)}</Text>
                      </View>

                      {!isNarrow && (
                        <View style={styles.colReviewer}>
                          <Text style={styles.plainCellText} numberOfLines={1}>
                            {r.reviewed_by_email || r.assigned_to_email || '—'}
                          </Text>
                        </View>
                      )}

                      <View style={styles.colAction}>
                        <View style={styles.expandBtn}>
                          <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color="#2563eb" />
                        </View>
                      </View>
                    </TouchableOpacity>

                    {isExpanded && (
                      <View style={[styles.diffPanel, index === pageItems.length - 1 && { borderBottomWidth: 0 }]}>
                        {isNarrow && (
                          <Text style={styles.narrowReviewerText}>
                            Handled by: {r.reviewed_by_email || r.assigned_to_email || '—'}
                          </Text>
                        )}
                        {changeEntries.length === 0 ? (
                          <Text style={styles.diffEmptyText}>No field-level changes recorded.</Text>
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
            </ScrollView>
          )}

          <TablePagination page={page} pageCount={pageCount} totalCount={filteredRequests.length} pageSize={PAGE_SIZE} onChange={setPage} />
        </View>
      </View>
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

  filterRow: { flexDirection: 'row', gap: 18 },
  filterItem: { alignItems: 'center', paddingBottom: 4 },
  filterItemText: { fontSize: 12, fontWeight: '600', color: '#94a3b8' },
  filterUnderline: { height: 2, width: '100%', borderRadius: 1, marginTop: 5 },

  headerRow: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 10,
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#f1f5f9', backgroundColor: '#fafbfc',
  },
  headerCell: { fontSize: 10, fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 },

  rowsScroll: { flex: 1 },
  row: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#f4f6f9', position: 'relative',
  },
  rowNarrow: { flexWrap: 'wrap', rowGap: 8 },
  rowLast: { borderBottomWidth: 0 },
  rowRejected: { backgroundColor: '#fef4f4' },
  rejectedAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: '#dc2626' },

  colName: { flex: 2.2, minWidth: 190 },
  colChanges: { flex: 1.8, minWidth: 160 },
  colStatus: { flex: 1.3, minWidth: 130 },
  colDate: { flex: 1.4, minWidth: 140 },
  colReviewer: { flex: 1.6, minWidth: 150 },
  colAction: { width: 44, alignItems: 'flex-end' },
  narrowMetaBlock: { width: '48%' },

  nameCell: { flexDirection: 'row', alignItems: 'center' },
  nameText: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  idText: { fontSize: 11, color: '#94a3b8', marginTop: 2 },

  changesCount: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  changesList: { fontSize: 11, color: '#94a3b8', marginTop: 2 },

  statusDotRow: { flexDirection: 'row', alignItems: 'center' },
  statusDot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  statusDotText: { fontSize: 12, fontWeight: '700' },

  plainCellText: { fontSize: 12, color: '#475569', fontWeight: '500' },

  expandBtn: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: '#eff6ff',
    alignItems: 'center', justifyContent: 'center',
  },

  diffPanel: { backgroundColor: '#f8fafc', paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f4f6f9' },
  diffEmptyText: { fontSize: 12, color: '#94a3b8' },
  diffRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, flexWrap: 'wrap' },
  diffKey: {
    minWidth: 130, flexBasis: 130, flexShrink: 0, fontSize: 11, fontWeight: '700', color: '#0f172a',
    fontFamily: Platform.select({ ios: 'Courier', android: 'monospace', web: 'ui-monospace, monospace', default: 'monospace' }),
  },
  diffFrom: { flex: 1, fontSize: 12, color: '#b91c1c' },
  diffTo: { flex: 1, fontSize: 12, color: '#15803d', fontWeight: '600' },
  narrowReviewerText: { fontSize: 12, color: '#64748b', marginBottom: 8, fontWeight: '600' },
  rejectionReasonText: { fontSize: 12, color: '#b91c1c', marginTop: 10, fontStyle: 'italic' },
});
