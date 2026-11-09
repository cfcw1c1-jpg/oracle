import { supabase } from './supabase';

const PAGE_SIZE = 1000;

// PostgREST caps a response at 1000 rows and silently truncates past that, so
// tables that can grow are paged through. Pass a unique column in orderBy, or
// rows can land on both sides of a page boundary.
export async function fetchAllRows(table, selectExpr, { orderBy } = {}) {
  const columns = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
  let all = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase.from(table).select(selectExpr);
    columns.forEach((column) => {
      query = query.order(column, { ascending: true });
    });
    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    all = all.concat(data || []);
    if ((data || []).length < PAGE_SIZE) return all;
  }
}

// Removes characters that carry meaning inside a PostgREST or() filter, so
// typed search text can't alter the query.
export function searchTerm(text) {
  return String(text || '').replace(/[,()*%"\\]/g, ' ').trim();
}

export function isActiveStatus(status) {
  return !status || status === 'Active';
}

export function fullName(member) {
  return [member?.Firstname, member?.Lastname].filter(Boolean).join(' ');
}

export function formatDateTime(value) {
  return value ? new Date(value).toLocaleString() : 'Never';
}

export function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : '—';
}

export function showAlert(title, message) {
  window.alert(message ? `${title}\n\n${message}` : title);
}

export function confirmAction(title, message) {
  return window.confirm(message ? `${title}\n\n${message}` : title);
}

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// columns: [{ key, label, value?(row) }]
export function exportCsv(filename, columns, rows) {
  const header = columns.map((column) => csvEscape(column.label)).join(',');
  const lines = rows.map((row) => columns.map((column) => csvEscape(column.value ? column.value(row) : row[column.key])).join(','));
  downloadBlob(new Blob([[header, ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8;' }), filename.endsWith('.csv') ? filename : `${filename}.csv`);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
