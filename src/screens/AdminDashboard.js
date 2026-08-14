import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../../lib/supabase';

const NAVY = '#002060';
const ACCENT_BLUE = '#2563eb';
const ACCENT_BLUE_BG = '#eff6ff';

// Page-view rows are logged as table_name = "page:<tabKey>" (see
// src/app/index.js's logPageView) precisely so they can be told apart from
// real data-table audit rows. Excluded here because they're not content
// pages themselves -- Settings and Logs are configuration/observability
// surfaces, not something "page popularity" is meaningful for.
const EXCLUDED_PAGE_KEYS = new Set(['settings', 'logs']);

function showAlert(title, message) {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
  } else {
    console.error(`${title}: ${message}`);
  }
}

// One horizontal bar per page, single accent hue since this is a ranked
// magnitude comparison (view count) rather than a set of distinct
// categories that need telling apart by color -- matches the "Formation
// Stage Progress" bars' track/fill pattern on the main Dashboard.
function PageViewBar({ label, count, maxCount, isTop }) {
  const widthPct = maxCount > 0 ? Math.max((count / maxCount) * 100, count > 0 ? 3 : 0) : 0;
  return (
    <View style={styles.barRow}>
      <View style={styles.barLabelRow}>
        <Text style={styles.barLabel} numberOfLines={1}>{label}</Text>
        <Text style={[styles.barCount, isTop && styles.barCountTop]}>{count}</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${widthPct}%` }, isTop && styles.barFillTop]} />
      </View>
    </View>
  );
}

// Admin-only usage overview: how many times each page has been opened,
// sourced from the same audit_log PAGE_VIEW rows the System Audit Log /
// Logs page already records -- no separate analytics/tracking system.
// Access is gated the same way as every other page in this app (via
// role_pages, seeded to Admin only by scripts/sql/add-admin-dashboard.sql)
// rather than a hardcoded role check, so it can be handed to another role
// later from Roles & Page Access if ever needed.
export default function AdminDashboard() {
  const [loading, setLoading] = useState(true);
  const [pageViews, setPageViews] = useState([]);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const [pagesRes, logsRes] = await Promise.all([
        supabase.from('pages').select('key, label').order('sort_order'),
        supabase.from('audit_log').select('table_name').eq('action', 'PAGE_VIEW'),
      ]);
      if (pagesRes.error) throw pagesRes.error;
      if (logsRes.error) throw logsRes.error;

      const counts = {};
      (logsRes.data || []).forEach((row) => {
        const key = (row.table_name || '').replace(/^page:/, '');
        counts[key] = (counts[key] || 0) + 1;
      });

      const rows = (pagesRes.data || [])
        .filter((p) => !EXCLUDED_PAGE_KEYS.has(p.key))
        .map((p) => ({ key: p.key, label: p.label, count: counts[p.key] || 0 }))
        .sort((a, b) => b.count - a.count);

      setPageViews(rows);
    } catch (err) {
      showAlert('Error Loading Admin Dashboard', err.message);
    } finally {
      setLoading(false);
    }
  }

  const totalViews = useMemo(() => pageViews.reduce((sum, p) => sum + p.count, 0), [pageViews]);
  const maxCount = useMemo(() => pageViews.reduce((max, p) => Math.max(max, p.count), 0), [pageViews]);
  const topPage = pageViews[0];

  if (loading) return <ActivityIndicator size="large" color={NAVY} style={styles.centered} />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Ionicons name="stats-chart-outline" size={22} color="#0f172a" style={styles.titleIcon} />
          <Text style={styles.title}>Admin Dashboard</Text>
        </View>
        <Text style={styles.subtitle}>Page popularity across the portal, admin-only.</Text>
        <TouchableOpacity style={styles.refreshBtn} onPress={loadData} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="refresh-outline" size={16} color={NAVY} />
        </TouchableOpacity>
      </View>

      <View style={styles.statTilesRow}>
        <View style={styles.statTile}>
          <View style={[styles.statIconChip, { backgroundColor: ACCENT_BLUE_BG }]}>
            <Ionicons name="eye-outline" size={18} color={NAVY} />
          </View>
          <Text style={styles.statValue}>{totalViews}</Text>
          <Text style={styles.statLabel}>Total Page Views</Text>
        </View>

        <View style={styles.statTile}>
          <View style={[styles.statIconChip, { backgroundColor: '#fef3c7' }]}>
            <Ionicons name="trophy-outline" size={18} color="#b45309" />
          </View>
          <Text style={styles.statValue} numberOfLines={1}>{topPage?.count ? topPage.label : '—'}</Text>
          <Text style={styles.statLabel}>Most Viewed Page</Text>
        </View>

        <View style={styles.statTile}>
          <View style={[styles.statIconChip, { backgroundColor: ACCENT_BLUE_BG }]}>
            <Ionicons name="grid-outline" size={18} color={ACCENT_BLUE} />
          </View>
          <Text style={styles.statValue}>{pageViews.length}</Text>
          <Text style={styles.statLabel}>Pages Tracked</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Page Views by Page</Text>
        {pageViews.length === 0 ? (
          <Text style={styles.emptyText}>No pages found.</Text>
        ) : totalViews === 0 ? (
          <Text style={styles.emptyText}>No page views recorded yet.</Text>
        ) : (
          pageViews.map((p, index) => (
            <PageViewBar key={p.key} label={p.label} count={p.count} maxCount={maxCount} isTop={index === 0 && p.count > 0} />
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  scrollContent: { paddingHorizontal: 16, paddingVertical: 16, paddingBottom: 30 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  header: { marginBottom: 16, position: 'relative' },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  titleIcon: { marginRight: 8 },
  title: { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  subtitle: { fontSize: 13, color: '#64748b', marginTop: 4 },
  refreshBtn: {
    position: 'absolute', right: 0, top: 0, width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0', justifyContent: 'center', alignItems: 'center',
  },

  statTilesRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap', marginBottom: 16 },
  statTile: {
    flex: 1, minWidth: 160, backgroundColor: '#ffffff', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: '#e2e8f0',
  },
  statIconChip: { width: 34, height: 34, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  statValue: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  statLabel: { fontSize: 11, color: '#64748b', marginTop: 2, fontWeight: '600' },

  card: {
    backgroundColor: '#ffffff', borderRadius: 16, padding: 18,
    borderWidth: 1, borderColor: '#e2e8f0',
  },
  cardTitle: { fontSize: 13, fontWeight: '800', color: '#0f172a', marginBottom: 16, textTransform: 'uppercase', letterSpacing: 0.4 },
  emptyText: { fontSize: 12, color: '#94a3b8', textAlign: 'center', paddingVertical: 20 },

  barRow: { marginBottom: 16 },
  barLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  barLabel: { flex: 1, fontSize: 13, fontWeight: '600', color: '#334155', marginRight: 10 },
  barCount: { fontSize: 13, fontWeight: '800', color: '#64748b' },
  barCountTop: { color: ACCENT_BLUE },
  barTrack: { height: 10, borderRadius: 5, backgroundColor: '#f1f5f9', overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 5, backgroundColor: '#93c5fd' },
  barFillTop: { backgroundColor: ACCENT_BLUE },
});
