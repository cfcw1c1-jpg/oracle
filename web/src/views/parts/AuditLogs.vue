<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { supabase } from '@/lib/supabase';

const MAX_LINES = 300;
const logs = ref([]);
const isLoading = ref(true);
const isConnected = ref(false);
const filterText = ref('');
let channel;

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatLine(row) {
  const date = new Date(row.created_at);
  const stamp = row.created_at ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` : '--:--:--';
  return row.event_type === 'view_member'
    ? { stamp, tag: 'VIEW  ', tone: 'view', text: `member="${row.member_name || 'unknown'}"  id=${row.member_id_no || '?'}` }
    : { stamp, tag: 'SEARCH', tone: 'search', text: `query="${row.query || ''}"  results=${row.results_count ?? '?'}` };
}

const visibleLines = computed(() => {
  const query = filterText.value.trim().toLowerCase();
  const rows = query ? logs.value.filter((row) => [row.event_type, row.query, row.member_name, row.member_id_no].filter(Boolean).some((value) => String(value).toLowerCase().includes(query))) : logs.value;
  return rows.map((row) => ({ id: row.id, ...formatLine(row) }));
});

onMounted(async () => {
  channel = supabase
    .channel('training_lookup_logs_feed')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'training_lookup_logs' }, (payload) => {
      logs.value = [payload.new, ...logs.value].slice(0, MAX_LINES);
    })
    .subscribe((status) => {
      isConnected.value = status === 'SUBSCRIBED';
    });
  const { data, error } = await supabase.from('training_lookup_logs').select('id, event_type, query, results_count, member_id_no, member_name, created_at').order('created_at', { ascending: false }).limit(MAX_LINES);
  if (!error) logs.value = data || [];
  isLoading.value = false;
});
onBeforeUnmount(() => supabase.removeChannel(channel));
</script>

<template>
  <section class="term">
    <header class="term-bar">
      <span class="dots"><i class="r" /><i class="y" /><i class="g" /></span>
      <span class="term-title clamp">root@oracle:~# tail -f training_lookup_logs</span>
      <span class="term-status"><i :class="{ live: isConnected }" />{{ isConnected ? 'LIVE' : 'CONNECTING' }}</span>
    </header>
    <label class="term-prompt">
      <span>grep&gt;</span>
      <input v-model="filterText" placeholder="filter by name, query, or event type..." autocapitalize="none" spellcheck="false" />
    </label>
    <div class="term-body" aria-live="polite">
      <p class="dim">$ <span class="cursor">▊</span></p>
      <p v-if="isLoading" class="dim">$ connecting to training_lookup_logs...</p>
      <p v-else-if="!visibleLines.length" class="dim"># no matching log entries</p>
      <p v-for="line in visibleLines" :key="line.id"><span class="dim">[{{ line.stamp }}] </span><span :class="line.tone">{{ line.tag }}</span>  {{ line.text }}</p>
    </div>
  </section>
</template>

<style scoped>
.term { background: #16161a; color: #d7dae0; border-radius: var(--radius-lg); overflow: hidden; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; }
.term-bar { display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: #202026; }
.dots { display: inline-flex; gap: 6px; }
.dots i { width: 10px; height: 10px; border-radius: 50%; }
.r { background: #ff5f57; } .y { background: #febc2e; } .g { background: #28c840; }
.term-title { flex: 1; color: #9aa0ac; }
.term-status { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: #9aa0ac; }
.term-status i { width: 7px; height: 7px; border-radius: 50%; background: #71717a; }
.term-status i.live { background: #28c840; }
.term-prompt { display: flex; align-items: center; gap: 8px; padding: 9px 14px; border-bottom: 1px solid #2c2c33; color: #28c840; }
.term-prompt input { flex: 1; background: none; border: 0; color: #e8eaed; outline: none; font: inherit; }
.term-body { height: 56vh; overflow-y: auto; padding: 12px 14px; white-space: pre-wrap; }
.term-body p { margin-bottom: 3px; }
.dim { color: #6b7280; }
.view { color: #f9d423; } .search { color: #4fd1ff; }
.cursor { animation: blink 1s steps(2) infinite; }
@keyframes blink { 50% { opacity: 0; } }
</style>
