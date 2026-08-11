import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { csvRowsToObjects, parseCsv } from '../lib/csv';
import { supabase } from '../../lib/supabase';
import { EmptyRow, Pill, TableCard } from '../components/admin-table';

const NAVY = '#002060';
const ACCENT_BLUE = '#2563eb';

// The only members columns a roster CSV is expected to carry. MemberIDNo is
// the match key, handled separately. Gender/YearRegistered/Status aren't
// exported by the usual roster sheet, so they're never touched here.
const MEMBERS_FIELDS = ['Lastname', 'Firstname', 'PastoralService', 'AreaName', 'NameOfHouseholdHead'];

function showAlert(title, message) {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
}

// Imports a roster/PFO-progress CSV into members + pfo_members, keyed by
// MemberIDNo. Blank cells never clear existing data — a cell only ever
// writes a value when the CSV actually has one, so re-importing an older
// or partial export can't wipe out progress recorded elsewhere. Each row
// is its own upsert (not one big batch) specifically so that omitted
// columns are guaranteed to stay untouched rather than risk PostgREST
// filling gaps across a batch with nulls.
export default function ImportCsv() {
  const [schemaLoading, setSchemaLoading] = useState(true);
  const [knownPfoColumns, setKnownPfoColumns] = useState(null);

  const [fileName, setFileName] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [records, setRecords] = useState([]);

  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState(null);

  useEffect(() => {
    loadSchema();
  }, []);

  // pfo_members has ~115 talk columns and Postgres silently truncates any
  // identifier longer than 63 characters, so a few of those column names
  // no longer match their own CSV header text exactly. Reading a live row
  // gives us the real (possibly truncated) names to match against, instead
  // of hand-copying a column list that could silently drift from the DB.
  async function loadSchema() {
    try {
      const { data, error } = await supabase.from('pfo_members').select('*').limit(1);
      if (error) throw error;
      if (data && data.length > 0) {
        const cols = new Set(Object.keys(data[0]));
        cols.delete('MemberIDNo');
        setKnownPfoColumns(cols);
      } else {
        setKnownPfoColumns(null);
      }
    } catch (err) {
      console.error('Error loading pfo_members schema:', err.message);
      setKnownPfoColumns(null);
    } finally {
      setSchemaLoading(false);
    }
  }

  function triggerFilePicker() {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      showAlert('Not Supported', 'CSV import is currently only available on the web app.');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv';
    input.onchange = (e) => {
      const file = e.target.files?.[0];
      if (file) handleFileSelected(file);
    };
    input.click();
  }

  function handleFileSelected(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const rows = parseCsv(text);
      const parsed = csvRowsToObjects(rows);
      if (parsed.headers.length === 0) {
        showAlert('Empty File', 'That file has no rows.');
        return;
      }
      if (!parsed.headers.includes('MemberIDNo')) {
        showAlert('Missing Column', 'This CSV has no "MemberIDNo" column, which is required to match records.');
        return;
      }
      setFileName(file.name);
      setHeaders(parsed.headers);
      setRecords(parsed.records);
      setResults(null);
    };
    reader.onerror = () => showAlert('Read Failed', 'Could not read the selected file.');
    reader.readAsText(file);
  }

  function reset() {
    setFileName(null);
    setHeaders([]);
    setRecords([]);
    setResults(null);
  }

  const memberFieldHeaders = MEMBERS_FIELDS.filter((f) => headers.includes(f));

  const pfoColumnMap = {};
  const unrecognizedColumns = [];
  headers.forEach((h) => {
    if (h === 'MemberIDNo' || MEMBERS_FIELDS.includes(h)) return;
    if (knownPfoColumns == null) {
      pfoColumnMap[h] = h;
      return;
    }
    if (knownPfoColumns.has(h)) {
      pfoColumnMap[h] = h;
      return;
    }
    let bestMatch = null;
    knownPfoColumns.forEach((col) => {
      if (h.startsWith(col) && (!bestMatch || col.length > bestMatch.length)) bestMatch = col;
    });
    if (bestMatch) pfoColumnMap[h] = bestMatch;
    else unrecognizedColumns.push(h);
  });

  const validRecords = records.filter((r) => r.MemberIDNo && r.MemberIDNo.trim());
  const skippedCount = records.length - validRecords.length;

  async function handleImport() {
    if (validRecords.length === 0) return;
    setImporting(true);
    setProgress({ done: 0, total: validRecords.length });

    let membersUpserted = 0;
    let pfoUpserted = 0;
    const errors = [];

    for (let i = 0; i < validRecords.length; i++) {
      const record = validRecords[i];
      const memberId = record.MemberIDNo.trim();

      const memberPayload = { MemberIDNo: memberId };
      memberFieldHeaders.forEach((field) => {
        if (record[field]) memberPayload[field] = record[field];
      });
      try {
        const { error } = await supabase.from('members').upsert([memberPayload], { onConflict: 'MemberIDNo' });
        if (error) throw error;
        membersUpserted += 1;
      } catch (err) {
        errors.push(`${memberId}: ${err.message}`);
      }

      const pfoPayload = { MemberIDNo: memberId };
      let hasTalk = false;
      Object.entries(pfoColumnMap).forEach(([csvHeader, dbColumn]) => {
        if (record[csvHeader]) {
          pfoPayload[dbColumn] = record[csvHeader];
          hasTalk = true;
        }
      });
      if (hasTalk) {
        try {
          const { error } = await supabase.from('pfo_members').upsert([pfoPayload], { onConflict: 'MemberIDNo' });
          if (error) throw error;
          pfoUpserted += 1;
        } catch (err) {
          errors.push(`${memberId} (PFO): ${err.message}`);
        }
      }

      setProgress({ done: i + 1, total: validRecords.length });
    }

    setResults({ membersUpserted, pfoUpserted, skipped: skippedCount, errors });
    setImporting(false);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Ionicons name="cloud-upload-outline" size={22} color="#0f172a" style={styles.titleIcon} />
          <Text style={styles.title}>Import CSV</Text>
        </View>
        <Text style={styles.subtitle}>
          Upload a roster/PFO-progress CSV to update the Directory and formation records, matched by MemberIDNo.
        </Text>
      </View>

      <View style={styles.body}>
        <TableCard title="1. Choose File">
          <View style={styles.cardBody}>
            <View style={styles.pickerRow}>
              <TouchableOpacity style={styles.pickBtn} onPress={triggerFilePicker} disabled={importing}>
                <Ionicons name="document-attach-outline" size={16} color="#ffffff" style={{ marginRight: 8 }} />
                <Text style={styles.pickBtnText}>Choose CSV File</Text>
              </TouchableOpacity>
              {!!fileName && (
                <View style={styles.fileChip}>
                  <Ionicons name="document-text-outline" size={14} color="#334155" style={{ marginRight: 6 }} />
                  <Text style={styles.fileChipText} numberOfLines={1}>{fileName}</Text>
                  <TouchableOpacity onPress={reset} disabled={importing} style={{ marginLeft: 8 }}>
                    <Ionicons name="close-circle" size={16} color="#94a3b8" />
                  </TouchableOpacity>
                </View>
              )}
            </View>
            {schemaLoading && <Text style={styles.hintText}>Loading current column definitions…</Text>}
            {Platform.OS !== 'web' && (
              <Text style={styles.hintText}>CSV import is only available on the web app right now.</Text>
            )}
          </View>
        </TableCard>

        {fileName && (
          <TableCard title="2. Preview" subtitle={`${records.length} row${records.length === 1 ? '' : 's'} found`}>
            <View style={styles.cardBody}>
              <View style={styles.statsRow}>
                <Pill label={`${validRecords.length} ready to import`} color="#15803d" bg="#dcfce7" />
                {skippedCount > 0 && (
                  <Pill label={`${skippedCount} skipped (no MemberIDNo)`} color="#b45309" bg="#fef3c7" />
                )}
                <Pill label={`${memberFieldHeaders.length} member field${memberFieldHeaders.length === 1 ? '' : 's'}`} color="#334155" bg="#f1f5f9" />
                <Pill label={`${Object.keys(pfoColumnMap).length} PFO column${Object.keys(pfoColumnMap).length === 1 ? '' : 's'}`} color="#334155" bg="#f1f5f9" />
              </View>

              {unrecognizedColumns.length > 0 && (
                <View style={styles.warningBox}>
                  <Ionicons name="warning-outline" size={14} color="#b45309" style={{ marginRight: 6 }} />
                  <Text style={styles.warningText}>
                    {unrecognizedColumns.length} column{unrecognizedColumns.length === 1 ? '' : 's'} not recognized and will be ignored: {unrecognizedColumns.join(', ')}
                  </Text>
                </View>
              )}

              <Text style={styles.subSectionLabel}>First Rows</Text>
              {validRecords.slice(0, 5).map((r, idx) => (
                <Text key={idx} style={styles.previewRowText} numberOfLines={1}>
                  {r.Lastname || '—'}, {r.Firstname || '—'}  ·  {r.MemberIDNo}  ·  {r.AreaName || '—'}
                </Text>
              ))}
              {validRecords.length > 5 && (
                <Text style={styles.hintText}>…and {validRecords.length - 5} more.</Text>
              )}

              <TouchableOpacity
                style={[styles.importBtn, (importing || validRecords.length === 0) && styles.importBtnDisabled]}
                onPress={handleImport}
                disabled={importing || validRecords.length === 0}
              >
                {importing ? (
                  <>
                    <ActivityIndicator color="#fff" size="small" style={{ marginRight: 8 }} />
                    <Text style={styles.importBtnText}>Importing {progress.done} / {progress.total}…</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="cloud-upload-outline" size={16} color="#ffffff" style={{ marginRight: 8 }} />
                    <Text style={styles.importBtnText}>Import {validRecords.length} Record{validRecords.length === 1 ? '' : 's'}</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </TableCard>
        )}

        {results && (
          <TableCard title="3. Result">
            <View style={styles.cardBody}>
              <View style={styles.statsRow}>
                <Pill label={`${results.membersUpserted} members updated`} color="#15803d" bg="#dcfce7" />
                <Pill label={`${results.pfoUpserted} PFO records updated`} color="#15803d" bg="#dcfce7" />
                {results.skipped > 0 && <Pill label={`${results.skipped} skipped`} color="#b45309" bg="#fef3c7" />}
                {results.errors.length > 0 && <Pill label={`${results.errors.length} error${results.errors.length === 1 ? '' : 's'}`} color="#b91c1c" bg="#fee2e2" />}
              </View>
              {results.errors.length > 0 && (
                <ScrollView style={styles.errorScroll}>
                  {results.errors.map((e, idx) => (
                    <Text key={idx} style={styles.errorText}>{e}</Text>
                  ))}
                </ScrollView>
              )}
            </View>
          </TableCard>
        )}

        {!fileName && !schemaLoading && (
          <TableCard title="How It Works">
            <EmptyRow label="Choose a CSV with Lastname, Firstname, MemberIDNo, PastoralService, AreaName, NameOfHouseholdHead, and any formation talk columns. Blank cells never overwrite existing data — only non-blank cells are saved." />
          </TableCard>
        )}
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

  body: { paddingHorizontal: 16, paddingBottom: 16, gap: 16 },
  cardBody: { padding: 16 },

  pickerRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  pickBtn: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 16,
    borderRadius: 10, backgroundColor: NAVY,
  },
  pickBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  fileChip: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 12,
    borderRadius: 8, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0', maxWidth: 320,
  },
  fileChipText: { fontSize: 12, fontWeight: '600', color: '#334155', flexShrink: 1 },

  hintText: { fontSize: 12, color: '#94a3b8', marginTop: 10 },

  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  warningBox: {
    flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#fffbeb', borderWidth: 1,
    borderColor: '#fde68a', borderRadius: 10, padding: 10, marginTop: 12,
  },
  warningText: { flex: 1, fontSize: 11, color: '#92400e', lineHeight: 16 },

  subSectionLabel: { fontSize: 12, fontWeight: '700', color: '#334155', marginTop: 16, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 },
  previewRowText: { fontSize: 12, color: '#334155', marginBottom: 4 },

  importBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: ACCENT_BLUE,
    borderRadius: 10, paddingVertical: 12, marginTop: 16,
  },
  importBtnDisabled: { opacity: 0.5 },
  importBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },

  errorScroll: { maxHeight: 160, marginTop: 12 },
  errorText: { fontSize: 11, color: '#b91c1c', marginBottom: 4 },
});
