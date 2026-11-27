-- Public, time-limited share links (and their QR codes) for Materials.
-- An Admin shares a folder (with everything inside it) or one file until
-- expires_at. Anyone with the link can view and download those files through
-- /api/material-share until then; after that, or once revoked, the link stops
-- working and a new link (a new QR code) has to be made.
--
-- Only Admins can see or manage share rows. Visitors never read this table:
-- the API looks the token up with the service role.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.material_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  folder_id uuid REFERENCES public.material_folders(id) ON DELETE CASCADE,
  material_id uuid REFERENCES public.materials(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  view_count integer NOT NULL DEFAULT 0,
  created_by uuid DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT material_shares_one_target CHECK ((folder_id IS NULL) <> (material_id IS NULL)),
  CONSTRAINT material_shares_token_length CHECK (length(token) >= 24),
  CONSTRAINT material_shares_expires_after_created CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS material_shares_folder_id_idx ON public.material_shares (folder_id);
CREATE INDEX IF NOT EXISTS material_shares_material_id_idx ON public.material_shares (material_id);

ALTER TABLE public.material_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage material shares" ON public.material_shares;
CREATE POLICY "Admins can manage material shares" ON public.material_shares
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Counts a visit without letting visitors write to the table.
CREATE OR REPLACE FUNCTION public.count_material_share_view(p_token text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.material_shares SET view_count = view_count + 1 WHERE token = p_token;
$$;
REVOKE ALL ON FUNCTION public.count_material_share_view(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_material_share_view(text) TO service_role;

NOTIFY pgrst, 'reload schema';
