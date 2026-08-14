import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { TableCard } from '../components/admin-table';

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

function Field({ label, description, value, onChangeText, placeholder }) {
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {!!description && <Text style={styles.fieldDescription}>{description}</Text>}
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#94a3b8"
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

// Manages the single row read by src/lib/appVersionGate.js -- leaving a
// platform's minimum version blank means that platform's install base is
// never gated, regardless of how old their build is. See
// scripts/sql/add-app-version-gate.sql for the table/RLS this reads and
// writes.
export default function AppUpdateSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);

  const [minIosVersion, setMinIosVersion] = useState('');
  const [minAndroidVersion, setMinAndroidVersion] = useState('');
  const [iosStoreUrl, setIosStoreUrl] = useState('');
  const [androidStoreUrl, setAndroidStoreUrl] = useState('');
  const [updateMessage, setUpdateMessage] = useState('');

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      setLoading(true);
      const { data, error } = await supabase.from('app_version_requirements').select('*').eq('id', true).maybeSingle();
      if (error) throw error;
      if (data) {
        setMinIosVersion(data.min_ios_version || '');
        setMinAndroidVersion(data.min_android_version || '');
        setIosStoreUrl(data.ios_store_url || '');
        setAndroidStoreUrl(data.android_store_url || '');
        setUpdateMessage(data.update_message || '');
        setUpdatedAt(data.updated_at);
      }
    } catch (err) {
      showAlert('Error Loading Settings', err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('app_version_requirements')
        .update({
          min_ios_version: minIosVersion.trim() || null,
          min_android_version: minAndroidVersion.trim() || null,
          ios_store_url: iosStoreUrl.trim() || null,
          android_store_url: androidStoreUrl.trim() || null,
          update_message: updateMessage.trim() || null,
          updated_by: user?.id || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', true);
      if (error) throw error;
      showAlert('Saved', 'App update requirements updated. Anyone on an outdated native build (already open, or on next launch) will see the update prompt.');
      loadSettings();
    } catch (err) {
      showAlert('Save Failed', err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <ActivityIndicator size="large" color={NAVY} style={styles.centered} />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <TableCard
        title="App Update"
        subtitle="Force iOS/Android accounts on an old build to update before they can use the app. The web build always serves the latest version, so this has no effect there."
      >
        <View style={styles.cardBody}>
          <View style={styles.warningBanner}>
            <Ionicons name="alert-circle-outline" size={16} color="#b45309" style={{ marginRight: 8 }} />
            <Text style={styles.warningBannerText}>
              Setting a minimum version blocks every native account below it immediately, with no way to dismiss the
              prompt except updating. Only raise these after the corresponding build is actually live in the App
              Store / Play Store.
            </Text>
          </View>

          <Field
            label="Minimum iOS Version"
            description="Leave blank to never gate iOS. Must match app.json's version format (e.g. 1.4.0)."
            value={minIosVersion}
            onChangeText={setMinIosVersion}
            placeholder="e.g. 1.4.0"
          />
          <Field
            label="iOS App Store URL"
            description="Opened when someone taps “Update Now” on iOS."
            value={iosStoreUrl}
            onChangeText={setIosStoreUrl}
            placeholder="https://apps.apple.com/app/id..."
          />

          <Field
            label="Minimum Android Version"
            description="Leave blank to never gate Android."
            value={minAndroidVersion}
            onChangeText={setMinAndroidVersion}
            placeholder="e.g. 1.4.0"
          />
          <Field
            label="Android Play Store URL"
            description="Opened when someone taps “Update Now” on Android."
            value={androidStoreUrl}
            onChangeText={setAndroidStoreUrl}
            placeholder="https://play.google.com/store/apps/details?id=..."
          />

          <Field
            label="Custom Message (optional)"
            description="Shown in the update prompt instead of the default wording."
            value={updateMessage}
            onChangeText={setUpdateMessage}
            placeholder="A new version is required to continue..."
          />

          {!!updatedAt && <Text style={styles.updatedText}>Last updated {formatTimestamp(updatedAt)}.</Text>}

          <View style={styles.actionsRow}>
            <TouchableOpacity style={[styles.saveBtn, saving && styles.btnDisabled]} onPress={handleSave} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.saveBtnText}>Save Settings</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </TableCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  scrollContent: { padding: 16, paddingBottom: 30 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  cardBody: { padding: 16 },

  warningBanner: {
    flexDirection: 'row', alignItems: 'flex-start', borderWidth: 1, borderRadius: 10,
    padding: 12, marginBottom: 20, backgroundColor: '#fef3c7', borderColor: '#fde68a',
  },
  warningBannerText: { flex: 1, fontSize: 12, fontWeight: '600', lineHeight: 17, color: '#b45309' },

  fieldBlock: { marginBottom: 18 },
  fieldLabel: { fontSize: 13, fontWeight: '800', color: '#0f172a' },
  fieldDescription: { fontSize: 12, color: '#64748b', marginTop: 2, marginBottom: 8, lineHeight: 17 },
  input: {
    borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 13, color: '#1e293b', backgroundColor: '#ffffff',
  },

  updatedText: { fontSize: 11, color: '#94a3b8', marginBottom: 14 },

  actionsRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  saveBtn: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: 8, backgroundColor: NAVY, minWidth: 130, alignItems: 'center' },
  saveBtnText: { fontSize: 13, fontWeight: '700', color: '#ffffff' },
  btnDisabled: { opacity: 0.6 },
});
