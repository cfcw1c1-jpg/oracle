<script setup>
// Shimmering placeholders shaped like what is loading.
//   table (default)  rows of cells, for tables and lists inside a card
//   page             a page header, stat cards and a table card
//   list             avatar + two lines per row (conversations, people)
//   chat             message bubbles on alternating sides
//   text             a few lines of text
//   shell            the whole app frame, while the signed-in session loads
//                    (the default when full is set)
//   splash           a pulsing logo, before it is known whether anyone is signed in
const props = defineProps({
  variant: { type: String, default: 'table' },
  rows: { type: Number, default: 5 },
  full: Boolean,
});

// Varied widths so the placeholder reads as real content, not stripes.
const WIDTHS = ['92%', '78%', '86%', '64%', '81%', '70%', '88%', '74%'];
const width = (index) => WIDTHS[index % WIDTHS.length];
const shape = props.full && props.variant === 'table' ? 'shell' : props.variant;
</script>

<template>
  <div class="sk-wrap" :class="[`sk-${shape}`, { full }]" role="status" aria-busy="true" aria-label="Loading">
    <!-- Neutral start-up screen -->
    <template v-if="shape === 'splash'">
      <div class="sk-splash" aria-hidden="true">
        <span class="sk-splash-mark"><img src="/oracle-logo.png" alt="" /></span>
        <span class="sk sk-splash-bar" />
      </div>
    </template>

    <!-- Whole app frame -->
    <template v-else-if="shape === 'shell'">
      <div class="sk-shell" aria-hidden="true">
        <aside class="sk-side">
          <span class="sk sk-on-dark sk-logo" />
          <span v-for="index in 7" :key="index" class="sk sk-on-dark sk-nav" :style="{ width: width(index) }" />
        </aside>
        <div class="sk-main">
          <div class="sk-top"><span class="sk sk-h" /><span class="sk sk-pill" /></div>
          <div class="sk-body">
            <div class="sk-stats"><span v-for="index in 3" :key="index" class="sk sk-stat" /></div>
            <span class="sk sk-block" />
          </div>
        </div>
      </div>
    </template>

    <!-- Page: header, stat cards, table card -->
    <template v-else-if="shape === 'page'">
      <div class="page sk-page" aria-hidden="true">
        <div class="sk-head"><span class="sk sk-title" /><span class="sk sk-sub" /></div>
        <div class="sk-stats"><span v-for="index in 3" :key="index" class="sk sk-stat" /></div>
        <div class="card sk-card">
          <div v-for="index in rows" :key="index" class="sk-row">
            <span class="sk sk-dot" /><span class="sk sk-line" :style="{ width: width(index) }" /><span class="sk sk-chip" />
          </div>
        </div>
      </div>
    </template>

    <!-- Avatar rows -->
    <template v-else-if="shape === 'list'">
      <div class="sk-list" aria-hidden="true">
        <div v-for="index in rows" :key="index" class="sk-person">
          <span class="sk sk-avatar" />
          <span class="sk-lines"><span class="sk sk-line" :style="{ width: width(index + 2) }" /><span class="sk sk-line thin" :style="{ width: width(index + 5) }" /></span>
        </div>
      </div>
    </template>

    <!-- Chat bubbles -->
    <template v-else-if="shape === 'chat'">
      <div class="sk-chat" aria-hidden="true">
        <span v-for="index in rows" :key="index" class="sk sk-bubble" :class="{ mine: index % 2 === 0 }" :style="{ width: `${36 + ((index * 17) % 34)}%` }" />
      </div>
    </template>

    <!-- Text lines -->
    <template v-else-if="shape === 'text'">
      <div class="sk-text" aria-hidden="true">
        <span v-for="index in rows" :key="index" class="sk sk-line" :style="{ width: index === rows ? '55%' : width(index) }" />
      </div>
    </template>

    <!-- Table rows (default) -->
    <template v-else>
      <div class="sk-table" aria-hidden="true">
        <div class="sk-row head"><span class="sk sk-line thin" style="width: 18%" /><span class="sk sk-line thin" style="width: 24%" /><span class="sk sk-line thin" style="width: 14%" /></div>
        <div v-for="index in rows" :key="index" class="sk-row">
          <span class="sk sk-dot" />
          <span class="sk-lines"><span class="sk sk-line" :style="{ width: width(index) }" /><span class="sk sk-line thin" :style="{ width: width(index + 3) }" /></span>
          <span class="sk sk-chip" />
        </div>
      </div>
    </template>
    <span class="sr-only">Loading…</span>
  </div>
</template>

<style scoped>
.sk-wrap { width: 100%; }
.sk-wrap.full { height: 100%; }

/* The shimmer itself */
.sk {
  display: block; border-radius: 8px;
  background: linear-gradient(90deg, var(--surface-soft) 25%, var(--surface-hover) 37%, var(--surface-soft) 63%);
  background-size: 400% 100%; animation: sk-shimmer 1.4s ease-in-out infinite;
}
.sk-on-dark { background: linear-gradient(90deg, rgba(255, 255, 255, 0.08) 25%, rgba(255, 255, 255, 0.18) 37%, rgba(255, 255, 255, 0.08) 63%); background-size: 400% 100%; }
@keyframes sk-shimmer { from { background-position: 100% 50%; } to { background-position: 0 50%; } }

/* Shared pieces */
.sk-line { height: 12px; }
.sk-line.thin { height: 9px; opacity: 0.8; }
.sk-lines { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 7px; }
.sk-dot { width: 34px; height: 34px; border-radius: 10px; flex: none; }
.sk-chip { width: 64px; height: 22px; border-radius: 999px; flex: none; }
.sk-avatar { width: 40px; height: 40px; border-radius: 50%; flex: none; }

/* table */
.sk-table { padding: 6px 0; }
.sk-row { display: flex; align-items: center; gap: 14px; padding: 13px 18px; border-bottom: 1px solid var(--line); }
.sk-row:last-child { border-bottom: 0; }
.sk-row.head { gap: 28px; padding-block: 11px; }

/* page */
.sk-head { display: flex; flex-direction: column; gap: 8px; }
.sk-title { width: 220px; max-width: 60%; height: 22px; }
.sk-sub { width: 340px; max-width: 80%; height: 12px; }
.sk-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 16px; }
.sk-stat { height: 96px; border-radius: var(--radius-lg); }
.sk-card { overflow: hidden; }

/* list */
.sk-list { padding: 6px 0; }
.sk-person { display: flex; align-items: center; gap: 12px; padding: 11px 16px; }

/* chat */
.sk-chat { display: flex; flex-direction: column; gap: 12px; padding: 18px; }
.sk-bubble { height: 38px; border-radius: 16px 16px 16px 4px; }
.sk-bubble.mine { align-self: flex-end; border-radius: 16px 16px 4px 16px; }

/* text */
.sk-text { display: flex; flex-direction: column; gap: 10px; padding: 8px 0; }

/* splash */
.sk-splash { height: 100%; min-height: 240px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; background: var(--bg); }
.sk-splash-mark {
  width: 64px; height: 64px; border-radius: 18px; display: grid; place-items: center;
  background: linear-gradient(150deg, #002060, #00133d); box-shadow: 0 18px 40px -16px rgba(0, 32, 96, 0.6); animation: sk-pulse 1.6s ease-in-out infinite;
}
.sk-splash-mark img { width: 36px; height: 32px; object-fit: contain; filter: brightness(0) invert(1); }
.sk-splash-bar { width: 120px; height: 6px; border-radius: 6px; }
@keyframes sk-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }

/* shell */
.sk-shell { height: 100%; display: flex; padding: 16px; background: var(--bg); overflow: hidden; }
.sk-side {
  width: 236px; flex: none; display: flex; flex-direction: column; gap: 12px; padding: 22px 16px; border-radius: 24px 0 0 24px;
  background: linear-gradient(170deg, #002060 0%, #00133d 70%, #000b26 100%);
}
.sk-logo { width: 130px; height: 40px; border-radius: 12px; margin-bottom: 14px; }
.sk-nav { height: 34px; border-radius: 12px; }
.sk-main { flex: 1; min-width: 0; overflow: hidden; display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--line); border-left: 0; border-radius: 0 24px 24px 0; }
.sk-top { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px 28px; border-bottom: 1px solid var(--line); }
.sk-h { width: 200px; height: 20px; }
.sk-pill { width: 240px; height: 38px; border-radius: 12px; }
.sk-body { display: flex; flex-direction: column; gap: 18px; padding: 28px; }
.sk-block { height: 280px; border-radius: var(--radius-lg); }

@media (max-width: 767.98px) {
  .sk-shell { flex-direction: column; padding: 0; }
  .sk-side { width: auto; height: calc(64px + env(safe-area-inset-top)); flex-direction: row; align-items: center; padding: 14px 18px; padding-top: calc(14px + env(safe-area-inset-top)); border-radius: 0 0 22px 22px; }
  .sk-side .sk-nav { display: none; }
  .sk-logo { width: 140px; height: 32px; margin: 0; }
  .sk-main { border: 0; border-radius: 0; background: var(--bg); }
  .sk-top { display: none; }
  .sk-body { padding: 16px; }
  .sk-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .sk-row { padding-inline: 14px; }
}
@media (prefers-reduced-motion: reduce) { .sk, .sk-splash-mark { animation: none !important; } }
</style>
