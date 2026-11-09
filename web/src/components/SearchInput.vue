<script setup>
import { Search } from 'lucide-vue-next';

defineProps({ placeholder: { type: String, default: 'Search...' } });
const model = defineModel({ type: String, default: '' });
</script>

<template>
  <label class="search-input">
    <Search :size="15" />
    <span class="sr-only">{{ placeholder }}</span>
    <input v-model="model" class="input" type="search" :placeholder="placeholder" />
  </label>
</template>
