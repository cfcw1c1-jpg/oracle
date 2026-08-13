-- =========================================================================
-- One-off resync of profiles.avatar_url from auth.users.raw_user_meta_data
-- -- unlike add-profiles-avatar-url.sql's one-time backfill (which only
-- fills rows where avatar_url is still NULL), this overwrites profiles
-- with whatever avatar_url currently sits in each account's metadata, so
-- it also picks up URLs added or changed there after that first backfill
-- ran (e.g. pasted directly into a user's metadata in the Auth dashboard).
--
-- Run in the Supabase SQL Editor whenever a user's metadata avatar_url
-- changes and Portal Users / Messages should pick it up. Safe to re-run.
-- =========================================================================

UPDATE "public"."profiles" p
SET "avatar_url" = u."raw_user_meta_data" ->> 'avatar_url'
FROM "auth"."users" u
WHERE u."id" = p."id"
  AND u."raw_user_meta_data" ->> 'avatar_url' IS NOT NULL;
