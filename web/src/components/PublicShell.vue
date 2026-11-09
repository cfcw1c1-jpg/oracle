<script setup>
defineProps({ subtitle: { type: String, required: true } });
</script>

<template>
  <div class="pub">
    <header class="pub-head">
      <slot name="start" />
      <img src="/oracle-logo.png" alt="" />
      <strong>ORACLE</strong>
      <small>{{ subtitle }}</small>
    </header>
    <main class="pub-body"><slot /></main>
  </div>
</template>

<style scoped>
.pub { min-height: 100%; display: flex; flex-direction: column; background: var(--bg); }
.pub-head { display: flex; align-items: center; gap: 10px; padding: 16px 24px; background: var(--surface); border-bottom: 1px solid var(--line); }
.pub-head img { width: 26px; height: 23px; object-fit: contain; }
.pub-head strong { font-size: 17px; letter-spacing: 2px; }
.pub-head small { font-size: 11px; letter-spacing: 1px; color: var(--muted); margin-top: 3px; }
.pub-body { flex: 1; width: 100%; max-width: 760px; margin: 0 auto; padding: 24px 16px 48px; }
@media (max-width: 767.98px) {
  .pub-head { background: #002060; color: #fff; border: 0; padding: 14px 20px; padding-top: calc(14px + env(safe-area-inset-top)); }
  .pub-head small { color: #93c5fd; }
}
</style>
