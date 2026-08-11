import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, Platform, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

// Shared visual language for every list/table under Administration (Portal
// Users, Roles & Page Access, Areas): a rounded white card, colored icon
// badges, pill statuses, a left-accent bar on the selected row, and a
// pagination footer — modeled on a reference course-table design, but
// using this app's own navy/blue brand colors rather than the source's teal.

export const TABLE_NAVY = '#002060';
export const TABLE_ACCENT = '#2563eb';
export const TABLE_ACCENT_BG = '#eff6ff';

export function TableCard({ title, subtitle, right, children, style }) {
  return (
    <View style={[styles.card, style]}>
      {(title || right) && (
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            {!!title && <Text style={styles.cardTitle}>{title}</Text>}
            {!!subtitle && <Text style={styles.cardSubtitle}>{subtitle}</Text>}
          </View>
          {!!right && <View style={styles.cardHeaderRight}>{right}</View>}
        </View>
      )}
      {children}
    </View>
  );
}

// columns: [{ key, label, style }]
export function TableHeaderRow({ columns }) {
  return (
    <View style={styles.headerRow}>
      {columns.map((col) => (
        <Text key={col.key} style={[styles.headerCell, col.style]} numberOfLines={1}>{col.label}</Text>
      ))}
    </View>
  );
}

export function TableRow({ selected, onPress, children, style, last }) {
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper
      {...(onPress ? { onPress, activeOpacity: 0.7 } : {})}
      style={[styles.row, last && styles.rowLast, selected && styles.rowSelected, style]}
    >
      {selected && <View style={styles.rowAccent} />}
      {children}
    </Wrapper>
  );
}

export function IconBadge({ name, color = TABLE_ACCENT, bg = TABLE_ACCENT_BG, size = 34 }) {
  return (
    <View style={[styles.iconBadge, { backgroundColor: bg, width: size, height: size, borderRadius: size * 0.3 }]}>
      <Ionicons name={name} size={size * 0.5} color={color} />
    </View>
  );
}

export function InitialsBadge({ text, color = TABLE_ACCENT, bg = TABLE_ACCENT_BG, size = 34 }) {
  return (
    <View style={[styles.iconBadge, { backgroundColor: bg, width: size, height: size, borderRadius: size * 0.3 }]}>
      <Text style={{ color, fontWeight: '800', fontSize: size * 0.36 }}>{text}</Text>
    </View>
  );
}

export function Pill({ label, color = '#334155', bg = '#f1f5f9' }) {
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillText, { color }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

export function ActionLink({ label, onPress, color = TABLE_ACCENT, icon }) {
  return (
    <TouchableOpacity style={styles.actionLink} onPress={onPress}>
      {!!icon && <Ionicons name={icon} size={13} color={color} style={{ marginRight: 4 }} />}
      <Text style={[styles.actionLinkText, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function EmptyRow({ label }) {
  return (
    <View style={styles.emptyRow}>
      <Text style={styles.emptyRowText}>{label}</Text>
    </View>
  );
}

function csvEscape(value) {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

// columns: [{ key, label }] — reads row[key] unless a row itself already
// has a plain string/number at that key (covers most of our data as-is).
function rowsToCsv(columns, rows) {
  const header = columns.map((c) => csvEscape(c.label)).join(',');
  const lines = rows.map((row) => columns.map((c) => csvEscape(row[c.key])).join(','));
  return [header, ...lines].join('\r\n');
}

// Exports a table's visible columns as CSV. On web this downloads a .csv
// file directly. Native has no bundled file-system/sharing-to-Files setup
// in this app, so it falls back to the OS share sheet with the raw CSV
// text — good enough to forward into Sheets/Excel via AirDrop/email, but
// not a true file download.
export async function exportCsv(filename, columns, rows) {
  const csv = rowsToCsv(columns, rows);
  const fullName = filename.endsWith('.csv') ? filename : `${filename}.csv`;

  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fullName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return;
  }

  try {
    await Share.share({ message: csv, title: fullName });
  } catch (err) {
    Alert.alert('Export Failed', err.message);
  }
}

export function ExportButton({ onPress, label = 'Export' }) {
  return (
    <TouchableOpacity style={styles.exportBtn} onPress={onPress}>
      <Ionicons name="download-outline" size={14} color="#334155" style={{ marginRight: 4 }} />
      <Text style={styles.exportBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

// Client-side pager: give it the full array + a page size, it returns the
// current page's slice plus the footer to render.
export function usePagination(items, pageSize = 10) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageItems = items.slice((safePage - 1) * pageSize, safePage * pageSize);
  return { page: safePage, pageCount, pageItems, setPage };
}

export function TablePagination({ page, pageCount, totalCount, pageSize, onChange }) {
  if (totalCount === 0) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalCount);
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1);
  return (
    <View style={styles.paginationRow}>
      <Text style={styles.paginationLabel}>{start} to {end} of {totalCount} records</Text>
      {pageCount > 1 && (
        <View style={styles.paginationControls}>
          <TouchableOpacity disabled={page <= 1} onPress={() => onChange(page - 1)} style={styles.pageArrow}>
            <Ionicons name="chevron-back" size={14} color={page <= 1 ? '#cbd5e1' : '#334155'} />
          </TouchableOpacity>
          {pages.map((p) => (
            <TouchableOpacity key={p} onPress={() => onChange(p)} style={[styles.pageChip, p === page && styles.pageChipActive]}>
              <Text style={[styles.pageChipText, p === page && styles.pageChipTextActive]}>{p}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity disabled={page >= pageCount} onPress={() => onChange(page + 1)} style={styles.pageArrow}>
            <Ionicons name="chevron-forward" size={14} color={page >= pageCount ? '#cbd5e1' : '#334155'} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff', borderRadius: 20, borderWidth: 1, borderColor: '#eef1f6',
    ...Platform.select({
      web: { boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 8px 24px rgba(15,23,42,0.04)' },
      default: { shadowColor: '#0f172a', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
    }),
    overflow: 'hidden',
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', padding: 16, paddingBottom: 12, flexWrap: 'wrap', gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#0f172a' },
  cardSubtitle: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  cardHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  headerRow: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10,
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#f1f5f9', backgroundColor: '#fafbfc',
  },
  headerCell: { fontSize: 10, fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4 },

  row: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#f4f6f9', position: 'relative',
  },
  rowLast: { borderBottomWidth: 0 },
  rowSelected: { backgroundColor: '#eff6ff' },
  rowAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: TABLE_ACCENT },

  iconBadge: { alignItems: 'center', justifyContent: 'center' },

  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, alignSelf: 'flex-start' },
  pillText: { fontSize: 11, fontWeight: '700' },

  actionLink: { flexDirection: 'row', alignItems: 'center' },
  actionLinkText: { fontSize: 12, fontWeight: '700' },

  emptyRow: { padding: 20, alignItems: 'center' },
  emptyRowText: { fontSize: 12, color: '#94a3b8' },

  exportBtn: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 10,
    borderRadius: 8, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0',
  },
  exportBtnText: { fontSize: 12, fontWeight: '700', color: '#334155' },

  paginationRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, flexWrap: 'wrap', gap: 8,
  },
  paginationLabel: { fontSize: 11, color: '#94a3b8', fontWeight: '600' },
  paginationControls: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pageArrow: {
    width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0',
  },
  pageChip: { minWidth: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  pageChipActive: { backgroundColor: TABLE_NAVY },
  pageChipText: { fontSize: 11, fontWeight: '700', color: '#334155' },
  pageChipTextActive: { color: '#ffffff' },
});
