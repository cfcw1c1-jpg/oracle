<script setup>
import { CheckCircle2, CircleAlert, Clock, Activity, KeyRound, Network, Smartphone, Trash2, UploadCloud } from 'lucide-vue-next';
import { computed, onMounted, reactive, ref } from 'vue';
import LoadingBlock from '@/components/LoadingBlock.vue';
import PageHead from '@/components/PageHead.vue';
import { formatDateTime, showAlert } from '@/lib/data';
import { supabase } from '@/lib/supabase';
import AppUpdateSettings from '@/views/parts/AppUpdateSettings.vue';
import Areas from '@/views/parts/Areas.vue';
import DataHealth from '@/views/parts/DataHealth.vue';
import ImportCsv from '@/views/parts/ImportCsv.vue';
import RolesAccess from '@/views/parts/RolesAccess.vue';

defineProps({ onAccessChanged: { type: Function, default: null } });

const TABS = [
  { key: 'retention', label: 'Log Retention', icon: Clock },
  { key: 'dataHealth', label: 'Data Health', icon: Activity },
  { key: 'rolesAccess', label: 'Roles & Page Access', icon: KeyRound },
  { key: 'areas', label: 'Areas', icon: Network },
  { key: 'csvImport', label: 'Import CSV', icon: UploadCloud },
  { key: 'appUpdate', label: 'App Update', icon: Smartphone },
];

const tab = ref('retention');
const isLoading = ref(true);
const isSaving = ref(false);
const isPurging = ref(false);
const updatedAt = ref(null);
const schedule = ref(null);
const audit = reactive({ days: '365', forever: false });
const lookup = reactive({ days: '90', forever: false });

const retentionFields = [
  { label: 'System Audit Log', description: "Every insert/update/delete and page-view record (Admin's System Audit Log page).", state: audit },
  { label: 'Public Search Logs', description: 'Search activity from the public, unauthenticated Training Lookup page.', state: lookup },
];

const scheduleIsHealthy = computed(() => schedule.value?.available && schedule.value?.scheduled && schedule.value?.active);
const scheduleMessage = computed(() => {
  const status = schedule.value;
  if (!status.available) return 'Automatic scheduling isn’t available on this project (pg_cron isn’t installed) — use "Purge Now" manually, or trigger it from an external scheduler.';
  if (!status.scheduled) return 'pg_cron is available, but the daily purge isn’t scheduled yet — re-run add-log-retention-settings.sql.';
  if (!status.active) return `The daily purge job exists (${status.schedule}) but is currently paused.`;
  return `Automatic daily purge is scheduled and active (${status.schedule}, UTC).`;
});

function applyRetention(state, days) {
  state.forever = days === null;
  state.days = days === null ? '' : String(days);
}

async function loadSettings() {
  isLoading.value = true;
  try {
    const { data, error } = await supabase.from('log_retention_settings').select('audit_log_retention_days, training_lookup_logs_retention_days, updated_at').eq('id', true).maybeSingle();
    if (error) throw error;
    if (data) {
      applyRetention(audit, data.audit_log_retention_days);
      applyRetention(lookup, data.training_lookup_logs_retention_days);
      updatedAt.value = data.updated_at;
    }
  } catch (error) {
    showAlert('Error Loading Settings', error.message);
  } finally {
    isLoading.value = false;
  }
}

async function loadSchedule() {
  try {
    const { data, error } = await supabase.rpc('admin_get_purge_schedule_status');
    if (error) throw error;
    schedule.value = data;
  } catch (error) {
    console.error('Error loading purge schedule:', error.message);
    schedule.value = { available: false, scheduled: false };
  }
}

async function save() {
  if (!audit.forever && !audit.days.trim()) {
    showAlert('Missing Value', 'Enter a number of days for the System Audit Log, or check "Keep forever".');
    return;
  }
  if (!lookup.forever && !lookup.days.trim()) {
    showAlert('Missing Value', 'Enter a number of days for Public Search Logs, or check "Keep forever".');
    return;
  }
  isSaving.value = true;
  try {
    const { data: authData } = await supabase.auth.getUser();
    const { error } = await supabase.from('log_retention_settings').update({
      audit_log_retention_days: audit.forever ? null : parseInt(audit.days, 10),
      training_lookup_logs_retention_days: lookup.forever ? null : parseInt(lookup.days, 10),
      updated_by: authData?.user?.id || null,
      updated_at: new Date().toISOString(),
    }).eq('id', true);
    if (error) throw error;
    showAlert('Saved', 'Retention settings updated.');
    loadSettings();
  } catch (error) {
    showAlert('Save Failed', error.message);
  } finally {
    isSaving.value = false;
  }
}

async function purgeNow() {
  isPurging.value = true;
  try {
    const { data, error } = await supabase.rpc('admin_purge_expired_logs');
    if (error) throw error;
    const result = data?.[0] || {};
    showAlert('Purge Complete', `Removed ${result.audit_log_deleted ?? 0} System Audit Log row(s) and ${result.training_lookup_logs_deleted ?? 0} Public Search Log row(s) older than the configured retention period.`);
  } catch (error) {
    showAlert('Purge Failed', error.message);
  } finally {
    isPurging.value = false;
  }
}

onMounted(() => {
  loadSettings();
  loadSchedule();
});
</script>

<template>
  <div class="page">
    <PageHead title="Settings" subtitle="System-wide configuration for this portal." />
    <div class="tabs" role="tablist">
      <button v-for="item in TABS" :key="item.key" class="tab row" :class="{ active: tab === item.key }" role="tab" :aria-selected="tab === item.key" @click="tab = item.key">
        <component :is="item.icon" :size="14" />{{ item.label }}
      </button>
    </div>

    <DataHealth v-if="tab === 'dataHealth'" />
    <RolesAccess v-else-if="tab === 'rolesAccess'" :on-access-changed="onAccessChanged" />
    <Areas v-else-if="tab === 'areas'" />
    <ImportCsv v-else-if="tab === 'csvImport'" />
    <AppUpdateSettings v-else-if="tab === 'appUpdate'" />
    <LoadingBlock v-else-if="isLoading" />
    <section v-else class="card card-pad stack retention">
      <div>
        <h2 class="card-title">Log Retention</h2>
        <p class="card-sub">How long system logs are kept before being automatically deleted.</p>
      </div>
      <p class="muted">Both logs below grow with normal use. Set how long to keep each one — a scheduled daily cleanup (if enabled on this project) applies these automatically, and "Purge Now" runs it immediately.</p>
      <p v-if="schedule" class="notice row" :class="scheduleIsHealthy ? 'success' : 'warn'">
        <component :is="scheduleIsHealthy ? CheckCircle2 : CircleAlert" :size="16" />{{ scheduleMessage }}
      </p>
      <div v-for="field in retentionFields" :key="field.label" class="field">
        <span class="field-label">{{ field.label }}</span>
        <span class="muted small">{{ field.description }}</span>
        <div class="row row-wrap">
          <input :value="field.state.forever ? '' : field.state.days" class="input days" inputmode="numeric" placeholder="e.g. 365" :aria-label="`${field.label} days`" :disabled="field.state.forever" @input="field.state.days = $event.target.value.replace(/[^0-9]/g, ''); $event.target.value = field.state.days" />
          <span class="muted">days</span>
          <label class="check"><input v-model="field.state.forever" type="checkbox" />Keep forever</label>
        </div>
      </div>
      <p v-if="updatedAt" class="muted small">Last updated {{ formatDateTime(updatedAt) }}.</p>
      <div class="row row-wrap">
        <button class="btn" :disabled="isPurging" @click="purgeNow"><Trash2 :size="14" />{{ isPurging ? 'Purging…' : 'Purge Now' }}</button>
        <button class="btn btn-primary" :disabled="isSaving" @click="save">{{ isSaving ? 'Saving…' : 'Save Settings' }}</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.retention { max-width: 760px; }
.days { width: 120px; }
.warn { background: var(--warning-soft); color: var(--warning); }
.notice svg { flex: none; }
</style>
