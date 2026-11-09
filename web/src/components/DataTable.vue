<script setup>
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsLeft } from 'lucide-vue-next';
import { computed, ref, watch } from 'vue';

// columns: [{ key, label, value?(row), sortable?, action?, width?, align? }]
// Every column sorts except action columns. A slot named cell-<key> overrides
// how a cell renders; on phones each row becomes a labelled stack.
const props = defineProps({
  columns: { type: Array, required: true },
  rows: { type: Array, required: true },
  rowKey: { type: [String, Function], default: 'id' },
  emptyText: { type: String, default: 'No records found.' },
  initialSort: { type: Object, default: null },
  selectedKey: { type: [String, Number], default: null },
  expandedKey: { type: [String, Number], default: null },
  clickable: Boolean,
});
const emit = defineEmits(['row-click']);

const PAGE_SIZES = [10, 20, 30, 50, 100, 200];
const page = ref(1);
const pageSize = ref(PAGE_SIZES[0]);
const sort = ref(props.initialSort);

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function valueOf(column, row) {
  return column.value ? column.value(row) : row[column.key];
}

function keyOf(row) {
  return typeof props.rowKey === 'function' ? props.rowKey(row) : row[props.rowKey];
}

const sortedRows = computed(() => {
  if (!sort.value) return props.rows;
  const column = props.columns.find((candidate) => candidate.key === sort.value.key);
  if (!column) return props.rows;
  const direction = sort.value.ascending ? 1 : -1;
  return [...props.rows].sort((a, b) => {
    const left = valueOf(column, a);
    const right = valueOf(column, b);
    const leftEmpty = left === null || left === undefined || left === '';
    const rightEmpty = right === null || right === undefined || right === '';
    if (leftEmpty || rightEmpty) return Number(leftEmpty) - Number(rightEmpty);
    if (typeof left === 'number' && typeof right === 'number') return direction * (left - right);
    return direction * collator.compare(String(left), String(right));
  });
});

const pageCount = computed(() => Math.max(1, Math.ceil(sortedRows.value.length / pageSize.value)));
const safePage = computed(() => Math.min(page.value, pageCount.value));
const pageRows = computed(() => sortedRows.value.slice((safePage.value - 1) * pageSize.value, safePage.value * pageSize.value));
const rangeStart = computed(() => (sortedRows.value.length ? (safePage.value - 1) * pageSize.value + 1 : 0));
const rangeEnd = computed(() => Math.min(safePage.value * pageSize.value, sortedRows.value.length));

const pageList = computed(() => {
  const total = pageCount.value;
  const current = safePage.value;
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = [...new Set([1, total, current, Math.max(2, current - 1), Math.min(total - 1, current + 1)])].sort((a, b) => a - b);
  return pages.flatMap((value, index) => (index && value - pages[index - 1] > 1 ? ['gap', value] : [value]));
});

watch(() => props.rows, () => {
  page.value = Math.min(page.value, pageCount.value);
});

function toggleSort(column) {
  if (column.action || column.sortable === false) return;
  sort.value = sort.value?.key === column.key ? { key: column.key, ascending: !sort.value.ascending } : { key: column.key, ascending: true };
  page.value = 1;
}

function setPageSize(size) {
  pageSize.value = size;
  page.value = 1;
}

defineExpose({ sortedRows });
</script>

<template>
  <div class="dt">
    <div class="dt-scroll">
      <table>
        <thead>
          <tr>
            <th v-for="column in columns" :key="column.key" :style="{ width: column.width, textAlign: column.align }">
              <span v-if="column.action || column.sortable === false" class="th-text">{{ column.label }}</span>
              <button v-else class="th-sort" :aria-label="`Sort by ${column.label}`" @click="toggleSort(column)">
                <span>{{ column.label }}</span>
                <component :is="sort.ascending ? ArrowUp : ArrowDown" v-if="sort?.key === column.key" :size="11" />
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          <template v-for="row in pageRows" :key="keyOf(row)">
            <tr
              :class="{ clickable, selected: selectedKey !== null && keyOf(row) === selectedKey }"
              @click="clickable && emit('row-click', row)"
            >
              <td v-for="column in columns" :key="column.key" :data-label="column.label" :class="{ 'td-action': column.action }" :style="{ textAlign: column.align }">
                <slot :name="`cell-${column.key}`" :row="row" :value="valueOf(column, row)">{{ valueOf(column, row) ?? '—' }}</slot>
              </td>
            </tr>
            <tr v-if="expandedKey !== null && keyOf(row) === expandedKey" class="expanded">
              <td :colspan="columns.length"><slot name="expanded" :row="row" /></td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
    <div v-if="!rows.length" class="empty">{{ emptyText }}</div>
    <footer v-else class="dt-foot">
      <span class="muted small">{{ rangeStart }}–{{ rangeEnd }} of {{ sortedRows.length }}</span>
      <div class="row row-wrap">
        <div class="row dt-sizes">
          <span class="muted small">Rows</span>
          <button v-for="size in PAGE_SIZES" :key="size" class="chip" :class="{ on: size === pageSize }" @click="setPageSize(size)">{{ size }}</button>
        </div>
        <nav v-if="pageCount > 1" class="row dt-pages" aria-label="Pagination">
          <button class="chip" :disabled="safePage === 1" aria-label="First page" @click="page = 1"><ChevronsLeft :size="13" /></button>
          <button class="chip" :disabled="safePage === 1" aria-label="Previous page" @click="page = safePage - 1"><ChevronLeft :size="13" /></button>
          <template v-for="(value, index) in pageList" :key="`${value}-${index}`">
            <span v-if="value === 'gap'" class="muted">…</span>
            <button v-else class="chip" :class="{ on: value === safePage }" @click="page = value">{{ value }}</button>
          </template>
          <button class="chip" :disabled="safePage === pageCount" aria-label="Next page" @click="page = safePage + 1"><ChevronRight :size="13" /></button>
        </nav>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.dt-scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; padding: 9px 14px; font-size: 11.5px; font-weight: 500; color: var(--muted); border-bottom: 1px solid var(--line); white-space: nowrap; }
.th-sort { display: inline-flex; align-items: center; gap: 4px; border: 0; background: none; padding: 0; font-size: inherit; font-weight: inherit; color: inherit; }
.th-sort:hover { color: var(--ink); }
td { padding: 12px 14px; border-bottom: 1px solid var(--line); vertical-align: middle; color: var(--ink-2); }
tbody tr:last-child td { border-bottom: 0; }
tr.clickable { cursor: pointer; }
tr.clickable:hover td { background: var(--surface-hover); }
tr.selected td { background: var(--accent-soft); }
tr.expanded td { background: var(--surface-hover); }
.td-action { white-space: nowrap; }
.dt-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px; border-top: 1px solid var(--line); flex-wrap: wrap; }
.dt-sizes, .dt-pages { gap: 3px; }
.dt-sizes { margin-right: 6px; }
.dt-sizes .muted { margin-right: 4px; }
.chip { display: inline-flex; align-items: center; justify-content: center; min-width: 27px; height: 27px; padding: 0 6px; border: 0; border-radius: 7px; background: transparent; color: var(--ink-2); font-size: 12px; font-weight: 600; }
.chip:hover:not(:disabled) { background: var(--surface-soft); }
.chip.on { background: var(--primary); color: var(--primary-ink); }

@media (max-width: 767.98px) {
  thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  table, tbody, tr, td { display: block; width: 100%; }
  tr { padding: 10px 14px; border-bottom: 1px solid var(--line); }
  tbody tr:last-child { border-bottom: 0; }
  td { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; padding: 4px 0; border: 0; text-align: right !important; }
  td::before { content: attr(data-label); color: var(--muted); font-size: 12px; text-align: left; flex: none; max-width: 45%; }
  td:empty::after { content: '—'; }
  td.td-action::before { content: none; }
  tr.expanded td::before { content: none; }
  tr.expanded td { display: block; text-align: left !important; }
  td.td-action { justify-content: flex-start; flex-wrap: wrap; padding-top: 8px; }
}
</style>
