<script setup>
import { ArrowRight } from 'lucide-vue-next';
import { formatDiffValue } from '@/lib/audit';

defineProps({ diff: { type: Array, required: true } });
</script>

<template>
  <div v-if="diff.length" class="diff">
    <div v-for="item in diff" :key="item.key" class="diff-row">
      <span class="diff-key clamp">{{ item.key }}</span>
      <span class="diff-from">{{ formatDiffValue(item.from) }}</span>
      <ArrowRight :size="12" />
      <span class="diff-to">{{ formatDiffValue(item.to) }}</span>
    </div>
  </div>
  <p v-else class="muted small">No field-level changes recorded.</p>
</template>

<style scoped>
.diff { display: grid; gap: 6px; font-size: 12px; }
.diff-row { display: grid; grid-template-columns: minmax(90px, 200px) 1fr auto 1fr; gap: 8px; align-items: center; }
.diff-key { font-weight: var(--fw-medium); color: var(--ink); }
.diff-from { color: var(--danger); overflow-wrap: anywhere; }
.diff-to { color: var(--success); overflow-wrap: anywhere; }
@media (max-width: 560px) { .diff-row { grid-template-columns: 1fr auto 1fr; } .diff-key { grid-column: 1 / -1; } }
</style>
