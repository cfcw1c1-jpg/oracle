import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { TableCard } from '../components/admin-table';
import Areas from './Areas';
import DataHealth from './DataHealth';
import RolesAccess from './RolesAccess';

const NAVY = '#002060';

function showAlert(title, message) {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
}

function formatTimestamp(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Three possible states from admin_get_purge_schedule_status(): pg_cron
// isn't installed on this project at all, it's installed but the job
// isn't scheduled (e.g. the SQL script's scheduling section failed
// silently), or it's scheduled and either active or paused.
function scheduleStatusMessage(status) {
  if (!status.available) {
    return 'Automatic scheduling isn’t available on this project (pg_cron isn’t installed) — use "Purge Now" manually, or trigger it from an external scheduler.';
  }
  if (!status.scheduled) {
    return 'pg_cron is available, but the daily purge isn’t scheduled yet — re-run add-log-retention-settings.sql.';
  }
  if (!status.active) {
    return `The daily purge job exists (${status.schedule}) but is currently paused.`;
  }
  return `Automatic daily purge is scheduled and active (${status.schedule}, UTC).`;
}

function scheduleBannerColor(status) {
  return status.available && status.scheduled && status.active ? '#15803d' : '#b45309';
}
function scheduleBannerBg(status) {
  return status.available && status.scheduled && status.active ? '#dcfce7' : '#fef3c7';
}
function scheduleBannerBorder(status) {
  return status.available && status.scheduled && status.active ? '#86efac' : '#fde68a';
}

// A "days" field that can also be set to "keep forever" (null) -- used for
// both retention settings below.
function RetentionField({ label, description, days, onChangeDays, keepForever, onToggleForever }) {
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldDescription}>{description}</Text>

      <View style={styles.fieldRow}>
        <TextInput
          style={[styles.daysInput, keepForever && styles.daysInputDisabled]}
          value={keepForever ? '' : String(days ?? '')}
          onChangeText={(text) => onChangeDays(text.replace(/[^0-9]/g, ''))}
          placeholder="e.g. 365"
          placeholderTextColor="#94a3b8"
          keyboardType="number-pad"
          editable={!keepForever}
        />
        <Text style={styles.daysLabel}>days</Text>

        <TouchableOpacity style={styles.foreverToggle} onPress={onToggleForever}>
          <Ionicons
            name={keepForever ? 'checkbox' : 'square-outline'}
            size={18}
            color={keepForever ? NAVY : '#94a3b8'}
            style={{ marginRight: 6 }}
          />
          <Text style={styles.foreverToggleText}>Keep forever</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const TABS = [
  { key: 'retention', label: 'Log Retention', icon: 'time-outline' },
  { key: 'dataHealth', label: 'Data Health', icon: 'pulse-outline' },
  { key: 'rolesAccess', label: 'Roles & Page Access', icon: 'key-outline' },
  { key: 'areas', label: 'Areas', icon: 'git-network-outline' },
];

export default function Settings({ onAccessChanged }) {
  const [tab, setTab] = useState('retention');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [purging, setPurging] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [scheduleStatus, setScheduleStatus] = useState(null); // { available, scheduled, active, schedule } | null while loading

  const [auditDays, setAuditDays] = useState('365');
  const [auditForever, setAuditForever] = useState(false);
  const [lookupDays, setLookupDays] = useState('90');
  const [lookupForever, setLookupForever] = useState(false);

  useEffect(() => {
    loadSettings();
    loadScheduleStatus();
  }, []);

  async function loadSettings() {
    try {
      setLoading(true);
      const { data, error } = await supabase.from('log_retention_settings').select('*').eq('id', true).maybeSingle();
      if (error) throw error;
      if (data) {
        setAuditForever(data.audit_log_retention_days === null);
        setAuditDays(data.audit_log_retention_days === null ? '' : String(data.audit_log_retention_days));
        setLookupForever(data.training_lookup_logs_retention_days === null);
        setLookupDays(data.training_lookup_logs_retention_days === null ? '' : String(data.training_lookup_logs_retention_days));
        setUpdatedAt(data.updated_at);
      }
    } catch (err) {
      showAlert('Error Loading Settings', err.message);
    } finally {
      setLoading(false);
    }
  }

  // Asks the database itself whether the automatic daily purge is actually
  // scheduled -- there's no way to check this from outside (no client
  // access to the cron schema), so it has to go through a function the
  // database runs on its own side, same as the manual purge does.
  async function loadScheduleStatus() {
    try {
      const { data, error } = await supabase.rpc('admin_get_purge_schedule_status');
      if (error) throw error;
      setScheduleStatus(data);
    } catch (err) {
      console.error('Error loading purge schedule status:', err.message);
      setScheduleStatus({ available: false, scheduled: false });
    }
  }

  async function handleSave() {
    if (!auditForever && !auditDays.trim()) {
      showAlert('Missing Value', 'Enter a number of days for the System Audit Log, or check "Keep forever".');
      return;
    }
    if (!lookupForever && !lookupDays.trim()) {
      showAlert('Missing Value', 'Enter a number of days for Public Search Logs, or check "Keep forever".');
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('log_retention_settings')
        .update({
          audit_log_retention_days: auditForever ? null : parseInt(auditDays, 10),
          training_lookup_logs_retention_days: lookupForever ? null : parseInt(lookupDays, 10),
          updated_by: user?.id || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', true);
      if (error) throw error;
      showAlert('Saved', 'Retention settings updated.');
      loadSettings();
    } catch (err) {
      showAlert('Save Failed', err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handlePurgeNow() {
    setPurging(true);
    try {
      const { data, error } = await supabase.rpc('admin_purge_expired_logs');
      if (error) throw error;
      const result = data?.[0] || {};
      showAlert(
        'Purge Complete',
        `Removed ${result.audit_log_deleted ?? 0} System Audit Log row(s) and ${result.training_lookup_logs_deleted ?? 0} Public Search Log row(s) older than the configured retention period.`
      );
    } catch (err) {
      showAlert('Purge Failed', err.message);
    } finally {
      setPurging(false);
    }
  }

  if (loading) return <ActivityIndicator size="large" color={NAVY} style={styles.centered} />;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Ionicons name="settings-outline" size={22} color="#0f172a" style={styles.titleIcon} />
          <Text style={styles.title}>Settings</Text>
        </View>
        <Text style={styles.subtitle}>System-wide configuration for this portal.</Text>

        <View style={styles.tabRow}>
          {TABS.map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[styles.tabBtn, tab === t.key && styles.tabBtnActive]}
              onPress={() => setTab(t.key)}
            >
              <Ionicons name={t.icon} size={15} color={tab === t.key ? NAVY : '#64748b'} style={{ marginRight: 6 }} />
              <Text style={[styles.tabBtnText, tab === t.key && styles.tabBtnTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {tab === 'dataHealth' ? (
        <DataHealth />
      ) : tab === 'rolesAccess' ? (
        <RolesAccess onAccessChanged={onAccessChanged} />
      ) : tab === 'areas' ? (
        <Areas />
      ) : (
      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <TableCard title="Log Retention" subtitle="How long system logs are kept before being automatically deleted.">
        <View style={styles.cardBody}>
          <Text style={styles.introText}>
            Both logs below grow with normal use. Set how long to keep each one — a scheduled daily cleanup
            (if enabled on this project) applies these automatically, and &quot;Purge Now&quot; runs it
            immediately.
          </Text>

          {scheduleStatus && (
            <View style={[styles.scheduleBanner, { backgroundColor: scheduleBannerBg(scheduleStatus), borderColor: scheduleBannerBorder(scheduleStatus) }]}>
              <Ionicons
                name={scheduleStatus.scheduled && scheduleStatus.active ? 'checkmark-circle-outline' : 'alert-circle-outline'}
                size={16}
                color={scheduleBannerColor(scheduleStatus)}
                style={{ marginRight: 8 }}
              />
              <Text style={[styles.scheduleBannerText, { color: scheduleBannerColor(scheduleStatus) }]}>
                {scheduleStatusMessage(scheduleStatus)}
              </Text>
            </View>
          )}

          <RetentionField
            label="System Audit Log"
            description="Every insert/update/delete and page-view record (Admin's System Audit Log page)."
            days={auditDays}
            onChangeDays={setAuditDays}
            keepForever={auditForever}
            onToggleForever={() => setAuditForever((v) => !v)}
          />

          <RetentionField
            label="Public Search Logs"
            description="Search activity from the public, unauthenticated Training Lookup page."
            days={lookupDays}
            onChangeDays={setLookupDays}
            keepForever={lookupForever}
            onToggleForever={() => setLookupForever((v) => !v)}
          />

          {!!updatedAt && <Text style={styles.updatedText}>Last updated {formatTimestamp(updatedAt)}.</Text>}

          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.purgeBtn} onPress={handlePurgeNow} disabled={purging}>
              {purging ? (
                <ActivityIndicator size="small" color={NAVY} />
              ) : (
                <>
                  <Ionicons name="trash-outline" size={14} color={NAVY} style={{ marginRight: 6 }} />
                  <Text style={styles.purgeBtnText}>Purge Now</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={[styles.saveBtn, saving && styles.btnDisabled]} onPress={handleSave} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.saveBtnText}>Save Settings</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </TableCard>
      </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  scrollContent: { padding: 16, paddingBottom: 30 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  header: { padding: 16, paddingBottom: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  titleIcon: { marginRight: 8 },
  title: { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  subtitle: { fontSize: 13, color: '#64748b', marginTop: 4 },

  tabRow: { flexDirection: 'row', gap: 8, marginTop: 14, flexWrap: 'wrap' },
  tabBtn: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: 8, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0',
  },
  tabBtnActive: { backgroundColor: '#e0e7ff', borderColor: NAVY },
  tabBtnText: { fontSize: 13, fontWeight: '700', color: '#64748b' },
  tabBtnTextActive: { color: NAVY },

  cardBody: { padding: 16 },
  introText: { fontSize: 12, color: '#64748b', lineHeight: 18, marginBottom: 18 },
  scheduleBanner: {
    flexDirection: 'row', alignItems: 'flex-start', borderWidth: 1, borderRadius: 10,
    padding: 12, marginBottom: 18,
  },
  scheduleBannerText: { flex: 1, fontSize: 12, fontWeight: '600', lineHeight: 17 },

  fieldBlock: { marginBottom: 20 },
  fieldLabel: { fontSize: 13, fontWeight: '800', color: '#0f172a' },
  fieldDescription: { fontSize: 12, color: '#64748b', marginTop: 2, marginBottom: 10, lineHeight: 17 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  daysInput: {
    borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9,
    fontSize: 14, color: '#1e293b', backgroundColor: '#ffffff', width: 90,
  },
  daysInputDisabled: { backgroundColor: '#f1f5f9', color: '#94a3b8' },
  daysLabel: { fontSize: 13, color: '#64748b', fontWeight: '600' },
  foreverToggle: { flexDirection: 'row', alignItems: 'center', marginLeft: 10 },
  foreverToggleText: { fontSize: 13, color: '#334155', fontWeight: '600' },

  updatedText: { fontSize: 11, color: '#94a3b8', marginBottom: 14 },

  actionsRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  purgeBtn: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11,
    borderRadius: 8, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0',
  },
  purgeBtnText: { fontSize: 13, fontWeight: '700', color: NAVY },
  saveBtn: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: 8, backgroundColor: NAVY, minWidth: 130, alignItems: 'center' },
  saveBtnText: { fontSize: 13, fontWeight: '700', color: '#ffffff' },
  btnDisabled: { opacity: 0.6 },
});
