<script setup>
import { ChevronDown } from 'lucide-vue-next';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

// options: [{ value, label }]. An empty selection means "no filter".
const props = defineProps({
  options: { type: Array, required: true },
  allLabel: { type: String, default: 'All' },
  noun: { type: String, default: 'item' },
  searchable: Boolean,
});
const selected = defineModel({ type: Array, default: () => [] });

const root = ref(null);
const isOpen = ref(false);
const query = ref('');

const summary = computed(() => {
  if (!selected.value.length) return props.allLabel;
  const names = props.options.filter((option) => selected.value.includes(option.value)).map((option) => option.label);
  return names.length <= 2 ? names.join(', ') : `${selected.value.length} ${props.noun}s selected`;
});

const visibleOptions = computed(() => {
  const text = query.value.trim().toLowerCase();
  return text ? props.options.filter((option) => option.label.toLowerCase().includes(text)) : props.options;
});

function toggle(value) {
  selected.value = selected.value.includes(value) ? selected.value.filter((item) => item !== value) : [...selected.value, value];
}

function closeOnOutside(event) {
  if (!root.value?.contains(event.target)) isOpen.value = false;
}
onMounted(() => document.addEventListener('mousedown', closeOnOutside));
onBeforeUnmount(() => document.removeEventListener('mousedown', closeOnOutside));
</script>

<template>
  <div ref="root" class="ms">
    <button type="button" class="select ms-head" :aria-expanded="isOpen" @click="isOpen = !isOpen">
      <span class="clamp">{{ summary }}</span><ChevronDown :size="14" />
    </button>
    <div v-if="isOpen" class="ms-menu">
      <input v-if="searchable" v-model="query" class="input" type="search" :placeholder="`Search ${noun}s...`" />
      <div class="ms-list">
        <label v-for="option in visibleOptions" :key="option.value" class="check ms-item">
          <input type="checkbox" :checked="selected.includes(option.value)" @change="toggle(option.value)" />
          <span class="clamp">{{ option.label }}</span>
        </label>
        <p v-if="!visibleOptions.length" class="muted small ms-empty">No matches.</p>
      </div>
      <button type="button" class="link-btn" @click="selected = []">Clear</button>
    </div>
  </div>
</template>

<style scoped>
.ms { position: relative; min-width: 190px; }
.ms-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; text-align: left; }
.ms-menu { position: absolute; z-index: 40; top: calc(100% + 5px); left: 0; width: max(100%, 270px); padding: 10px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-md); box-shadow: var(--shadow-pop); }
.ms-list { width: 100%; max-height: 230px; overflow-y: auto; }
.ms-item { display: flex; width: 100%; padding: 6px 4px; }
.ms-empty { padding: 8px 4px; }
</style>
