import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { ActionLink, EmptyRow, Pill, TableCard, TablePagination, TableRow, usePagination } from '../components/admin-table';
import { fetchOgdChapters, runOgdTestLogin, saveOgdCredential } from '../lib/ogdApi';

const PAGE_SIZE_OPTIONS = [10, 20, 30, 50, 100, 200];
const WIDE_LAYOUT_MIN_WIDTH = 860;

// Each mode edits one credential; the two pages share everything else.
const MODE_COPY = {
  accounts: {
    title: 'OGD Accounts',
    subtitle: "Set the One Global Data username and password for each chapter.",
    identifierColumn: 'OGD Username',
    identifierLabel: 'OGD username',
    passwordLabel: 'OGD password',
    identifierHint: 'Username used at cfcglobaldata.com',
    missingOther: 'Waiting for Gmail',
    keyboardType: 'default',
    maxIdentifier: 50,
    maxPassword: 50,
  },
  sector: {
    title: 'Sector',
    subtitle: "Assign each chapter's Gmail account and check whether it can sign in to OGD.",
    identifierColumn: 'Gmail',
    identifierLabel: 'Gmail address',
    passwordLabel: 'Gmail App Password',
    identifierHint: 'chapter@gmail.com',
    missingOther: 'Waiting for MSG',
    keyboardType: 'email-address',
    maxIdentifier: 254,
    maxPassword: 40,
    passwordHint: '16-character App Password',
  },
};

const STATUS_STYLES = {
  connected: { label: 'Logged in', color: '#15803d', bg: '#dcfce7' },
  running: { label: 'Logging in…', color: '#1d4ed8', bg: '#dbeafe' },
  failed: { label: 'Failed', color: '#b91c1c', bg: '#fee2e2' },
  idle: { label: 'Not tested', color: '#475569', bg: '#f1f5f9' },
};

const FAILURE_MESSAGES = {
  ogd_bad_credentials: 'OGD rejected the username or password.',
  otp_rejected: 'OGD did not accept the emailed code.',
  otp_not_found: 'No OTP email reached this Gmail in time.',
  gmail_bad_password: 'Google rejected this Gmail address and App Password. Check them, or create a new App Password.',
  gmail_connection_error: 'Could not connect to Gmail. Please try again.',
  unexpected_page: 'OGD showed a page the automation does not recognize.',
  run_interrupted: 'The last login did not finish. Please try again.',
  automation_error: 'The automated browser hit an error.',
};

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString() : 'Never';
}

function setupLabel(row, copy) {
  if (!row.ownConfigured) return 'Not set';
  return row.otherConfigured ? 'Ready' : copy.missingOther;
}

function compareValues(a, b) {
  return String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' });
}

function buildColumns(copy) {
  return [
    { key: 'sector', label: 'Sector', flex: 1.1, value: (row) => row.sector },
    { key: 'chapter', label: 'Chapter', flex: 1.2, value: (row) => row.chapter },
    { key: 'identifier', label: copy.identifierColumn, flex: 1.5, value: (row) => row.identifier },
    { key: 'setup', label: 'Setup', flex: 1, value: (row) => setupLabel(row, copy) },
    { key: 'status', label: 'OGD Status', flex: 1.6, value: (row) => STATUS_STYLES[row.status].label },
    { key: 'lastAttemptAt', label: 'Last Attempt', flex: 1.2, value: (row) => row.lastAttemptAt },
  ];
}

const APP_PASSWORD_STEPS = [
  { text: "Sign in to the chapter's Gmail account in your browser." },
  { text: 'Turn on 2-Step Verification for that account.', link: { label: 'Open Google Account security', url: 'https://myaccount.google.com/security' } },
  { text: 'Go to App Passwords, enter a name such as "OGD Portal", and create it.', link: { label: 'Open App Passwords', url: 'https://myaccount.google.com/apppasswords' } },
  { text: 'Copy the 16-character password Google shows. It is displayed only once.' },
  { text: 'In the table below, choose "Set up" on the chapter, then enter the Gmail address and the App Password. Do not use the normal Gmail password.' },
  { text: 'Once MSG has set the OGD Account for that chapter, choose "Test Login".' },
];

const APP_PASSWORD_NOTES = [
  'IMAP needs no setup. Gmail keeps it turned on, and this app uses it to read the OTP email.',
  "Changing the Gmail account's password cancels its App Passwords. Create a new one and save it here.",
  'App Passwords may not be available on work or school accounts, or on accounts using Advanced Protection or security keys only.',
];

async function openExternalLink(url) {
  try {
    await Linking.openURL(url);
  } catch (error) {
    console.warn('Could not open link', error?.message);
  }
}

function AppPasswordGuide() {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <View style={styles.guide}>
      <TouchableOpacity
        style={styles.guideHeader}
        onPress={() => setIsOpen((open) => !open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
      >
        <Ionicons name="information-circle-outline" size={18} color="#1d4ed8" />
        <Text style={styles.guideTitle}>How to connect a chapter&apos;s Gmail (App Password + IMAP)</Text>
        <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color="#1d4ed8" />
      </TouchableOpacity>
      {isOpen && (
        <View style={styles.guideBody}>
          {APP_PASSWORD_STEPS.map((step, index) => (
            <View key={step.text} style={styles.guideStep}>
              <Text style={styles.guideNumber}>{index + 1}.</Text>
              <View style={styles.guideStepBody}>
                <Text style={styles.guideText}>{step.text}</Text>
                {!!step.link && (
                  <TouchableOpacity onPress={() => openExternalLink(step.link.url)} accessibilityRole="link">
                    <Text style={styles.guideLink}>{step.link.label}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))}
          <Text style={styles.guideNotesTitle}>Good to know</Text>
          {APP_PASSWORD_NOTES.map((note) => (
            <Text key={note} style={styles.guideNote}>• {note}</Text>
          ))}
        </View>
      )}
    </View>
  );
}

function SortHeader({ columns, sort, onSort, isWide }) {
  return (
    <View style={isWide ? styles.headerRow : styles.sortChipRow}>
      {columns.map((column) => {
        const active = sort.key === column.key;
        return (
          <TouchableOpacity
            key={column.key}
            onPress={() => onSort(column.key)}
            style={isWide ? [styles.headerCell, { flex: column.flex }] : [styles.sortChip, active && styles.sortChipActive]}
            accessibilityRole="button"
            accessibilityLabel={`Sort by ${column.label}`}
          >
            <Text style={styles.headerText} numberOfLines={1}>{column.label}</Text>
            {active && <Ionicons name={sort.ascending ? 'arrow-up' : 'arrow-down'} size={11} color="#334155" style={styles.sortIcon} />}
          </TouchableOpacity>
        );
      })}
      {isWide && <View style={styles.actionsHeader}><Text style={styles.headerText}>Actions</Text></View>}
    </View>
  );
}

function StatusCell({ row }) {
  const style = STATUS_STYLES[row.status];
  const reason = row.status === 'failed' ? FAILURE_MESSAGES[row.failureCode] : null;
  return (
    <View style={styles.statusCell}>
      <Pill label={style.label} color={style.color} bg={style.bg} />
      {!!reason && <Text style={styles.statusReason}>{reason}</Text>}
      {!!row.statusDetail && <Text style={styles.statusDetail}>{row.statusDetail}</Text>}
      {!!row.lastSuccessAt && <Text style={styles.statusDetail}>Last success: {formatDateTime(row.lastSuccessAt)}</Text>}
    </View>
  );
}

function RowActions({ row, copy, isTesting, onEdit, onTest }) {
  const canTest = row.ownConfigured && row.otherConfigured && row.status !== 'running';
  return (
    <View style={styles.actions}>
      <ActionLink label={row.ownConfigured ? 'Change' : 'Set up'} icon="key-outline" onPress={() => onEdit(row)} />
      {isTesting ? (
        <ActivityIndicator size="small" color="#2563eb" accessibilityLabel={`Testing ${copy.title}`} />
      ) : canTest ? (
        <ActionLink label="Test Login" icon="log-in-outline" onPress={() => onTest(row)} />
      ) : null}
    </View>
  );
}

function CredentialModal({ row, scope, copy, onClose, onSaved }) {
  const [identifier, setIdentifier] = useState(row.identifier ?? '');
  const [password, setPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [saveState, setSaveState] = useState({ status: 'idle', message: '' });

  async function handleSave() {
    if (!identifier.trim() || !password) {
      setSaveState({ status: 'error', message: 'Please fill in both fields.' });
      return;
    }
    setSaveState({ status: 'loading', message: '' });
    try {
      await saveOgdCredential({ scope, areaId: row.areaId, identifier, password });
      setSaveState({ status: 'success', message: '' });
      onSaved();
    } catch (error) {
      setSaveState({ status: 'error', message: error.message });
    }
  }

  const isSaving = saveState.status === 'loading';

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{row.chapter}</Text>
          {!!row.sector && <Text style={styles.modalSubtitle}>{row.sector}</Text>}

          <Text style={styles.fieldLabel}>{copy.identifierLabel}</Text>
          <TextInput
            value={identifier}
            onChangeText={setIdentifier}
            placeholder={copy.identifierHint}
            placeholderTextColor="#94a3b8"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType={copy.keyboardType}
            maxLength={copy.maxIdentifier}
            style={styles.input}
          />

          <Text style={styles.fieldLabel}>{copy.passwordLabel}</Text>
          <View style={styles.passwordRow}>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!isPasswordVisible}
              placeholder={row.ownConfigured ? 'Enter the password again to save' : (copy.passwordHint ?? '')}
              placeholderTextColor="#94a3b8"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              maxLength={copy.maxPassword}
              style={styles.passwordInput}
            />
            <TouchableOpacity
              onPress={() => setIsPasswordVisible((visible) => !visible)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={isPasswordVisible ? 'Hide password' : 'Show password'}
            >
              <Ionicons name={isPasswordVisible ? 'eye-off-outline' : 'eye-outline'} size={18} color="#64748b" />
            </TouchableOpacity>
          </View>

          <Text style={styles.privacyNote}>
            Stored encrypted and used only to sign this chapter in to OGD. It can&apos;t be viewed again after saving.
          </Text>
          {saveState.status === 'error' && <Text style={styles.errorText}>{saveState.message}</Text>}

          <View style={styles.modalActions}>
            <TouchableOpacity onPress={onClose} disabled={isSaving} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleSave} disabled={isSaving} style={styles.primaryButton}>
              {isSaving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryButtonText}>Save</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function OgdConnections({ scope }) {
  const copy = MODE_COPY[scope];
  const columns = useMemo(() => buildColumns(copy), [copy]);
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_LAYOUT_MIN_WIDTH;

  const [rows, setRows] = useState([]);
  const [loadState, setLoadState] = useState({ status: 'loading', message: '' });
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ key: 'sector', ascending: true });
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);
  const [editingRow, setEditingRow] = useState(null);
  const [testingIds, setTestingIds] = useState(() => new Set());
  const [notice, setNotice] = useState(null);
  const [reloadCount, setReloadCount] = useState(0);

  const loadRows = useCallback(() => setReloadCount((count) => count + 1), []);

  useEffect(() => {
    let isCurrent = true;
    fetchOgdChapters(scope)
      .then((chapters) => {
        if (!isCurrent) return;
        setRows(chapters);
        setLoadState({ status: 'success', message: '' });
      })
      .catch((error) => {
        if (isCurrent) setLoadState({ status: 'error', message: error.message });
      });
    return () => {
      isCurrent = false;
    };
  }, [scope, reloadCount]);

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = query
      ? rows.filter((row) => [row.sector, row.cluster, row.chapter, row.identifier].some((value) => value?.toLowerCase().includes(query)))
      : rows;
    const column = columns.find((candidate) => candidate.key === sort.key);
    const direction = sort.ascending ? 1 : -1;
    return [...filtered].sort((a, b) => direction * compareValues(column.value(a), column.value(b)) || compareValues(a.chapter, b.chapter));
  }, [rows, search, columns, sort]);

  const { page, pageCount, pageItems, setPage } = usePagination(visibleRows, pageSize);

  function handleSort(key) {
    setSort((current) => (current.key === key ? { key, ascending: !current.ascending } : { key, ascending: true }));
    setPage(1);
  }

  function handlePageSizeChange(size) {
    setPageSize(size);
    setPage(1);
  }

  async function handleTest(row) {
    setNotice(null);
    setTestingIds((current) => new Set(current).add(row.areaId));
    setRows((current) => current.map((item) => (item.areaId === row.areaId ? { ...item, status: 'running', failureCode: null, statusDetail: null } : item)));
    try {
      await runOgdTestLogin({ scope, areaId: row.areaId });
    } catch (error) {
      setNotice(`${row.chapter}: ${error.message}`);
    } finally {
      setTestingIds((current) => {
        const next = new Set(current);
        next.delete(row.areaId);
        return next;
      });
      loadRows();
    }
  }

  function handleSaved() {
    setEditingRow(null);
    loadRows();
  }

  function renderRow(row, index) {
    const last = index === pageItems.length - 1;
    const isTesting = testingIds.has(row.areaId);
    const actions = <RowActions row={row} copy={copy} isTesting={isTesting} onEdit={setEditingRow} onTest={handleTest} />;

    if (!isWide) {
      return (
        <TableRow key={row.areaId} last={last} style={styles.mobileRow}>
          <Text style={styles.chapterText}>{row.chapter}</Text>
          <Text style={styles.mutedText}>{row.sector || 'No sector'}</Text>
          <Text style={styles.bodyText}>{copy.identifierColumn}: {row.identifier || 'Not set'}</Text>
          <Text style={styles.mutedText}>Setup: {setupLabel(row, copy)}</Text>
          <StatusCell row={row} />
          <Text style={styles.mutedText}>Last attempt: {formatDateTime(row.lastAttemptAt)}</Text>
          {actions}
        </TableRow>
      );
    }

    return (
      <TableRow key={row.areaId} last={last}>
        <Text style={[styles.bodyText, { flex: 1.1 }]} numberOfLines={2}>{row.sector || '—'}</Text>
        <Text style={[styles.chapterText, { flex: 1.2 }]} numberOfLines={2}>{row.chapter}</Text>
        <Text style={[styles.bodyText, { flex: 1.5 }]} numberOfLines={1}>{row.identifier || 'Not set'}</Text>
        <Text style={[styles.bodyText, { flex: 1 }]} numberOfLines={2}>{setupLabel(row, copy)}</Text>
        <View style={{ flex: 1.6 }}><StatusCell row={row} /></View>
        <Text style={[styles.mutedText, { flex: 1.2 }]} numberOfLines={2}>{formatDateTime(row.lastAttemptAt)}</Text>
        <View style={styles.actionsCell}>{actions}</View>
      </TableRow>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.subtitle}>{copy.subtitle}</Text>

      {scope === 'sector' && <AppPasswordGuide />}

      <TextInput
        value={search}
        onChangeText={(text) => {
          setSearch(text);
          setPage(1);
        }}
        placeholder="Search sector, chapter, or account..."
        placeholderTextColor="#94a3b8"
        style={styles.search}
      />

      {!!notice && <Text style={styles.errorText}>{notice}</Text>}

      <TableCard>
        {loadState.status === 'loading' && <ActivityIndicator style={styles.loader} color="#2563eb" />}
        {loadState.status === 'error' && (
          <View style={styles.errorBlock}>
            <Text style={styles.errorText}>{loadState.message}</Text>
            <ActionLink label="Try again" icon="refresh-outline" onPress={loadRows} />
          </View>
        )}
        {loadState.status === 'success' && (
          <>
            <SortHeader columns={columns} sort={sort} onSort={handleSort} isWide={isWide} />
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

      {!!editingRow && (
        <CredentialModal row={editingRow} scope={scope} copy={copy} onClose={() => setEditingRow(null)} onSaved={handleSaved} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: '800', color: '#002060' },
  subtitle: { fontSize: 13, color: '#64748b', marginTop: 4, marginBottom: 14 },
  guide: { backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', borderRadius: 10, marginBottom: 12 },
  guideHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12 },
  guideTitle: { flex: 1, fontSize: 13, fontWeight: '700', color: '#1e3a8a' },
  guideBody: { paddingHorizontal: 12, paddingBottom: 12, gap: 8 },
  guideStep: { flexDirection: 'row', gap: 6 },
  guideNumber: { fontSize: 13, fontWeight: '700', color: '#1e3a8a', width: 18 },
  guideStepBody: { flex: 1, gap: 2 },
  guideText: { fontSize: 13, color: '#334155' },
  guideLink: { fontSize: 13, fontWeight: '600', color: '#2563eb', textDecorationLine: 'underline' },
  guideNotesTitle: { fontSize: 12, fontWeight: '700', color: '#1e3a8a', marginTop: 4 },
  guideNote: { fontSize: 12, color: '#475569' },
  search: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 13, marginBottom: 12, color: '#0f172a' },
  loader: { paddingVertical: 32 },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#f8fafc', gap: 8 },
  headerCell: { flexDirection: 'row', alignItems: 'center' },
  headerText: { fontSize: 11, fontWeight: '700', color: '#475569' },
  sortIcon: { marginLeft: 3 },
  actionsHeader: { width: 170 },
  sortChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 12 },
  sortChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: '#f1f5f9' },
  sortChipActive: { backgroundColor: '#dbeafe' },
  mobileRow: { flexDirection: 'column', alignItems: 'flex-start', gap: 4 },
  chapterText: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  bodyText: { fontSize: 13, color: '#334155' },
  mutedText: { fontSize: 12, color: '#64748b' },
  statusCell: { alignItems: 'flex-start', gap: 3 },
  statusReason: { fontSize: 12, fontWeight: '600', color: '#b91c1c' },
  statusDetail: { fontSize: 11, color: '#64748b' },
  actionsCell: { width: 170 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 2 },
  errorBlock: { padding: 16, gap: 8 },
  errorText: { fontSize: 13, color: '#b91c1c', marginBottom: 8 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modalCard: { width: '100%', maxWidth: 420, backgroundColor: '#fff', borderRadius: 14, padding: 20 },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#002060' },
  modalSubtitle: { fontSize: 12, color: '#64748b', marginTop: 2 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: '#334155', marginTop: 14, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: '#0f172a' },
  passwordRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, paddingRight: 12 },
  passwordInput: { flex: 1, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: '#0f172a' },
  privacyNote: { fontSize: 11, color: '#64748b', marginTop: 12, marginBottom: 8 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 8 },
  secondaryButton: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, backgroundColor: '#f1f5f9' },
  secondaryButtonText: { fontSize: 13, fontWeight: '700', color: '#334155' },
  primaryButton: { minWidth: 76, alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, backgroundColor: '#2563eb' },
  primaryButtonText: { fontSize: 13, fontWeight: '700', color: '#fff' },
});
