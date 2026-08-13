import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
  Pill,
  TableCard,
  TableHeaderRow,
  TablePagination,
  TableRow,
  usePagination,
} from '../components/admin-table';

const NAVY = '#002060';
const PAGE_SIZE = 20;
const NARROW_BREAKPOINT = 720;

const ACTION_STYLES = {
  INSERT: { color: '#15803d', bg: '#dcfce7' },
  UPDATE: { color: '#1d4ed8', bg: '#dbeafe' },
  DELETE: { color: '#b91c1c', bg: '#fee2e2' },
};

function formatTimestamp(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function formatValue(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// Every members row snapshot (old_data/new_data) already carries the name,
// so this needs no join back to the (possibly since-deleted) members row.
function getMemberName(log) {
  const rec = log.new_data || log.old_data;
  if (!rec) return log.record_id || 'Unknown Member';
  const name = `${rec.Lastname || ''}, ${rec.Firstname || ''}`.trim();
  return name === ',' ? (log.record_id || 'Unknown Member') : name;
}

// Same diff approach as System Audit Log -- only what actually changed, not
// every column, since most updates only touch one or two fields.
function computeDiff(log) {
  const oldData = log.old_data || null;
  const newData = log.new_data || null;

  if (log.action === 'INSERT') {
    return Object.entries(newData || {})
      .filter(([, v]) => v !== null && v !== '' && v !== undefined)
      .map(([key, v]) => ({ key, from: null, to: v }));
  }
  if (log.action === 'DELETE') {
    return Object.entries(oldData || {})
      .filter(([, v]) => v !== null && v !== '' && v !== undefined)
      .map(([key, v]) => ({ key, from: v, to: null }));
  }
  const keys = new Set([...Object.keys(oldData || {}), ...Object.keys(newData || {})]);
  const diffs = [];
  keys.forEach((key) => {
    const a = oldData ? oldData[key] : undefined;
    const b = newData ? newData[key] : undefined;
    if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push({ key, from: a, to: b });
  });
  return diffs;
}

function showAlert(title, message) {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
  } else {
    console.error(`${title}: ${message}`);
  }
}

// Member-focused view of the same audit_log the System Audit Log screen
// reads (see scripts/sql/add-system-audit-log.sql) -- filtered to
// table_name = 'members' and shown with the member's name instead of a raw
// record_id, so an Admin/Moderator can see exactly who changed what on a
// member's record without wading through every other table's activity.
export default function MemberChangeHistory() {
  const { width } = useWindowDimensions();
  const isNarrow = width < NARROW_BREAKPOINT;

  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    loadLogs();

    const channel = supabase
      .channel('member_change_history_feed')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'audit_log', filter: 'table_name=eq.members' },
        (payload) => {
          setLogs((prev) => (
            prev.some((l) => l.id === payload.new.id) ? prev : [payload.new, ...prev].slice(0, 500)
          ));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function loadLogs() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('audit_log')
        .select('*')
        .eq('table_name', 'members')
        .order('changed_at', { ascending: false })
        .limit(300);
      if (error) throw error;
      setLogs(data || []);
    } catch (err) {
      showAlert('Error Loading Member Change History', err.message);
    } finally {
      setLoading(false);
    }
  }

  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return logs.filter((l) => {
      const matchesAction = actionFilter === 'All' || l.action === actionFilter;
      const matchesSearch = !q
        || (l.actor_email || '').toLowerCase().includes(q)
        || (l.record_id || '').toLowerCase().includes(q)
        || getMemberName(l).toLowerCase().includes(q);
      return matchesAction && matchesSearch;
    });
  }, [logs, actionFilter, searchQuery]);

  const { page, pageCount, pageItems, setPage } = usePagination(filteredLogs, PAGE_SIZE);

  function handleExport() {
    const rows = filteredLogs.map((l) => ({
      time: formatTimestamp(l.changed_at),
      member: getMemberName(l),
      memberId: l.record_id || '',
      action: l.action,
      actor: l.actor_email || 'System',
      changes: computeDiff(l).map((d) => `${d.key}: ${formatValue(d.from)} -> ${formatValue(d.to)}`).join('; '),
    }));
    exportCsv('member-change-history', [
      { key: 'time', label: 'Time' },
      { key: 'member', label: 'Member' },
      { key: 'memberId', label: 'Member ID' },
      { key: 'action', label: 'Action' },
      { key: 'actor', label: 'Actor' },
      { key: 'changes', label: 'Changes' },
    ], rows);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Ionicons name="time-outline" size={22} color="#0f172a" style={styles.titleIcon} />
          <Text style={styles.title}>Member Change History</Text>
        </View>
        <Text style={styles.subtitle}>Every add, edit, and delete ever made to a member record, with before/after values.</Text>
      </View>

      <View style={styles.body}>
        <TableCard
          style={styles.fillCard}
          title={`${filteredLogs.length} Event${filteredLogs.length === 1 ? '' : 's'}`}
          right={<ExportButton onPress={handleExport} />}
        >
          <View style={styles.controlsRow}>
            <View style={styles.searchBox}>
              <Ionicons name="search-outline" size={14} color="#94a3b8" style={{ marginRight: 6 }} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search by member, ID, or actor..."
                placeholderTextColor="#94a3b8"
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
            </View>

            <View style={styles.actionChipsRow}>
              {['All', 'INSERT', 'UPDATE', 'DELETE'].map((a) => {
                const isActive = actionFilter === a;
                const style = ACTION_STYLES[a];
                return (
                  <TouchableOpacity
                    key={a}
                    style={[
                      styles.actionChip,
                      isActive && { backgroundColor: style?.bg || '#e2e8f0', borderColor: style?.color || NAVY },
                    ]}
                    onPress={() => setActionFilter(a)}
                  >
                    <Text style={[styles.actionChipText, isActive && { color: style?.color || NAVY, fontWeight: '800' }]}>{a}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {!loading && !isNarrow && (
            <TableHeaderRow
              columns={[
                { key: 'time', label: 'Time', style: styles.colTime },
                { key: 'member', label: 'Member', style: styles.colMember },
                { key: 'action', label: 'Action', style: styles.colAction },
                { key: 'actor', label: 'Changed By', style: styles.colActor },
              ]}
            />
          )}

          {loading ? (
            <ActivityIndicator size="large" color={NAVY} style={{ padding: 30 }} />
          ) : pageItems.length === 0 ? (
            <EmptyRow label="No member changes recorded yet." />
          ) : (
            <ScrollView style={styles.rowsScroll}>
              {pageItems.map((l, index) => {
                const isExpanded = expandedId === l.id;
                const actionStyle = ACTION_STYLES[l.action] || { color: '#334155', bg: '#f1f5f9' };
                const diff = isExpanded ? computeDiff(l) : [];
                return (
                  <View key={l.id}>
                    <TableRow
                      last={index === pageItems.length - 1 && !isExpanded}
                      onPress={() => setExpandedId(isExpanded ? null : l.id)}
                      style={isNarrow ? styles.narrowRow : undefined}
                    >
                      {isNarrow ? (
                        <>
                          <View style={styles.narrowTopRow}>
                            <Pill label={l.action} color={actionStyle.color} bg={actionStyle.bg} />
                            <Text style={styles.cellText} numberOfLines={1}>{formatTimestamp(l.changed_at)}</Text>
                            <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={14} color="#94a3b8" />
                          </View>
                          <Text style={[styles.cellText, { marginTop: 6 }]} numberOfLines={1}>{getMemberName(l)}</Text>
                          <Text style={styles.cellTextMono} numberOfLines={1}>{l.record_id || '—'} · {l.actor_email || 'System'}</Text>
                        </>
                      ) : (
                        <>
                          <Text style={[styles.cellText, styles.colTime]} numberOfLines={1}>{formatTimestamp(l.changed_at)}</Text>
                          <View style={styles.colMember}>
                            <Text style={styles.cellText} numberOfLines={1}>{getMemberName(l)}</Text>
                            <Text style={styles.cellTextMono} numberOfLines={1}>{l.record_id || '—'}</Text>
                          </View>
                          <View style={styles.colAction}>
                            <Pill label={l.action} color={actionStyle.color} bg={actionStyle.bg} />
                          </View>
                          <View style={[styles.colActor, { flexDirection: 'row', alignItems: 'center' }]}>
                            <Text style={styles.cellText} numberOfLines={1}>{l.actor_email || 'System'}</Text>
                            <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={14} color="#94a3b8" style={{ marginLeft: 6 }} />
                          </View>
                        </>
                      )}
                    </TableRow>

                    {isExpanded && (
                      <View style={[styles.diffPanel, index === pageItems.length - 1 && { borderBottomWidth: 0 }]}>
                        {diff.length === 0 ? (
                          <Text style={styles.diffEmptyText}>No field-level changes recorded.</Text>
                        ) : (
                          diff.map((d) => (
                            <View key={d.key} style={styles.diffRow}>
                              <Text style={styles.diffKey} numberOfLines={1}>{d.key}</Text>
                              <Text style={styles.diffFrom} numberOfLines={2}>{formatValue(d.from)}</Text>
                              <Ionicons name="arrow-forward" size={12} color="#94a3b8" style={{ marginHorizontal: 6 }} />
                              <Text style={styles.diffTo} numberOfLines={2}>{formatValue(d.to)}</Text>
                            </View>
                          ))
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          )}

          <TablePagination page={page} pageCount={pageCount} totalCount={filteredLogs.length} pageSize={PAGE_SIZE} onChange={setPage} />
        </TableCard>
      </View>
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

  controlsRow: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingBottom: 12,
  },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', borderWidth: 1,
    borderColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, minWidth: 220, flexGrow: 1, maxWidth: 320,
  },
  searchInput: { flex: 1, fontSize: 13, color: '#1e293b' },

  actionChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  actionChip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0' },
  actionChipText: { fontSize: 11, fontWeight: '700', color: '#64748b' },

  colTime: { flex: 1.3, minWidth: 150 },
  colMember: { flex: 1.6, minWidth: 160 },
  colAction: { flex: 0.9, minWidth: 90 },
  colActor: { flex: 1.6, minWidth: 160 },

  narrowRow: { flexDirection: 'column', alignItems: 'stretch' },
  narrowTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },

  cellText: { fontSize: 12, color: '#334155', fontWeight: '600' },
  cellTextMono: {
    fontSize: 11, color: '#64748b',
    fontFamily: Platform.select({ ios: 'Courier', android: 'monospace', web: 'ui-monospace, monospace', default: 'monospace' }),
  },

  diffPanel: { backgroundColor: '#f8fafc', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f4f6f9' },
  diffEmptyText: { fontSize: 12, color: '#94a3b8' },
  diffRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, flexWrap: 'wrap' },
  diffKey: {
    minWidth: 120, flexBasis: 120, flexShrink: 0, fontSize: 11, fontWeight: '700', color: '#0f172a',
    fontFamily: Platform.select({ ios: 'Courier', android: 'monospace', web: 'ui-monospace, monospace', default: 'monospace' }),
  },
  diffFrom: { flex: 1, fontSize: 12, color: '#b91c1c' },
  diffTo: { flex: 1, fontSize: 12, color: '#15803d', fontWeight: '600' },
});
