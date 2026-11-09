<script setup>
import { History, ShieldCheck, Terminal } from 'lucide-vue-next';
import { ref } from 'vue';
import PageHead from '@/components/PageHead.vue';
import AuditLogs from '@/views/parts/AuditLogs.vue';
import MemberChangeHistory from '@/views/parts/MemberChangeHistory.vue';
import SystemAuditLog from '@/views/parts/SystemAuditLog.vue';

const TABS = [
  { key: 'trainingLookup', label: 'Training Lookup Logs', icon: Terminal, panel: AuditLogs },
  { key: 'systemAudit', label: 'System Audit Log', icon: ShieldCheck, panel: SystemAuditLog },
  { key: 'memberChangeHistory', label: 'Member Change History', icon: History, panel: MemberChangeHistory },
];
const activeTab = ref(TABS[0]);
</script>

<template>
  <div class="page">
    <PageHead title="Logs" subtitle="Every recorded activity in the portal, in one place." />
    <div class="tabs" role="tablist">
      <button v-for="tab in TABS" :key="tab.key" class="tab row" :class="{ active: tab.key === activeTab.key }" role="tab" :aria-selected="tab.key === activeTab.key" @click="activeTab = tab">
        <component :is="tab.icon" :size="14" />{{ tab.label }}
      </button>
    </div>
    <component :is="activeTab.panel" :key="activeTab.key" />
  </div>
</template>
