<script setup>
defineProps({ title: { type: String, required: true }, subtitle: { type: String, default: '' } });
</script>

<template>
  <header class="page-head">
    <div>
      <h1 class="page-title">{{ title }}</h1>
      <p v-if="subtitle" class="page-sub">{{ subtitle }}</p>
    </div>
    <div v-if="$slots.default" class="page-actions"><slot /></div>
  </header>
</template>
