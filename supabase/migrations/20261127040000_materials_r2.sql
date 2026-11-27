-- Materials files can live in Cloudflare R2 as well as Supabase Storage.
-- storage_provider says where storage_path points: 'supabase' (the private
-- "materials" bucket, as before) or 'r2' (the R2 bucket, reached through
-- /api/materials signed links). Existing rows stay 'supabase'.
--
-- Safe to re-run.

ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS storage_provider text NOT NULL DEFAULT 'supabase';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'materials_storage_provider_check') THEN
    ALTER TABLE public.materials
      ADD CONSTRAINT materials_storage_provider_check CHECK (storage_provider IN ('supabase', 'r2'));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
