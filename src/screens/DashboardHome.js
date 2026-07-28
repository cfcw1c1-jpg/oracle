import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { supabase } from '../../lib/supabase';
import { computeTrackStat, FORMATION_STAGES } from './PfoStatGenerator';

// Palette reused from the rest of the app (app/index.js header, MembersList.js
// gender chips, ClpMaintenance.js badges) so this screen matches the others.
const NAVY = '#002060';
const NAVY_DARK = '#001540';
const ACCENT_BLUE = '#2563eb';
const ACCENT_BLUE_BG = '#eff6ff';
const MALE_BLUE = '#0284c7';
const FEMALE_PINK = '#db2777';
const AMBER_BG = '#fef3c7';
const AMBER_TEXT = '#b45309';

function getTimeOfDay(hour) {
  if (hour < 12) return 'Morning';
  if (hour < 18) return 'Afternoon';
  return 'Evening';
}

function average(numbers) {
  if (numbers.length === 0) return 0;
  return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
}

function formatShortDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// A donut ring built with react-native-svg: one stacked arc per segment, each
// rotated to start where the previous one ended, sweeping clockwise from 12 o'clock.
function GenderDonut({ segments, size = 132, thickness = 16 }) {
  const total = segments.reduce((sum, s) => sum + s.count, 0);
  const dominant = segments.reduce((a, b) => (b.count > a.count ? b : a), segments[0]);
  const dominantPct = total > 0 ? Math.round((dominant.count / total) * 100) : 0;

  const center = size / 2;
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;

  let cumulativeDeg = 0;

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={center} cy={center} r={radius} stroke="#eef2f7" strokeWidth={thickness} fill="none" />
        {total > 0 &&
          segments.map((segment) => {
            const share = segment.count / total;
            const arcLength = share * circumference;
            const rotation = -90 + cumulativeDeg;
            cumulativeDeg += share * 360;
            if (arcLength <= 0) return null;

            return (
              <Circle
                key={segment.label}
                cx={center}
                cy={center}
                r={radius}
                stroke={segment.color}
                strokeWidth={thickness}
                fill="none"
                strokeDasharray={`${arcLength} ${circumference - arcLength}`}
                transform={`rotate(${rotation} ${center} ${center})`}
              />
            );
          })}
      </Svg>
      <View style={styles.donutCenterOverlay} pointerEvents="none">
        <Text style={styles.donutPercent}>{dominantPct}%</Text>
        <Text style={styles.donutLabel}>{(dominant.label || '').toUpperCase()}</Text>
      </View>
    </View>
  );
}

export default function DashboardHome({ onNavigate }) {
  const { width } = useWindowDimensions();
  const isWideScreen = width >= 900;

  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());
  const [sessionUser, setSessionUser] = useState(null);
  const [memberGenders, setMemberGenders] = useState([]);
  const [pfoRows, setPfoRows] = useState([]);
  const [clpTrainings, setClpTrainings] = useState([]);

  useEffect(() => {
    loadDashboard();

    // Keep the header clock chip feeling alive without hammering re-renders.
    const clockTimer = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(clockTimer);
  }, []);

  async function loadDashboard() {
    try {
      setLoading(true);

      const [{ data: sessionData }, membersRes, pfoRes, clpRes] = await Promise.all([
        supabase.auth.getSession(),
        supabase.from('members').select('Gender'),
        supabase.from('pfo_members').select('*'),
        supabase.from('clp_trainings').select('*').order('start_date', { ascending: false }),
      ]);

      if (membersRes.error) throw membersRes.error;
      if (pfoRes.error) throw pfoRes.error;
      if (clpRes.error) throw clpRes.error;

      setSessionUser(sessionData?.session?.user || null);
      setMemberGenders(membersRes.data || []);
      setPfoRows(pfoRes.data || []);
      setClpTrainings(clpRes.data || []);
    } catch (err) {
      console.error('Error loading dashboard:', err.message);
    } finally {
      setLoading(false);
    }
  }

  const totalMembers = memberGenders.length;

  const genderSegments = useMemo(() => {
    const male = memberGenders.filter((m) => m.Gender === 'Male').length;
    const female = memberGenders.filter((m) => m.Gender === 'Female').length;
    const other = totalMembers - male - female;

    const segments = [
      { label: 'Male', count: male, color: MALE_BLUE },
      { label: 'Female', count: female, color: FEMALE_PINK },
    ];
    if (other > 0) segments.push({ label: 'Unspecified', count: other, color: '#e2e8f0' });
    return segments;
  }, [memberGenders, totalMembers]);

  const stageProgress = useMemo(() => {
    return FORMATION_STAGES.map((stage) => {
      const trackedPercentages = stage.tracks
        .map((track) => computeTrackStat(track, pfoRows, totalMembers))
        .filter((t) => t.tracked)
        .map((t) => t.percent);
      return { ...stage, avgPercent: average(trackedPercentages) };
    });
  }, [pfoRows, totalMembers]);

  const overallPfoAvg = useMemo(() => {
    const allPercentages = FORMATION_STAGES.flatMap((stage) =>
      stage.tracks
        .map((track) => computeTrackStat(track, pfoRows, totalMembers))
        .filter((t) => t.tracked)
        .map((t) => t.percent)
    );
    return average(allPercentages);
  }, [pfoRows, totalMembers]);

  // Only genuinely future-dated batches count as "upcoming"; if none exist
  // yet, fall back to showing the most recent past batches instead (and
  // label the card accordingly rather than mislabeling old data as upcoming).
  const { displayedTrainings, hasUpcomingTrainings } = useMemo(() => {
    const todayStr = now.toISOString().slice(0, 10);
    const upcoming = clpTrainings
      .filter((t) => t.start_date && t.start_date >= todayStr)
      .sort((a, b) => a.start_date.localeCompare(b.start_date));

    if (upcoming.length > 0) {
      return { displayedTrainings: upcoming.slice(0, 4), hasUpcomingTrainings: true };
    }
    return { displayedTrainings: clpTrainings.slice(0, 4), hasUpcomingTrainings: false };
  }, [clpTrainings, now]);

  if (loading) return <ActivityIndicator size="large" color={NAVY} style={styles.centered} />;

  const email = sessionUser?.email || 'Portal Administrator';
  const initials = email.slice(0, 2).toUpperCase();
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
  const dateTimeLabel = now.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* Refresh */}
      <View style={styles.headerRow}>
        <TouchableOpacity style={styles.refreshBtn} onPress={loadDashboard}>
          <Ionicons name="refresh-outline" size={18} color={NAVY} />
        </TouchableOpacity>
      </View>

      <View style={[styles.bodyLayout, isWideScreen && styles.bodyLayoutWide]}>
        {/* Main column */}
        <View style={[styles.mainColumn, isWideScreen && styles.mainColumnWide]}>
          <View style={styles.heroBanner}>
            <View style={styles.heroTextSide}>
              <View style={styles.dateChip}>
                <Ionicons name="calendar-outline" size={12} color="#ffffff" style={{ marginRight: 6 }} />
                <Text style={styles.dateChipText}>{dateTimeLabel}</Text>
              </View>
              <Text style={styles.heroTitle}>Good {getTimeOfDay(now.getHours())}!</Text>
              <Text style={styles.heroSubtitle}>
                Welcome back — signed in as {email}. Have a great {weekday}!
              </Text>
            </View>
            <View style={styles.heroBrandMark}>
              <Ionicons name="book-outline" size={32} color="#ffffff" />
            </View>
          </View>

          <View style={styles.statTilesRow}>
            <View style={styles.statTile}>
              <View style={[styles.statIconChip, { backgroundColor: ACCENT_BLUE_BG }]}>
                <Ionicons name="people-outline" size={18} color={NAVY} />
              </View>
              <Text style={styles.statValue}>{totalMembers}</Text>
              <Text style={styles.statLabel}>Total Active Members</Text>
            </View>

            <View style={styles.statTile}>
              <View style={[styles.statIconChip, { backgroundColor: AMBER_BG }]}>
                <Ionicons name="school-outline" size={18} color={AMBER_TEXT} />
              </View>
              <Text style={styles.statValue}>{clpTrainings.length}</Text>
              <Text style={styles.statLabel}>CLP Training Batches</Text>
            </View>

            <View style={styles.statTile}>
              <View style={[styles.statIconChip, { backgroundColor: ACCENT_BLUE_BG }]}>
                <Ionicons name="analytics-outline" size={18} color={ACCENT_BLUE} />
              </View>
              <Text style={styles.statValue}>{overallPfoAvg.toFixed(1)}%</Text>
              <Text style={styles.statLabel}>PFO Avg. Completion</Text>
            </View>
          </View>

          <View style={[styles.cardRow, isWideScreen && styles.cardRowWide]}>
            <View style={[styles.card, styles.donutCard, isWideScreen && styles.cardHalfWide]}>
              <Text style={styles.cardTitle}>Member Gender Overview</Text>
              <View style={styles.donutSection}>
                <GenderDonut segments={genderSegments} />
                <View style={styles.donutBreakdown}>
                  {genderSegments.map((segment) => (
                    <View key={segment.label} style={styles.donutBreakdownRow}>
                      <View style={[styles.donutDot, { backgroundColor: segment.color }]} />
                      <Text style={styles.donutBreakdownLabel}>{segment.label}</Text>
                      <Text style={styles.donutBreakdownCount}>{segment.count}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>

            <View style={[styles.card, isWideScreen && styles.cardHalfWide]}>
              <Text style={styles.cardTitle}>Formation Stage Progress</Text>
              {stageProgress.map((stage) => (
                <View key={stage.key} style={styles.progressRow}>
                  <View style={styles.progressLabelRow}>
                    <Text style={styles.progressLabel}>{stage.label}</Text>
                    <Text style={[styles.progressPercent, { color: stage.color }]}>{stage.avgPercent.toFixed(0)}%</Text>
                  </View>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${Math.min(stage.avgPercent, 100)}%`, backgroundColor: stage.color }]} />
                  </View>
                </View>
              ))}

              <TouchableOpacity style={styles.viewReportBtn} onPress={() => onNavigate?.('pfoStats')}>
                <Text style={styles.viewReportBtnText}>View Full Report</Text>
                <Ionicons name="chevron-forward" size={14} color="#ffffff" />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Side column */}
        <View style={[styles.sideColumn, isWideScreen && styles.sideColumnWide]}>
          <View style={[styles.card, styles.profileCard]}>
            <View style={styles.profileHeaderRow}>
              <Text style={styles.cardTitleOnDark}>My Profile</Text>
            </View>
            <View style={styles.profileAvatar}>
              <Text style={styles.profileAvatarText}>{initials}</Text>
            </View>
            <Text style={styles.profileEmail} numberOfLines={1}>{email}</Text>
            <Text style={styles.profileRole}>CFC ORACLE PORTAL</Text>

            <View style={styles.profileFactsRow}>
              <View style={styles.profileFact}>
                <Text style={styles.profileFactLabel}>Member Since</Text>
                <Text style={styles.profileFactValue}>{formatShortDate(sessionUser?.created_at)}</Text>
              </View>
              <View style={styles.profileFact}>
                <Text style={styles.profileFactLabel}>Last Sign-in</Text>
                <Text style={styles.profileFactValue}>{formatShortDate(sessionUser?.last_sign_in_at)}</Text>
              </View>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>{hasUpcomingTrainings ? 'Upcoming CLP Trainings' : 'Previous CLP Trainings'}</Text>
            {displayedTrainings.length === 0 && (
              <Text style={styles.searchEmptyText}>No training batches scheduled yet.</Text>
            )}
            {displayedTrainings.map((training) => (
              <View key={training.id} style={styles.agendaRow}>
                <View style={styles.agendaDot} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.agendaTitle} numberOfLines={1}>{training.venue}</Text>
                  <Text style={styles.agendaSubtitle}>{formatShortDate(training.start_date)} – {formatShortDate(training.end_date)}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  scrollContent: { paddingHorizontal: 16, paddingVertical: 16, paddingBottom: 30 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  headerRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 16 },
  searchEmptyText: { fontSize: 12, color: '#94a3b8', padding: 12, textAlign: 'center' },
  refreshBtn: {
    width: 42, height: 42, borderRadius: 12, backgroundColor: '#ffffff',
    borderWidth: 1, borderColor: '#e2e8f0', justifyContent: 'center', alignItems: 'center',
  },

  bodyLayout: { flexDirection: 'column', gap: 16 },
  bodyLayoutWide: { flexDirection: 'row', alignItems: 'flex-start' },
  mainColumn: { gap: 16 },
  mainColumnWide: { flex: 2 },
  sideColumn: { gap: 16 },
  sideColumnWide: { flex: 1 },

  heroBanner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: NAVY, borderRadius: 18, padding: 22, overflow: 'hidden',
    ...Platform.select({
      web: { experimental_backgroundImage: `linear-gradient(135deg, ${NAVY}, ${NAVY_DARK})` },
      default: {},
    }),
  },
  heroTextSide: { flex: 1, paddingRight: 12 },
  dateChip: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 12,
  },
  dateChipText: { color: '#ffffff', fontSize: 11, fontWeight: '600' },
  heroTitle: { color: '#ffffff', fontSize: 24, fontWeight: '800', marginBottom: 6 },
  heroSubtitle: { color: 'rgba(255,255,255,0.85)', fontSize: 13, lineHeight: 19, maxWidth: 360 },
  heroBrandMark: {
    width: 84, height: 84, borderRadius: 42, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.35)',
    borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center',
  },

  statTilesRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  statTile: {
    flex: 1, minWidth: 140, backgroundColor: '#ffffff', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: '#e2e8f0',
  },
  statIconChip: { width: 34, height: 34, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  statValue: { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  statLabel: { fontSize: 11, color: '#64748b', marginTop: 2, fontWeight: '600' },

  cardRow: { gap: 16 },
  cardRowWide: { flexDirection: 'row' },
  card: {
    backgroundColor: '#ffffff', borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: '#e2e8f0', flex: 1,
  },
  cardHalfWide: { flex: 1 },
  cardTitle: { fontSize: 13, fontWeight: '800', color: '#0f172a', marginBottom: 14, textTransform: 'uppercase', letterSpacing: 0.4 },

  donutCard: { alignItems: 'stretch' },
  donutSection: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  donutCenterOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  donutPercent: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  donutLabel: { fontSize: 9, fontWeight: '700', color: '#64748b', marginTop: 2 },
  donutBreakdown: { flex: 1, gap: 10 },
  donutBreakdownRow: { flexDirection: 'row', alignItems: 'center' },
  donutDot: { width: 9, height: 9, borderRadius: 5, marginRight: 8 },
  donutBreakdownLabel: { flex: 1, fontSize: 12, color: '#334155', fontWeight: '600' },
  donutBreakdownCount: { fontSize: 12, color: '#0f172a', fontWeight: '800' },

  progressRow: { marginBottom: 14 },
  progressLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  progressLabel: { fontSize: 12, fontWeight: '600', color: '#334155' },
  progressPercent: { fontSize: 12, fontWeight: '800' },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: '#f1f5f9', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4 },
  viewReportBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: NAVY, borderRadius: 10, paddingVertical: 12, marginTop: 4,
  },
  viewReportBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },

  profileCard: { backgroundColor: NAVY, borderColor: NAVY, alignItems: 'center', paddingVertical: 20 },
  profileHeaderRow: { width: '100%', marginBottom: 12 },
  cardTitleOnDark: { fontSize: 13, fontWeight: '800', color: '#ffffff', textTransform: 'uppercase', letterSpacing: 0.4 },
  profileAvatar: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center', marginBottom: 10,
  },
  profileAvatarText: { color: '#ffffff', fontSize: 22, fontWeight: '800' },
  profileEmail: { color: '#ffffff', fontSize: 14, fontWeight: '700', maxWidth: '100%' },
  profileRole: { color: 'rgba(255,255,255,0.75)', fontSize: 10, fontWeight: '700', letterSpacing: 0.5, marginTop: 4 },
  profileFactsRow: { flexDirection: 'row', width: '100%', marginTop: 18, gap: 10 },
  profileFact: { flex: 1, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 10, padding: 10, alignItems: 'center' },
  profileFactLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 9, fontWeight: '700', textTransform: 'uppercase' },
  profileFactValue: { color: '#ffffff', fontSize: 12, fontWeight: '700', marginTop: 4, textAlign: 'center' },

  agendaRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  agendaDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: ACCENT_BLUE, marginRight: 10, marginTop: 5 },
  agendaTitle: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  agendaSubtitle: { fontSize: 11, color: '#64748b', marginTop: 2 },
});
