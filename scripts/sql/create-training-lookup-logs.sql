-- Search-audit log for the public Training Records Lookup page
-- (src/app/training-lookup.js, served at /training-lookup — no login required).
--
-- Records two kinds of events, distinguished by event_type:
--   'search'      -- a name was typed and searchMembers() ran (query + results_count set)
--   'view_member' -- a search result was tapped and a member's history was opened
--                    (member_id_no + member_name set)
--
-- Like the rest of this app's tables (members, pfo_members, clp_trainings, ...),
-- RLS is left off here so the existing anon/publishable key can insert freely
-- from the public page. That also means this log is as readable via that same
-- key as everything else already is — if you want the log itself kept private,
-- enable RLS and add an insert-only policy for anon plus a select policy
-- restricted to authenticated users.
--
-- How to run:
--   Supabase Dashboard -> your project -> SQL Editor -> New query
--   -> paste this file's contents -> Run.
--
-- Safe to re-run: IF NOT EXISTS / CREATE INDEX IF NOT EXISTS skip anything
-- already there.

CREATE TABLE IF NOT EXISTS public.training_lookup_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('search', 'view_member')),
  query TEXT,
  results_count INTEGER,
  member_id_no TEXT,
  member_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS training_lookup_logs_created_at_idx
  ON public.training_lookup_logs (created_at DESC);

-- Verify afterwards:
-- SELECT event_type, query, member_name, results_count, created_at
-- FROM public.training_lookup_logs
-- ORDER BY created_at DESC
-- LIMIT 50;
