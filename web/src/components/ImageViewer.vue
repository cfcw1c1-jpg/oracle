<script setup>
import { ChevronLeft, ChevronRight, Download, RotateCw, X, ZoomIn, ZoomOut } from 'lucide-vue-next';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

// Full-screen image viewer: zoom (buttons, wheel, double-click, pinch), drag
// to pan when zoomed, rotate, previous/next with a thumbnail strip, keyboard
// (Esc, ←/→, +/−, 0, R) and Download.
//   images: [{ id, name, url, meta }]   url may be null while it loads
//   index:  which image is shown (v-model:index)
const props = defineProps({
  images: { type: Array, required: true },
  index: { type: Number, default: 0 },
});
const emit = defineEmits(['update:index', 'close', 'download', 'need-url']);

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const zoom = ref(1);
const rotation = ref(0);
const offset = ref({ x: 0, y: 0 });
const isLoaded = ref(false);
const stage = ref(null);
const dialog = ref(null);

const current = computed(() => props.images[props.index] ?? null);
const hasMany = computed(() => props.images.length > 1);
const imageStyle = computed(() => ({
  transform: `translate(${offset.value.x}px, ${offset.value.y}px) scale(${zoom.value}) rotate(${rotation.value}deg)`,
  cursor: zoom.value > 1 ? (isPanning.value ? 'grabbing' : 'grab') : 'zoom-in',
  transition: isPanning.value ? 'none' : 'transform 0.18s ease',
}));

function reset() {
  zoom.value = 1;
  rotation.value = 0;
  offset.value = { x: 0, y: 0 };
}

function go(step) {
  if (!hasMany.value) return;
  emit('update:index', (props.index + step + props.images.length) % props.images.length);
}

function setZoom(value, origin = null) {
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
  if (origin && stage.value) {
    // Keeps the point under the cursor still while zooming.
    const box = stage.value.getBoundingClientRect();
    const cx = origin.x - box.left - box.width / 2;
    const cy = origin.y - box.top - box.height / 2;
    const ratio = next / zoom.value;
    offset.value = { x: cx - (cx - offset.value.x) * ratio, y: cy - (cy - offset.value.y) * ratio };
  }
  zoom.value = next;
  if (next === 1) offset.value = { x: 0, y: 0 };
}

function onWheel(event) {
  event.preventDefault();
  setZoom(zoom.value * (event.deltaY < 0 ? 1.15 : 1 / 1.15), { x: event.clientX, y: event.clientY });
}

function onDoubleClick(event) {
  if (zoom.value > 1) reset();
  else setZoom(2.5, { x: event.clientX, y: event.clientY });
}

// Drag to pan (mouse or one finger) and pinch to zoom (two fingers).
let dragging = null;
let pinch = null;
const pointers = new Map();
// Turns the zoom animation off while a finger or the mouse moves the image.
const isPanning = ref(false);

function onPointerDown(event) {
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  event.currentTarget.setPointerCapture?.(event.pointerId);
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: zoom.value };
    dragging = null;
    isPanning.value = true;
  } else if (zoom.value > 1) {
    dragging = { x: event.clientX - offset.value.x, y: event.clientY - offset.value.y };
    isPanning.value = true;
  } else {
    // At normal size a horizontal swipe changes image.
    dragging = { swipeStart: event.clientX };
  }
}

function onPointerMove(event) {
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    setZoom(pinch.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance), { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  } else if (dragging && dragging.swipeStart === undefined) {
    offset.value = { x: event.clientX - dragging.x, y: event.clientY - dragging.y };
  }
}

function onPointerUp(event) {
  if (dragging?.swipeStart !== undefined) {
    const moved = event.clientX - dragging.swipeStart;
    if (Math.abs(moved) > 60) go(moved < 0 ? 1 : -1);
  }
  pointers.delete(event.pointerId);
  if (pointers.size < 2) pinch = null;
  if (!pointers.size) {
    dragging = null;
    isPanning.value = false;
  }
}

function onKey(event) {
  const actions = {
    Escape: () => emit('close'),
    ArrowLeft: () => go(-1),
    ArrowRight: () => go(1),
    '+': () => setZoom(zoom.value * 1.25),
    '=': () => setZoom(zoom.value * 1.25),
    '-': () => setZoom(zoom.value / 1.25),
    0: reset,
    r: () => (rotation.value += 90),
    R: () => (rotation.value += 90),
  };
  const action = actions[event.key];
  if (action) {
    event.preventDefault();
    action();
  }
}

function askForUrls() {
  // The shown image and its neighbours, so stepping through feels instant.
  for (const step of [0, 1, -1]) {
    const image = props.images[(props.index + step + props.images.length) % props.images.length];
    if (image && !image.url) emit('need-url', image.id);
  }
}

watch(() => props.index, () => {
  reset();
  isLoaded.value = false;
  askForUrls();
  nextTick(() => document.querySelector('.iv-strip .on')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }));
});
watch(() => current.value?.url, () => {
  isLoaded.value = false;
});

let previousOverflow = '';
onMounted(() => {
  previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  window.addEventListener('keydown', onKey);
  askForUrls();
  dialog.value?.focus();
});
onBeforeUnmount(() => {
  document.body.style.overflow = previousOverflow;
  window.removeEventListener('keydown', onKey);
});
</script>

<template>
  <Teleport to="body">
    <div ref="dialog" class="iv" role="dialog" aria-modal="true" :aria-label="current?.name || 'Image viewer'" tabindex="-1">
      <header class="iv-top">
        <div class="iv-title">
          <strong class="iv-name">{{ current?.name }}</strong>
          <span class="iv-meta">{{ hasMany ? `${index + 1} of ${images.length}` : '' }}{{ hasMany && current?.meta ? ' · ' : '' }}{{ current?.meta }}</span>
        </div>
        <div class="iv-tools">
          <button class="iv-btn" aria-label="Zoom out" title="Zoom out (−)" :disabled="zoom <= MIN_ZOOM" @click="setZoom(zoom / 1.25)"><ZoomOut :size="18" /></button>
          <button class="iv-btn iv-zoom" title="Reset zoom (0)" @click="reset">{{ Math.round(zoom * 100) }}%</button>
          <button class="iv-btn" aria-label="Zoom in" title="Zoom in (+)" :disabled="zoom >= MAX_ZOOM" @click="setZoom(zoom * 1.25)"><ZoomIn :size="18" /></button>
          <button class="iv-btn" aria-label="Rotate" title="Rotate (R)" @click="rotation += 90"><RotateCw :size="18" /></button>
          <button class="iv-btn" aria-label="Download" title="Download" @click="emit('download', current)"><Download :size="18" /></button>
          <button class="iv-btn" aria-label="Close" title="Close (Esc)" @click="emit('close')"><X :size="20" /></button>
        </div>
      </header>

      <div
        ref="stage"
        class="iv-stage"
        @wheel="onWheel"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @click.self="zoom === 1 && emit('close')"
      >
        <span v-if="!current?.url || !isLoaded" class="iv-spinner" aria-label="Loading image" />
        <img
          v-if="current?.url"
          :key="current.id"
          :src="current.url"
          :alt="current.name"
          class="iv-img"
          :class="{ ready: isLoaded }"
          :style="imageStyle"
          draggable="false"
          @load="isLoaded = true"
          @dblclick="onDoubleClick"
        />
        <button v-if="hasMany" class="iv-nav prev" aria-label="Previous image" @click.stop="go(-1)"><ChevronLeft :size="28" /></button>
        <button v-if="hasMany" class="iv-nav next" aria-label="Next image" @click.stop="go(1)"><ChevronRight :size="28" /></button>
      </div>

      <nav v-if="hasMany" class="iv-strip" aria-label="All images">
        <button v-for="(image, position) in images" :key="image.id" :class="{ on: position === index }" :aria-label="`Show ${image.name}`" @click="emit('update:index', position)">
          <img v-if="image.url" :src="image.url" alt="" loading="lazy" />
        </button>
      </nav>
    </div>
  </Teleport>
</template>

<style scoped>
.iv { position: fixed; inset: 0; z-index: 1000; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; background: rgba(8, 10, 16, 0.94); color: #fff; outline: none; }
.iv-top { display: flex; align-items: center; gap: 16px; padding: 12px 16px; background: linear-gradient(rgba(0, 0, 0, 0.55), transparent); }
.iv-title { min-width: 0; flex: 1; display: grid; gap: 2px; }
.iv-name { font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iv-meta { font-size: 12px; color: rgba(255, 255, 255, 0.65); }
.iv-tools { display: flex; align-items: center; gap: 4px; }
.iv-btn { display: inline-flex; align-items: center; justify-content: center; min-width: 38px; height: 38px; padding: 0 8px; border: 0; border-radius: 10px; background: rgba(255, 255, 255, 0.08); color: #fff; cursor: pointer; font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
.iv-btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.18); }
.iv-btn:disabled { opacity: 0.35; cursor: default; }
.iv-btn:focus-visible, .iv-nav:focus-visible, .iv-strip button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.iv-zoom { min-width: 56px; }
.iv-stage { position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center; touch-action: none; user-select: none; }
.iv-img { max-width: calc(100% - 120px); max-height: calc(100% - 24px); object-fit: contain; opacity: 0; will-change: transform; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5); }
.iv-img.ready { opacity: 1; }
.iv-spinner { position: absolute; width: 36px; height: 36px; border: 3px solid rgba(255, 255, 255, 0.2); border-top-color: #fff; border-radius: 50%; animation: iv-spin 0.8s linear infinite; }
@keyframes iv-spin { to { transform: rotate(360deg); } }
.iv-nav { position: absolute; top: 50%; transform: translateY(-50%); width: 48px; height: 48px; border: 0; border-radius: 50%; background: rgba(255, 255, 255, 0.1); color: #fff; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.iv-nav:hover { background: rgba(255, 255, 255, 0.22); }
.iv-nav.prev { left: 16px; }
.iv-nav.next { right: 16px; }
.iv-strip { display: flex; gap: 8px; padding: 10px 16px 14px; overflow-x: auto; justify-content: safe center; background: linear-gradient(transparent, rgba(0, 0, 0, 0.55)); }
.iv-strip button { flex: none; width: 64px; height: 48px; padding: 0; border: 2px solid transparent; border-radius: 8px; overflow: hidden; background: rgba(255, 255, 255, 0.08); cursor: pointer; opacity: 0.55; transition: opacity 0.15s ease, border-color 0.15s ease; }
.iv-strip button:hover { opacity: 0.85; }
.iv-strip button.on { opacity: 1; border-color: #fff; }
.iv-strip img { width: 100%; height: 100%; object-fit: cover; display: block; }
@media (max-width: 640px) {
  .iv-img { max-width: 100%; }
  .iv-nav { display: none; }
  .iv-tools .iv-btn:not(:last-child):not(:nth-last-child(2)) { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .iv-img { transition: none !important; }
  .iv-spinner { animation-duration: 2s; }
}
</style>
