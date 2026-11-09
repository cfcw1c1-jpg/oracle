-- =========================================================================
-- OGD chapter connections: one row per Chapter holding the Gmail account a
-- sector user assigned to it, the OGD (cfcglobaldata.com) login MSG set up
-- for it, and the result of the last automated login.
--
-- Passwords are stored only as AES-256-GCM ciphertext. They are encrypted
-- and decrypted by the Vercel functions under /api/ogd using the
-- OGD_CREDENTIALS_KEY environment variable, which the database never sees.
--
-- RLS is enabled with NO policies, and client roles have no grants: the app
-- can never read this table directly. Only the service-role key used by
-- /api/ogd can, and those functions return non-secret columns only.
--
-- This table is deliberately left out of the system audit log triggers, so
-- ciphertext is not copied into audit_log.
--
-- Run once, after add-admin-roles-and-areas.sql and add-user-area-scoping.sql.
-- Safe to re-run.
-- =========================================================================

CREATE TABLE IF NOT EXISTS "public"."ogd_chapter_connections" (
    "area_id" bigint PRIMARY KEY REFERENCES "public"."areas"("id") ON DELETE CASCADE,

    "gmail_address" "text",
    "gmail_password_enc" "text",
    "gmail_updated_at" timestamp with time zone,
    "gmail_updated_by" "uuid" REFERENCES "public"."profiles"("id") ON DELETE SET NULL,

    "ogd_username" "text",
    "ogd_password_enc" "text",
    "ogd_updated_at" timestamp with time zone,
    "ogd_updated_by" "uuid" REFERENCES "public"."profiles"("id") ON DELETE SET NULL,

    "status" "text" DEFAULT 'idle' NOT NULL,
    "failure_code" "text",
    "status_detail" "text",
    "last_attempt_at" timestamp with time zone,
    "last_attempt_by" "uuid" REFERENCES "public"."profiles"("id") ON DELETE SET NULL,
    "last_success_at" timestamp with time zone,

    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,

    CONSTRAINT "ogd_chapter_connections_status_check"
      CHECK ("status" = ANY (ARRAY['idle'::"text", 'running'::"text", 'connected'::"text", 'failed'::"text"]))
);

ALTER TABLE "public"."ogd_chapter_connections" OWNER TO "postgres";
ALTER TABLE "public"."ogd_chapter_connections" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."ogd_chapter_connections" FROM "anon", "authenticated";
GRANT ALL ON TABLE "public"."ogd_chapter_connections" TO "service_role";


-- ---------- Page registration + default grants ----------
-- "OGD Accounts" is where MSG sets each chapter's OGD login. "Sector"
-- is where sector users set each chapter's Gmail and see its status.
INSERT INTO "public"."pages" ("key", "label", "sort_order") VALUES
    ('ogdAccounts', 'OGD Accounts', 20),
    ('ogdChapters', 'Sector', 21)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "public"."role_pages" ("role_id", "page_key")
SELECT "id", 'ogdAccounts' FROM "public"."roles" WHERE "name" IN ('Admin', 'MSG')
ON CONFLICT DO NOTHING;

-- Matched by role name. If your sector role is named differently (check:
-- SELECT name FROM public.roles;), grant 'Sector' to it on the
-- Roles & Page Access screen instead.
INSERT INTO "public"."role_pages" ("role_id", "page_key")
SELECT "id", 'ogdChapters' FROM "public"."roles" WHERE "name" = 'Admin' OR "name" ILIKE 'sector%'
ON CONFLICT DO NOTHING;

-- Verify afterwards:
-- SELECT r.name, rp.page_key FROM public.role_pages rp JOIN public.roles r ON r.id = rp.role_id WHERE rp.page_key LIKE 'ogd%';
