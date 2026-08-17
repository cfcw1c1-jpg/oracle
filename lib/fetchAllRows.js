import { supabase } from './supabase';

const PAGE_SIZE = 1000;

// Supabase/PostgREST caps a single response at a max-rows limit (1000 by
// default) -- a plain .select() alone silently truncates past that instead
// of erroring, so any table that can plausibly grow past ~1000 rows
// (members, pfo_members, ...) needs to be paged through instead of fetched
// in one shot, or rows sorted past the cutoff just never reach the app.
//
// orderBy accepts the same shape .order() does: a column name, or an array
// of them for a stable multi-column sort (recommended whenever the primary
// sort column isn't unique -- ties aren't guaranteed to land on the same
// side of a page boundary across separate paginated requests otherwise).
export async function fetchAllRows(table, selectExpr, { orderBy } = {}) {
  const columns = Array.isArray(orderBy) ? orderBy : (orderBy ? [orderBy] : []);

  let all = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase.from(table).select(selectExpr);
    columns.forEach((column) => {
      query = query.order(column, { ascending: true });
    });
    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    all = all.concat(data || []);
    hasMore = (data || []).length === PAGE_SIZE;
    from += PAGE_SIZE;
  }

  return all;
}
