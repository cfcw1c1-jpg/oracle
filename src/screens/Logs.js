import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AuditLogs from './AuditLogs';
import MemberChangeHistory from './MemberChangeHistory';
import SystemAuditLog from './SystemAuditLog';

const NAVY = '#002060';

// Formerly three separate top-level sidebar pages (auditLogs, systemAudit,
// memberChangeHistory) -- consolidated into tabs under one "Logs" page,
// same pattern Settings.js already uses for Data Health/Roles & Page
// Access/Areas. See scripts/sql/merge-logs-into-tabs.sql for the page-key
// migration this depends on.
const TABS = [
  { key: 'trainingLookup', label: 'Training Lookup Logs', icon: 'terminal-outline' },
  { key: 'systemAudit', label: 'System Audit Log', icon: 'shield-checkmark-outline' },
  { key: 'memberChangeHistory', label: 'Member Change History', icon: 'time-outline' },
];

export default function Logs() {
  const [tab, setTab] = useState('trainingLookup');

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Ionicons name="file-tray-full-outline" size={22} color="#0f172a" style={styles.titleIcon} />
          <Text style={styles.title}>Logs</Text>
        </View>
        <Text style={styles.subtitle}>Every recorded activity in the portal, in one place.</Text>

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

      {tab === 'systemAudit' ? (
        <SystemAuditLog />
      ) : tab === 'memberChangeHistory' ? (
        <MemberChangeHistory />
      ) : (
        <AuditLogs />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },

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
});
