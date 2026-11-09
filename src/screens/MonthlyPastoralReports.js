import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { ActionLink, EmptyRow, Pill, TableCard, TablePagination, TableRow, usePagination } from '../components/admin-table';
import { checkPastoralReport, fetchPastoralReports } from '../lib/ogdApi';
import { compareValues, FAILURE_MESSAGES, formatDateTime, SortHeader } from './OgdConnections';

const PAGE_SIZE_OPTIONS = [10, 20, 30, 50, 100, 200];
const WIDE_LAYOUT_MIN_WIDTH = 860;
// Each check runs its own browser, so only a couple run at once.
const CONCURRENT_CHECKS = 2;

const STATUS_STYLES = {
  generated: { label: 'Generated', color: '#15803d', bg: '#dcfce7' },
  not_generated: { label: 'Not generated', color: '#b45309', bg: '#fef3c7' },
  failed: { label: 'Check failed', color: '#b91c1c', bg: '#fee2e2' },
  checking: { label: 'Checking…', color: '#1d4ed8', bg: '#dbeafe' },
  unchecked: { label: 'Not checked', color: '#475569', bg: '#f1f5f9' },
  not_ready: { label: 'Needs setup', color: '#475569', bg: '#f1f5f9' },
};

const COLUMNS = [
  { key: 'sector', label: 'Sector', flex: 1.1, value: (row) => row.sector },
  { key: 'chapter', label: 'Chapter', flex: 1.2, value: (row) => row.chapter },
  { key: 'status', label: 'This Month', flex: 1.7, value: (row) => STATUS_STYLES[row.displayStatus].label },
  { key: 'latestMonthYear', label: 'Latest Report', flex: 1.2, value: (row) => row.latestMonthYear },
  { key: 'checkedAt', label: 'Last Checked', flex: 1.2, value: (row) => row.checkedAt },
];

function displayStatusFor(row, isChecking) {
  if (isChecking) return 'checking';
  if (row.status) return row.status;
  return row.isReady ? 'unchecked' : 'not_ready';
}

function StatusCell({ row, error }) {
  const style = STATUS_STYLES[row.displayStatus];
  const reason = row.displayStatus === 'failed' ? FAILURE_MESSAGES[row.failureCode] : null;
  return (
    <View style={styles.statusCell}>
      <Pill label={style.label} color={style.color} bg={style.bg} />
      {!!reason && <Text style={styles.statusReason}>{reason}</Text>}
      {row.displayStatus === 'failed' && !!row.statusDetail && <Text style={styles.statusDetail}>{row.statusDetail}</Text>}
      {!!error && <Text style={styles.statusReason}>{error}</Text>}
    </View>
  );
}

export default function MonthlyPastoralReports() {
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_LAYOUT_MIN_WIDTH;

  const [month, setMonth] = useState('');
  const [rows, setRows] = useState([]);
  const [loadState, setLoadState] = useState({ status: 'loading', message: '' });
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ key: 'sector', ascending: true });
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);
  const [checkingIds, setCheckingIds] = useState(() => new Set());
  const [rowErrors, setRowErrors] = useState({});
  const [isCheckingAll, setIsCheckingAll] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const reload = useCallback(() => setReloadCount((count) => count + 1), []);

  useEffect(() => {
    let isCurrent = true;
    fetchPastoralReports()
      .then((result) => {
        if (!isCurrent) return;
        setMonth(result.month);
        setRows(result.chapters);
        setLoadState({ status: 'success', message: '' });
      })
      .catch((error) => {
        if (isCurrent) setLoadState({ status: 'error', message: error.message });
      });
    return () => {
      isCurrent = false;
    };
  }, [reloadCount]);

  const decoratedRows = useMemo(
    () => rows.map((row) => ({ ...row, displayStatus: displayStatusFor(row, checkingIds.has(row.areaId)) })),
    [rows, checkingIds],
  );

  const summary = useMemo(() => ({
    generated: decoratedRows.filter((row) => row.displayStatus === 'generated').length,
    total: decoratedRows.length,
    ready: decoratedRows.filter((row) => row.isReady).length,
  }), [decoratedRows]);

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = query
      ? decoratedRows.filter((row) => [row.sector, row.cluster, row.chapter].some((value) => value?.toLowerCase().includes(query)))
      : decoratedRows;
    const column = COLUMNS.find((candidate) => candidate.key === sort.key);
    const direction = sort.ascending ? 1 : -1;
    return [...filtered].sort((a, b) => direction * compareValues(column.value(a), column.value(b)) || compareValues(a.chapter, b.chapter));
  }, [decoratedRows, search, sort]);

  const { page, pageCount, pageItems, setPage } = usePagination(visibleRows, pageSize);

  function handleSort(key) {
    setSort((current) => (current.key === key ? { key, ascending: !current.ascending } : { key, ascending: true }));
    setPage(1);
  }

  function handlePageSizeChange(size) {
    setPageSize(size);
    setPage(1);
  }

  const checkChapter = useCallback(async (areaId) => {
    setCheckingIds((current) => new Set(current).add(areaId));
    setRowErrors((current) => ({ ...current, [areaId]: null }));
    try {
      await checkPastoralReport({ areaId });
    } catch (error) {
      if (isMountedRef.current) setRowErrors((current) => ({ ...current, [areaId]: error.message }));
    } finally {
      if (isMountedRef.current) {
        setCheckingIds((current) => {
          const next = new Set(current);
          next.delete(areaId);
          return next;
        });
        reload();
      }
    }
  }, [reload]);

  async function handleCheckAll() {
    const queue = rows.filter((row) => row.isReady).map((row) => row.areaId);
    setIsCheckingAll(true);
    async function worker() {
      while (queue.length > 0 && isMountedRef.current) {
        await checkChapter(queue.shift());
      }
    }
    try {
      await Promise.all(Array.from({ length: CONCURRENT_CHECKS }, worker));
    } finally {
      if (isMountedRef.current) setIsCheckingAll(false);
    }
  }

  function renderRow(row, index) {
    const last = index === pageItems.length - 1;
    const isChecking = checkingIds.has(row.areaId);
    const action = row.isReady && !isChecking && !isCheckingAll
      ? <ActionLink label="Check" icon="refresh-outline" onPress={() => checkChapter(row.areaId)} />
      : null;

    if (!isWide) {
      return (
        <TableRow key={row.areaId} last={last} style={styles.mobileRow}>
          <Text style={styles.chapterText}>{row.chapter}</Text>
          <Text style={styles.mutedText}>{row.sector || 'No sector'}</Text>
          <StatusCell row={row} error={rowErrors[row.areaId]} />
          <Text style={styles.bodyText}>Latest report: {row.latestMonthYear || '—'}</Text>
          <Text style={styles.mutedText}>Last checked: {formatDateTime(row.checkedAt)}</Text>
          {action}
        </TableRow>
      );
    }

    return (
      <TableRow key={row.areaId} last={last}>
        <Text style={[styles.bodyText, { flex: 1.1 }]} numberOfLines={2}>{row.sector || '—'}</Text>
        <Text style={[styles.chapterText, { flex: 1.2 }]} numberOfLines={2}>{row.chapter}</Text>
        <View style={{ flex: 1.7 }}><StatusCell row={row} error={rowErrors[row.areaId]} /></View>
        <Text style={[styles.bodyText, { flex: 1.2 }]} numberOfLines={1}>{row.latestMonthYear || '—'}</Text>
        <Text style={[styles.mutedText, { flex: 1.2 }]} numberOfLines={2}>{formatDateTime(row.checkedAt)}</Text>
        <View style={styles.actionsCell}>{action}</View>
      </TableRow>
    );
  }

  const canCheckAll = summary.ready > 0 && !isCheckingAll;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Monthly Pastoral Reports</Text>
      <Text style={styles.subtitle}>See which chapters have generated their report in OGD this month.</Text>

      {loadState.status === 'success' && (
        <View style={[styles.summaryRow, !isWide && styles.summaryRowStacked]}>
          <Text style={styles.summaryText}>
            {month}: {summary.generated} of {summary.total} chapters generated
          </Text>
          <TouchableOpacity
            onPress={handleCheckAll}
            disabled={!canCheckAll}
            style={[styles.primaryButton, !canCheckAll && styles.primaryButtonDisabled]}
            accessibilityRole="button"
          >
            {isCheckingAll
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.primaryButtonText}>Check All Chapters</Text>}
          </TouchableOpacity>
        </View>
      )}

      {isCheckingAll && <Text style={styles.notice}>Checking each chapter can take a minute or two. Keep this page open until it finishes.</Text>}

      <TextInput
        value={search}
        onChangeText={(text) => {
          setSearch(text);
          setPage(1);
        }}
        placeholder="Search sector or chapter..."
        placeholderTextColor="#94a3b8"
        style={styles.search}
      />

      <TableCard>
        {loadState.status === 'loading' && <ActivityIndicator style={styles.loader} color="#2563eb" />}
        {loadState.status === 'error' && (
          <View style={styles.errorBlock}>
            <Text style={styles.errorText}>{loadState.message}</Text>
            <ActionLink label="Try again" icon="refresh-outline" onPress={reload} />
          </View>
        )}
        {loadState.status === 'success' && (
          <>
            <SortHeader columns={COLUMNS} sort={sort} onSort={handleSort} isWide={isWide} actionsWidth={90} />
            {pageItems.length === 0
              ? <EmptyRow label={rows.length === 0 ? 'No chapters are assigned to your account yet.' : 'No chapters match your search.'} />
              : pageItems.map(renderRow)}
            <TablePagination
              page={page}
              pageCount={pageCount}
              totalCount={visibleRows.length}
              pageSize={pageSize}
              onChange={setPage}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              onPageSizeChange={handlePageSizeChange}
            />
          </>
        )}
      </TableCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: '800', color: '#002060' },
  subtitle: { fontSize: 13, color: '#64748b', marginTop: 4, marginBottom: 14 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 },
  summaryRowStacked: { flexDirection: 'column', alignItems: 'stretch' },
  summaryText: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  primaryButton: { alignItems: 'center', minWidth: 170, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, backgroundColor: '#2563eb' },
  primaryButtonDisabled: { backgroundColor: '#93c5fd' },
  primaryButtonText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  notice: { fontSize: 12, color: '#1d4ed8', marginBottom: 10 },
  search: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 13, marginBottom: 12, color: '#0f172a' },
  loader: { paddingVertical: 32 },
  mobileRow: { flexDirection: 'column', alignItems: 'flex-start', gap: 4 },
  chapterText: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  bodyText: { fontSize: 13, color: '#334155' },
  mutedText: { fontSize: 12, color: '#64748b' },
  statusCell: { alignItems: 'flex-start', gap: 3 },
  statusReason: { fontSize: 12, fontWeight: '600', color: '#b91c1c' },
  statusDetail: { fontSize: 11, color: '#64748b' },
  actionsCell: { width: 90 },
  errorBlock: { padding: 16, gap: 8 },
  errorText: { fontSize: 13, color: '#b91c1c', marginBottom: 8 },
});
