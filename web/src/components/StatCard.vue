<script setup>
defineProps({
  label: { type: String, required: true },
  value: { type: [String, Number], required: true },
  hint: { type: String, default: '' },
  icon: { type: [Object, Function], default: null },
  active: Boolean,
});
defineEmits(['select']);
</script>

<template>
  <component :is="$attrs.onSelect ? 'button' : 'div'" class="card stat" :class="{ active }" @click="$emit('select')">
    <div class="row row-between">
      <span class="stat-label">{{ label }}</span>
      <span v-if="icon" class="icon-chip"><component :is="icon" :size="16" /></span>
    </div>
    <div class="stat-value">{{ value }}</div>
    <div v-if="hint" class="stat-hint">{{ hint }}</div>
  </component>
</template>

<style scoped>
.stat { padding: 18px; text-align: left; width: 100%; font: inherit; color: inherit; display: block; }
button.stat:hover { border-color: var(--accent); }
.stat.active { border-color: var(--primary); }
.stat-label { font-size: 12.5px; font-weight: 500; color: var(--ink-2); }
.stat-value { font-size: 26px; font-weight: var(--fw-medium); letter-spacing: -0.02em; margin-top: 8px; }
.stat-hint { font-size: 12px; color: var(--muted); margin-top: 4px; }
</style>
