-- Enables Postgres logical-replication broadcast for training_lookup_logs
-- so the Audit Logs page (src/screens/AuditLogs.js, the "Audit Logs" tab
-- in the sidebar) can subscribe via
-- supabase.channel(...).on('postgres_changes', ...) and see new rows the
-- instant they're inserted, instead of only on manual refresh.
--
-- Equivalent to ticking "Enable Realtime" on the training_lookup_logs
-- table in Table Editor -> Update table (unchecked by default when a
-- table is first created) — this does the same thing via SQL.
--
-- How to run:
--   Supabase Dashboard -> your project -> SQL Editor -> New query
--   -> paste this file's contents -> Run.
--
-- Safe to re-run: the existence check prevents the
-- "already member of publication" error you'd get from a bare
-- ALTER PUBLICATION ... ADD TABLE on a second run.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'training_lookup_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.training_lookup_logs;
  END IF;
END $$;

-- Verify afterwards:
-- SELECT schemaname, tablename FROM pg_publication_tables
-- WHERE pubname = 'supabase_realtime' AND tablename = 'training_lookup_logs';
