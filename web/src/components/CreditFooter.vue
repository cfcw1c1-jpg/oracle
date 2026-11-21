<script setup>
// Credit for the company that built and donated Oracle.
</script>

<template>
  <footer class="credit">
    <span>Developed and Donated by</span>
    <a href="https://defyne.solutions/" target="_blank" rel="noopener" aria-label="Defyne Corporation (opens in a new tab)">
      <img src="/defyne-logo.png" alt="Defyne Corporation" width="84" height="26" />
    </a>
  </footer>
</template>

<style scoped>
.credit { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 8px; padding: 18px 16px 22px; font-size: 11.5px; color: var(--muted); }
.credit a { display: inline-flex; border-radius: 4px; }
.credit a:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.credit img { height: 26px; width: auto; display: block; }
</style>
