<script setup>
import { formatSeconds } from '@/lib/pushProgress';

// A push's progress bar: the current step, how far along, and time left.
defineProps({ view: { type: Object, required: true }, note: { type: String, default: '' } });
</script>

<template>
  <div class="push-progress" role="status" aria-live="polite">
    <div class="line">
      <span class="small strong">{{ view.label }}…</span>
      <span class="muted tiny">{{ view.percent }}% · {{ formatSeconds(view.secondsLeft) }} left</span>
    </div>
    <div class="track" role="progressbar" :aria-valuenow="view.percent" aria-valuemin="0" aria-valuemax="100"><div class="fill" :style="{ width: `${view.percent}%` }" /></div>
    <p v-if="note" class="muted tiny">{{ note }}</p>
  </div>
</template>

<style scoped>
.push-progress { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; background: var(--accent-soft); border-radius: var(--radius-sm); }
.push-progress p { margin: 0; }
.line { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.track { height: 8px; border-radius: 999px; background: rgba(127, 127, 127, 0.2); overflow: hidden; }
.fill { height: 100%; border-radius: 999px; background: var(--accent, #2563eb); transition: width 0.8s ease; }
</style>
