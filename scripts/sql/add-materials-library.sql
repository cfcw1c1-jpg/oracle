-- =========================================================================
-- Materials library: Admin-managed folders of downloadable files (PDF,
-- PowerPoint, Word, video, audio, ...) that other roles -- Chapter Head and
-- MSG by default -- can browse, open, and download from the "Materials"
-- page (src/screens/Materials.js).
--
--   material_folders  one row per folder (name + description)
--   materials         one row per uploaded file, under exactly one folder
--   storage bucket "materials" (PRIVATE) holds the files themselves at
--                     "<folder_id>/<timestamp>-<file name>"
--
-- Who can do what:
--   - View/download: any role granted the 'materials' page on the Roles &
--     Page Access screen (checked by has_page_access() below, so revoking
--     the page there also revokes the data and the files, not just the
--     sidebar link).
--   - Create/edit/delete folders, upload/delete files: Admin only
--     (is_admin()).
--
-- The bucket is private on purpose -- the app hands out short-lived signed
-- URLs instead of permanent public links, so a copied link stops working
-- and a revoked role can't keep downloading.
--
-- How to run: Supabase Dashboard -> SQL Editor -> paste -> Run.
-- Run after add-admin-roles-and-areas.sql. Safe to re-run.
-- =========================================================================


-- ---------- has_page_access(page_key) helper ----------
-- SECURITY DEFINER so it can read profiles/role_pages regardless of the
-- caller's own RLS on those tables, same as is_admin().
CREATE OR REPLACE FUNCTION "public"."has_page_access"("p_page_key" "text")
RETURNS boolean
LANGUAGE "sql"
SECURITY DEFINER
SET "search_path" = 'public'
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.role_pages rp ON rp.role_id = p.role_id
    WHERE p.id = auth.uid() AND rp.page_key = p_page_key
  );
$$;

GRANT EXECUTE ON FUNCTION "public"."has_page_access"("text") TO "authenticated";


-- ---------- Tables ----------
CREATE TABLE IF NOT EXISTS "public"."material_folders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "material_folders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "material_folders_name_not_blank" CHECK (length(trim("name")) > 0),
    CONSTRAINT "material_folders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "public"."materials" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "folder_id" "uuid" NOT NULL,
    "file_name" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "mime_type" "text",
    "size_bytes" bigint,
    "uploaded_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "materials_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "materials_storage_path_key" UNIQUE ("storage_path"),
    CONSTRAINT "materials_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "public"."material_folders"("id") ON DELETE CASCADE,
    CONSTRAINT "materials_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "materials_folder_id_idx" ON "public"."materials" ("folder_id", "created_at");


-- ---------- RLS ----------
ALTER TABLE "public"."material_folders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."materials" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Material viewers can read folders" ON "public"."material_folders";
CREATE POLICY "Material viewers can read folders" ON "public"."material_folders"
  FOR SELECT TO "authenticated"
  USING (public.is_admin() OR public.has_page_access('materials'));

DROP POLICY IF EXISTS "Admins can manage folders" ON "public"."material_folders";
CREATE POLICY "Admins can manage folders" ON "public"."material_folders"
  FOR ALL TO "authenticated"
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Material viewers can read materials" ON "public"."materials";
CREATE POLICY "Material viewers can read materials" ON "public"."materials"
  FOR SELECT TO "authenticated"
  USING (public.is_admin() OR public.has_page_access('materials'));

DROP POLICY IF EXISTS "Admins can manage materials" ON "public"."materials";
CREATE POLICY "Admins can manage materials" ON "public"."materials"
  FOR ALL TO "authenticated"
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ---------- Storage bucket ----------
-- No file_size_limit here, so the project-wide upload limit applies
-- (Dashboard -> Storage -> Settings). Raise that if videos get rejected.
INSERT INTO storage.buckets (id, name, public)
VALUES ('materials', 'materials', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Material viewers can read material files" ON storage.objects;
CREATE POLICY "Material viewers can read material files" ON storage.objects
  FOR SELECT TO "authenticated"
  USING (bucket_id = 'materials' AND (public.is_admin() OR public.has_page_access('materials')));

DROP POLICY IF EXISTS "Admins can upload material files" ON storage.objects;
CREATE POLICY "Admins can upload material files" ON storage.objects
  FOR INSERT TO "authenticated"
  WITH CHECK (bucket_id = 'materials' AND public.is_admin());

DROP POLICY IF EXISTS "Admins can update material files" ON storage.objects;
CREATE POLICY "Admins can update material files" ON storage.objects
  FOR UPDATE TO "authenticated"
  USING (bucket_id = 'materials' AND public.is_admin());

DROP POLICY IF EXISTS "Admins can delete material files" ON storage.objects;
CREATE POLICY "Admins can delete material files" ON storage.objects
  FOR DELETE TO "authenticated"
  USING (bucket_id = 'materials' AND public.is_admin());


-- ---------- Page registration + default grants ----------
INSERT INTO "public"."pages" ("key", "label", "sort_order") VALUES
    ('materials', 'Materials', 9)
ON CONFLICT ("key") DO NOTHING;

-- Matched by role name -- if either role is named differently in your
-- project (check: SELECT name FROM public.roles;), grant 'Materials' to it
-- by hand on the Roles & Page Access screen instead.
INSERT INTO "public"."role_pages" ("role_id", "page_key")
SELECT "id", 'materials' FROM "public"."roles" WHERE "name" IN ('Admin', 'Chapter Head', 'MSG')
ON CONFLICT DO NOTHING;

-- Verify afterwards:
-- SELECT r.name FROM public.role_pages rp JOIN public.roles r ON r.id = rp.role_id WHERE rp.page_key = 'materials';
-- SELECT id, public FROM storage.buckets WHERE id = 'materials';
