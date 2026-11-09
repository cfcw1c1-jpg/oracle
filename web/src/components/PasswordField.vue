<script setup>
import { Eye, EyeOff } from 'lucide-vue-next';
import { ref } from 'vue';

defineProps({
  label: { type: String, default: '' },
  placeholder: { type: String, default: '' },
  autocomplete: { type: String, default: 'off' },
  maxlength: { type: Number, default: null },
});
const model = defineModel({ type: String, default: '' });
const isVisible = ref(false);
</script>

<template>
  <label class="field">
    <span v-if="label" class="field-label">{{ label }}</span>
    <span class="pw">
      <input
        v-model="model" class="input" :type="isVisible ? 'text' : 'password'" :placeholder="placeholder"
        :autocomplete="autocomplete" :maxlength="maxlength" autocapitalize="none" spellcheck="false"
      />
      <button type="button" class="pw-toggle" :aria-label="isVisible ? 'Hide password' : 'Show password'" @click="isVisible = !isVisible">
        <component :is="isVisible ? EyeOff : Eye" :size="17" />
      </button>
    </span>
  </label>
</template>

<style scoped>
.pw { position: relative; display: block; }
.pw .input { padding-right: 40px; }
.pw-toggle { position: absolute; top: 0; bottom: 0; right: 8px; border: 0; background: none; color: var(--muted); display: flex; align-items: center; padding: 0 4px; }
</style>
