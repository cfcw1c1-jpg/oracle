import { onBeforeUnmount, onMounted, ref } from 'vue';
import { showAlert } from './data';
import { supabase } from './supabase';

const COLUMNS = 'id, table_name, record_id, action, actor_email, old_data, new_data, changed_at';

export const ACTION_TONE = { INSERT: 'success', UPDATE: 'info', DELETE: 'danger', PAGE_VIEW: 'accent' };

export function formatLogTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

export function formatDiffValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function filledEntries(data) {
  return Object.entries(data || {}).filter(([, value]) => value !== null && value !== '' && value !== undefined);
}

// Only what changed, since pfo_members alone has over a hundred columns.
export function computeDiff(log) {
  if (log.action === 'INSERT') return filledEntries(log.new_data).map(([key, value]) => ({ key, from: null, to: value }));
  if (log.action === 'DELETE') return filledEntries(log.old_data).map(([key, value]) => ({ key, from: value, to: null }));
  const before = log.old_data || {};
  const after = log.new_data || {};
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => ({ key, from: before[key], to: after[key] }));
}

export function describeChanges(log) {
  return computeDiff(log).map((diff) => `${diff.key}: ${formatDiffValue(diff.from)} -> ${formatDiffValue(diff.to)}`).join('; ');
}

// Loads recent audit rows and adds new ones live. tableName narrows both.
export function useAuditLog({ channelName, tableName, errorTitle }) {
  const logs = ref([]);
  const isLoading = ref(true);
  let channel;

  async function load() {
    isLoading.value = true;
    try {
      let query = supabase.from('audit_log').select(COLUMNS).order('changed_at', { ascending: false }).limit(300);
      if (tableName) query = query.eq('table_name', tableName);
      const { data, error } = await query;
      if (error) throw error;
      logs.value = data || [];
    } catch (error) {
      showAlert(errorTitle, error.message);
    } finally {
      isLoading.value = false;
    }
  }

  onMounted(() => {
    load();
    channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_log', ...(tableName ? { filter: `table_name=eq.${tableName}` } : {}) }, (payload) => {
        // Opening a page logs a row, which can arrive through both routes.
        if (!logs.value.some((log) => log.id === payload.new.id)) logs.value = [payload.new, ...logs.value].slice(0, 500);
      })
      .subscribe();
  });
  onBeforeUnmount(() => supabase.removeChannel(channel));

  return { logs, isLoading };
}
