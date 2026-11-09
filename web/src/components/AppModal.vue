<script setup>
import { X } from 'lucide-vue-next';
import { onBeforeUnmount, onMounted } from 'vue';

const props = defineProps({
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  width: { type: Number, default: 480 },
  locked: Boolean,
});
const emit = defineEmits(['close']);

function onKey(event) {
  if (event.key === 'Escape' && !props.locked) emit('close');
}
onMounted(() => document.addEventListener('keydown', onKey));
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <Teleport to="body">
    <div class="backdrop" @mousedown.self="!locked && $emit('close')">
      <section class="modal" role="dialog" aria-modal="true" :aria-label="title" :style="{ maxWidth: `${width}px` }">
        <header v-if="title" class="modal-head">
          <div class="grow">
            <h2 class="modal-title">{{ title }}</h2>
            <p v-if="subtitle" class="muted small">{{ subtitle }}</p>
          </div>
          <button v-if="!locked" class="icon-btn" aria-label="Close" @click="$emit('close')"><X :size="18" /></button>
        </header>
        <div class="modal-body"><slot /></div>
        <footer v-if="$slots.footer" class="modal-foot"><slot name="footer" /></footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.backdrop { position: fixed; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(30, 26, 20, 0.42); }
.modal { width: 100%; max-height: 90vh; display: flex; flex-direction: column; background: var(--surface); border-radius: var(--radius-lg); box-shadow: var(--shadow-pop); }
.modal-head { display: flex; align-items: flex-start; gap: 8px; padding: 18px 20px 6px; }
.modal-title { font-size: 16px; font-weight: var(--fw-heading); }
.modal-body { padding: 12px 20px 18px; overflow-y: auto; }
.modal-foot { display: flex; justify-content: flex-end; gap: 10px; padding: 12px 20px 18px; border-top: 1px solid var(--line); flex-wrap: wrap; }
</style>
