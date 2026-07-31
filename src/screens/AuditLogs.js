import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { supabase } from '../../lib/supabase';

const MONOSPACE = Platform.select({
  ios: 'Courier',
  android: 'monospace',
  web: 'ui-monospace, SFMono-Regular, "Courier New", Menlo, Monaco, Consolas, monospace',
  default: 'monospace',
});

const MAX_LINES = 300;

function formatTimestamp(iso) {
  if (!iso) return '--:--:--';
  const d = new Date(iso);
  const pad = (n) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatLine(row) {
  const ts = formatTimestamp(row.created_at);
  if (row.event_type === 'view_member') {
    return {
      ts,
      tag: 'VIEW  ',
      tagColor: '#f9d423',
      text: `member="${row.member_name || 'unknown'}"  id=${row.member_id_no || '?'}`,
    };
  }
  return {
    ts,
    tag: 'SEARCH',
    tagColor: '#4fd1ff',
    text: `query="${row.query || ''}"  results=${row.results_count ?? '?'}`,
  };
}

// Live-tailing audit trail for the training_lookup_logs table, styled like
// a Linux terminal. Requires the table to be added to the supabase_realtime
// publication (scripts/sql/enable-realtime-training-lookup-logs.sql).
export default function AuditLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [filterText, setFilterText] = useState('');
  const scrollRef = useRef(null);
  const [cursorOpacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    let isMounted = true;

    async function loadInitial() {
      const { data, error } = await supabase
        .from('training_lookup_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(MAX_LINES);
      if (!isMounted) return;
      if (!error) setLogs(data || []);
      setLoading(false);
    }
    loadInitial();

    const channel = supabase
      .channel('training_lookup_logs_feed')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'training_lookup_logs' },
        (payload) => {
          setLogs((prev) => [payload.new, ...prev].slice(0, MAX_LINES));
        }
      )
      .subscribe((status) => {
        if (isMounted) setConnected(status === 'SUBSCRIBED');
      });

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(cursorOpacity, { toValue: 0, duration: 500, useNativeDriver: true }),
        Animated.timing(cursorOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [cursorOpacity]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter((row) =>
      [row.event_type, row.query, row.member_name, row.member_id_no]
        .filter(Boolean)
        .some((v) => v.toString().toLowerCase().includes(q))
    );
  }, [logs, filterText]);

  return (
    <View style={styles.container}>
      <View style={styles.titleBar}>
        <View style={styles.trafficLights}>
          <View style={[styles.dot, { backgroundColor: '#ff5f57' }]} />
          <View style={[styles.dot, { backgroundColor: '#febc2e' }]} />
          <View style={[styles.dot, { backgroundColor: '#28c840' }]} />
        </View>
        <Text style={styles.titleText}>root@oracle:~# tail -f training_lookup_logs</Text>
        <View style={styles.statusWrap}>
          <View style={[styles.statusDot, { backgroundColor: connected ? '#28c840' : '#71717a' }]} />
          <Text style={styles.statusText}>{connected ? 'LIVE' : 'CONNECTING'}</Text>
        </View>
      </View>

      <View style={styles.promptRow}>
        <Text style={styles.promptLabel}>grep&gt;</Text>
        <TextInput
          value={filterText}
          onChangeText={setFilterText}
          placeholder="filter by name, query, or event type..."
          placeholderTextColor="#4a5568"
          style={styles.promptInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.terminal}
        contentContainerStyle={styles.terminalContent}
      >
        <View style={styles.cursorRow}>
          <Text style={styles.dimText}>$ </Text>
          <Animated.Text style={[styles.cursor, { opacity: cursorOpacity }]}>▊</Animated.Text>
        </View>
        {loading ? (
          <Text style={styles.dimLine}>$ connecting to training_lookup_logs...</Text>
        ) : filteredLogs.length === 0 ? (
          <Text style={styles.dimLine}># no matching log entries</Text>
        ) : (
          filteredLogs.map((row) => {
            const line = formatLine(row);
            return (
              <Text key={row.id} style={styles.logLine}>
                <Text style={styles.dimText}>[{line.ts}] </Text>
                <Text style={{ color: line.tagColor }}>{line.tag}</Text>
                <Text style={styles.logText}>  {line.text}</Text>
              </Text>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0e14' },

  titleBar: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#161b22',
    paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 1, borderColor: '#000',
  },
  trafficLights: { flexDirection: 'row', gap: 6, marginRight: 14 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  titleText: { flex: 1, color: '#8b949e', fontSize: 12, fontFamily: MONOSPACE },
  statusWrap: { flexDirection: 'row', alignItems: 'center' },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  statusText: { color: '#8b949e', fontSize: 11, fontFamily: MONOSPACE, letterSpacing: 1 },

  promptRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#0d1117',
    paddingVertical: 8, paddingHorizontal: 14, borderBottomWidth: 1, borderColor: '#1f2630',
  },
  promptLabel: { color: '#4fd1ff', fontFamily: MONOSPACE, fontSize: 13, marginRight: 8 },
  promptInput: { flex: 1, color: '#e6edf3', fontFamily: MONOSPACE, fontSize: 13, padding: 0 },

  terminal: { flex: 1, backgroundColor: '#0a0e14' },
  terminalContent: { padding: 14 },
  logLine: { fontFamily: MONOSPACE, fontSize: 12.5, lineHeight: 20 },
  logText: { color: '#c9d1d9' },
  dimText: { color: '#4a5568' },
  dimLine: { fontFamily: MONOSPACE, fontSize: 12.5, color: '#4a5568' },
  cursorRow: { flexDirection: 'row', marginBottom: 6 },
  cursor: { color: '#28c840', fontFamily: MONOSPACE, fontSize: 13 },
});
