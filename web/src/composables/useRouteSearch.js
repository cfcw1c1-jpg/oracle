import { watch } from 'vue';
import { useRoute } from 'vue-router';

// Fills a page's search box from ?q=, so the header search can open a page
// already narrowed to one member.
export function useRouteSearch(search) {
  const route = useRoute();
  watch(
    () => route.query.q,
    (q) => {
      if (typeof q === 'string' && q) search.value = q;
    },
    { immediate: true },
  );
}
