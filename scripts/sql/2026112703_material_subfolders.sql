-- Materials: folders inside folders. parent_id points to the folder a folder
-- sits in (NULL = top level). Deleting a folder deletes the folders inside it
-- (and, through materials.folder_id, their file rows); the web page removes
-- the stored files first.
--
-- Existing policies on material_folders cover the new column (Admin writes,
-- page access reads). Safe to re-run.

ALTER TABLE public.material_folders
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.material_folders(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'material_folders_not_own_parent') THEN
    ALTER TABLE public.material_folders
      ADD CONSTRAINT material_folders_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS material_folders_parent_id_idx ON public.material_folders (parent_id);

NOTIFY pgrst, 'reload schema';
