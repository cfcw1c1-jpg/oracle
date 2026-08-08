-- Adds a per-batch public link token to clp_trainings, so each CLP
-- training batch can be shared as its own unique public registration link
-- (src/app/clp-registration.js, served at /clp-registration?token=<uuid>).
--
-- The token is generated per-batch (admin copies it from the "Copy Public
-- Link" action in ClpMaintenance) instead of using clp_trainings.id
-- directly, because the numeric id is sequential/guessable — anyone could
-- enumerate every batch by walking ?token=1, 2, 3... A random UUID cannot
-- be guessed, so a link only ever grants access to the one batch it was
-- generated for.
--
-- IMPORTANT caveat: the existing "Public read for training lookup" policy
-- (enable-public-training-lookup-read-access.sql) already grants the anon
-- role full SELECT on clp_trainings (needed by /training-lookup, which
-- reads a member's whole CLP history via a join). That means the token is
-- a convenience/direct-link mechanism, not a hard confidentiality
-- boundary — anyone holding the anon key can already query
-- clp_trainings directly and read every row/token, bypassing the link
-- entirely. Locking that down would require replacing the public
-- training-lookup feature's data access with a token-scoped RPC too,
-- which is a bigger change; flagging it here rather than silently
-- promising more security than this migration actually provides.
--
-- How to run:
--   Supabase Dashboard -> your project -> SQL Editor -> New query
--   -> paste this file's contents -> Run.
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS / CREATE UNIQUE INDEX IF NOT
-- EXISTS skip anything already there; the UPDATE only touches rows still
-- missing a token.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.clp_trainings
  ADD COLUMN IF NOT EXISTS public_token uuid DEFAULT gen_random_uuid();

UPDATE public.clp_trainings
SET public_token = gen_random_uuid()
WHERE public_token IS NULL;

ALTER TABLE public.clp_trainings
  ALTER COLUMN public_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS clp_trainings_public_token_idx
  ON public.clp_trainings (public_token);

-- Verify afterwards:
-- SELECT id, venue, public_token FROM public.clp_trainings ORDER BY start_date DESC;
