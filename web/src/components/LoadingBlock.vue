<script setup>
defineProps({ full: Boolean });
</script>

<template>
  <div class="loading" :class="{ full }" role="status" aria-label="Loading">
    <span class="spinner" />
  </div>
</template>

<style scoped>
.loading { display: flex; align-items: center; justify-content: center; padding: 48px 0; }
.loading.full { height: 100%; padding: 0; }
</style>
