<script setup>
import { ArrowLeft, ArrowRight, Cake, Heart } from 'lucide-vue-next';
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import MemberAnniversaries from '@/components/MemberAnniversaries.vue';
import MemberBirthdays from '@/components/MemberBirthdays.vue';
import PageHead from '@/components/PageHead.vue';

// Each report is a card; opening one shows its component below. To add a
// report, add an entry here with its component. The open report is kept in
// the URL (?report=key) so Back and refresh work.
const REPORTS = [
  {
    key: 'birthdays',
    title: 'Member Birthdays',
    description: 'Members celebrating their birthday in a chosen month, with the age they turn. Filter by area and status, then export to CSV.',
    icon: Cake,
    component: MemberBirthdays,
  },
  {
    key: 'anniversaries',
    title: 'Wedding Anniversaries',
    description: 'Couples celebrating their church wedding anniversary in a chosen month, with the years married. Filter by area and status, then export to CSV or make a greeting image.',
    icon: Heart,
    component: MemberAnniversaries,
  },
];

const route = useRoute();
const router = useRouter();

const openReport = computed(() => REPORTS.find((report) => report.key === route.query.report) ?? null);

function open(key) {
  router.push({ query: { ...route.query, report: key } });
}

function close() {
  const { report: _report, ...rest } = route.query;
  router.push({ query: rest });
}
</script>

<template>
  <div class="page">
    <template v-if="openReport">
      <div><button class="link-btn" @click="close"><ArrowLeft :size="14" />All reports</button></div>
      <PageHead :title="openReport.title" :subtitle="openReport.description" />
      <component :is="openReport.component" />
    </template>
    <template v-else>
      <PageHead title="Reports" subtitle="Choose a report. Each one is worked out from the members saved in Oracle." />
      <div class="report-grid">
        <button v-for="report in REPORTS" :key="report.key" class="card report-card" @click="open(report.key)">
          <span class="icon-chip"><component :is="report.icon" :size="18" /></span>
          <span class="report-title">{{ report.title }}</span>
          <span class="report-desc">{{ report.description }}</span>
          <span class="report-open">Open report<ArrowRight :size="14" /></span>
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.report-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
.report-card { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 20px; text-align: left; font: inherit; color: inherit; cursor: pointer; transition: transform 0.25s, box-shadow 0.3s, border-color 0.25s; }
.report-card:hover { transform: translateY(-3px); border-color: var(--accent); }
.report-card:focus-visible { outline: none; box-shadow: var(--focus-ring); border-color: var(--primary); }
.report-title { font-size: 15px; font-weight: var(--fw-heading); margin-top: 4px; }
.report-desc { font-size: 12.5px; color: var(--muted); line-height: 1.5; flex: 1; }
.report-open { display: inline-flex; align-items: center; gap: 4px; margin-top: 6px; font-size: 12.5px; font-weight: var(--fw-medium); color: var(--link); }
@media (prefers-reduced-motion: reduce) { .report-card, .report-card:hover { transition: none; transform: none; } }
</style>
