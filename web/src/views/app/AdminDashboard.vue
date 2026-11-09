<script setup>
import { Eye, LayoutGrid, RefreshCw, Trophy } from 'lucide-vue-next';
import { computed, onMounted, ref } from 'vue';
import LoadingBlock from '@/components/LoadingBlock.vue';
import PageHead from '@/components/PageHead.vue';
import StatCard from '@/components/StatCard.vue';
import { showAlert } from '@/lib/data';
import { supabase } from '@/lib/supabase';

// Settings and Logs are configuration pages, so popularity isn't meaningful.
const EXCLUDED_PAGE_KEYS = new Set(['settings', 'logs']);

const isLoading = ref(true);
const pageViews = ref([]);

const totalViews = computed(() => pageViews.value.reduce((sum, page) => sum + page.count, 0));
const maxCount = computed(() => pageViews.value.reduce((max, page) => Math.max(max, page.count), 0));
const topPage = computed(() => pageViews.value[0]);

function barWidth(count) {
  return maxCount.value > 0 ? Math.max((count / maxCount.value) * 100, count > 0 ? 3 : 0) : 0;
}

async function loadData() {
  isLoading.value = true;
  try {
    const [pagesResult, logs] = await Promise.all([
      supabase.from('pages').select('key, label').order('sort_order'),
      fetchPageViewRows(),
    ]);
    if (pagesResult.error) throw pagesResult.error;
    const counts = {};
    logs.forEach((row) => {
      const key = (row.table_name || '').replace(/^page:/, '');
      counts[key] = (counts[key] || 0) + 1;
    });
    pageViews.value = (pagesResult.data || [])
      .filter((page) => !EXCLUDED_PAGE_KEYS.has(page.key))
      .map((page) => ({ key: page.key, label: page.label, count: counts[page.key] || 0 }))
      .sort((a, b) => b.count - a.count);
  } catch (error) {
    showAlert('Error Loading Admin Dashboard', error.message);
  } finally {
    isLoading.value = false;
  }
}

async function fetchPageViewRows() {
  const pageSize = 1000;
  let all = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from('audit_log').select('table_name').eq('action', 'PAGE_VIEW').order('id').range(from, from + pageSize - 1);
    if (error) throw error;
    all = all.concat(data || []);
    if ((data || []).length < pageSize) return all;
  }
}

onMounted(loadData);
</script>

<template>
  <LoadingBlock v-if="isLoading" />
  <div v-else class="page">
    <PageHead title="Admin Dashboard" subtitle="Page popularity across the portal, admin-only.">
      <button class="btn" @click="loadData"><RefreshCw :size="14" />Refresh</button>
    </PageHead>

    <section class="grid grid-4">
      <StatCard label="Total Page Views" :value="totalViews" :icon="Eye" />
      <StatCard label="Most Viewed Page" :value="topPage?.count ? topPage.label : '—'" :icon="Trophy" />
      <StatCard label="Pages Tracked" :value="pageViews.length" :icon="LayoutGrid" />
    </section>

    <section class="card card-pad stack">
      <h2 class="card-title">Page Views by Page</h2>
      <p v-if="!pageViews.length" class="empty">No pages found.</p>
      <p v-else-if="!totalViews" class="empty">No page views recorded yet.</p>
      <template v-else>
        <div v-for="(page, index) in pageViews" :key="page.key" class="bar-row">
          <div class="row row-between"><span class="clamp">{{ page.label }}</span><strong>{{ page.count }}</strong></div>
          <div class="bar"><span class="bar-fill" :class="{ top: index === 0 && page.count > 0 }" :style="{ width: `${barWidth(page.count)}%` }" /></div>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.bar-row { font-size: 13px; color: var(--ink-2); }
.bar { height: 7px; border-radius: 4px; background: var(--surface-soft); margin-top: 6px; overflow: hidden; }
.bar-fill { display: block; height: 100%; border-radius: 4px; background: var(--accent); }
.bar-fill.top { background: var(--primary); }
</style>
