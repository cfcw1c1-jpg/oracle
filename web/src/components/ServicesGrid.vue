<script setup>
// Phone-only grid of every page the person can open, beyond the three bottom tabs.
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { servicesFor } from '@/lib/navigation';
import { canView, sessionState } from '@/stores/session';

const router = useRouter();
const services = computed(() => servicesFor(sessionState.access?.roleName, canView));
const badges = computed(() => ({ memberChangeQueue: sessionState.pendingChangeRequests }));
</script>

<template>
  <section v-if="services.length" class="services" aria-labelledby="services-title">
    <h2 id="services-title" class="card-title">Services</h2>
    <div class="services-grid">
      <button v-for="item in services" :key="item.key" class="service" @click="router.push(`/${item.key}`)">
        <span class="service-icon">
          <component :is="item.icon" :size="22" />
          <span v-if="badges[item.key]" class="badge">{{ badges[item.key] > 9 ? '9+' : badges[item.key] }}</span>
        </span>
        <span class="service-label">{{ item.label }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.services { display: none; }
@media (max-width: 767.98px) {
  .services { display: flex; flex-direction: column; gap: 12px; }
  .services-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
  .service {
    display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 8px;
    min-height: 104px; padding: 14px 6px 12px; border: 1px solid var(--line); border-radius: 18px;
    background: var(--surface); color: var(--ink); box-shadow: 0 6px 16px -14px rgba(0, 32, 96, 0.5);
    transition: transform 0.15s, box-shadow 0.2s, background 0.2s;
  }
  .service:active { transform: scale(0.96); background: var(--surface-hover); }
  .service-icon {
    position: relative; width: 46px; height: 46px; border-radius: 14px; flex: none; display: grid; place-items: center;
    background: linear-gradient(140deg, #002060, #1d3f9e); color: #fff; box-shadow: 0 8px 16px -10px rgba(0, 32, 96, 0.8);
  }
  .service-icon .badge { position: absolute; top: -5px; right: -6px; border: 2px solid var(--surface); }
  .service-label {
    font-size: 12px; font-weight: var(--fw-medium); line-height: 1.25; text-align: center; color: var(--ink-2);
    display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; overflow-wrap: anywhere;
  }
}
@media (prefers-reduced-motion: reduce) { .service { transition: none; } }
</style>
