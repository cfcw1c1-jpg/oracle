import { onBeforeUnmount, ref } from 'vue';

// Matches the 768px line where the phone layout begins.
export function useIsWide() {
  const query = window.matchMedia('(min-width: 768px)');
  const isWide = ref(query.matches);
  const update = (event) => {
    isWide.value = event.matches;
  };
  query.addEventListener('change', update);
  onBeforeUnmount(() => query.removeEventListener('change', update));
  return isWide;
}
