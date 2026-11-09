<script setup>
import { computed } from 'vue';
import { useIsWide } from '@/composables/useIsWide';

// segments: [{ label, count, color? }]
const props = defineProps({
  segments: { type: Array, required: true },
  centerValue: { type: String, default: '' },
  centerLabel: { type: String, default: '' },
});

const isWide = useIsWide();
// Desktop uses the neutral palette; phones keep each segment's own colour.
const PALETTE = ['var(--primary)', '#a58e72', '#d4c4ad', '#7f6e5b', '#e6ddd0', '#5c5346', '#bfae97', '#94826c'];
const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const total = computed(() => props.segments.reduce((sum, segment) => sum + segment.count, 0));

const arcs = computed(() => {
  let offset = 0;
  return props.segments.map((segment, index) => {
    const length = total.value ? (segment.count / total.value) * CIRCUMFERENCE : 0;
    const arc = {
      ...segment,
      color: !isWide.value && segment.color ? segment.color : PALETTE[index % PALETTE.length],
      dash: `${length} ${CIRCUMFERENCE - length}`,
      offset: -offset,
      percent: total.value ? Math.round((segment.count / total.value) * 100) : 0,
    };
    offset += length;
    return arc;
  });
});
</script>

<template>
  <div class="donut-wrap">
    <div class="donut">
      <svg viewBox="0 0 100 100" role="img" :aria-label="centerLabel || 'Breakdown'">
        <circle cx="50" cy="50" :r="RADIUS" class="donut-track" />
        <circle
          v-for="arc in arcs" :key="arc.label" cx="50" cy="50" :r="RADIUS" class="donut-arc"
          :stroke="arc.color" :stroke-dasharray="arc.dash" :stroke-dashoffset="arc.offset"
        />
      </svg>
      <div class="donut-center">
        <div class="donut-value">{{ centerValue }}</div>
        <div class="donut-label">{{ centerLabel }}</div>
      </div>
    </div>
    <ul class="legend">
      <li v-for="arc in arcs" :key="arc.label">
        <span class="dot" :style="{ background: arc.color }" />
        <span class="grow clamp">{{ arc.label }}</span>
        <span class="strong">{{ arc.count }}</span>
        <span class="muted small pct">{{ arc.percent }}%</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.donut-wrap { display: flex; align-items: center; gap: 26px; flex-wrap: wrap; }
.donut { position: relative; width: 150px; height: 150px; flex: none; }
.donut svg { width: 100%; height: 100%; transform: rotate(-90deg); }
.donut-track { fill: none; stroke: var(--surface-soft); stroke-width: 12; }
.donut-arc { fill: none; stroke-width: 12; }
.donut-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.donut-value { font-size: 22px; font-weight: 600; }
.donut-label { font-size: 10.5px; color: var(--muted); max-width: 90px; }
.legend { list-style: none; margin: 0; padding: 0; flex: 1; min-width: 170px; display: flex; flex-direction: column; gap: 9px; font-size: 13px; }
.legend li { display: flex; align-items: center; gap: 9px; }
.dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.pct { width: 36px; text-align: right; }
</style>
