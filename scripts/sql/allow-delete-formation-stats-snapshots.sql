-- =========================================================================
-- Adds the missing DELETE policy on formation_stats_snapshots. Without it,
-- RLS silently allows zero rows to be deleted -- a client-side delete()
-- call reports success but nothing actually gets removed, and the row
-- reappears on the next reload.
--
-- Run once, after add-formation-stats-snapshots.sql. Safe to re-run.
-- =========================================================================

-- Same broad "any signed-in account" trust level as the existing SELECT/
-- INSERT policies on this table -- page-level access (the 'pfoStats' page
-- grant) is what actually gates who reaches this screen at all.
DROP POLICY IF EXISTS "Authenticated can delete formation stats snapshots" ON "public"."formation_stats_snapshots";
CREATE POLICY "Authenticated can delete formation stats snapshots" ON "public"."formation_stats_snapshots"
FOR DELETE TO "authenticated"
USING (true);
