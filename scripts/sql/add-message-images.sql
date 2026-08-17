-- =========================================================================
-- Lets a message (public.messages, see add-messaging.sql) carry an image
-- instead of / alongside text, and sets up the Storage bucket it's
-- uploaded to. Used by src/screens/Messages.js's compose bar, and by
-- "Message a Moderator" (add-moderator-group-messaging.sql) so a member's
-- photos are visible to the whole Moderator team, not just one account.
--
-- Run once, after add-messaging.sql, and BEFORE
-- add-moderator-group-messaging.sql (its get_my_conversations rewrite
-- selects messages.image_url).
--
-- How to run:
--   Supabase Dashboard -> your project -> SQL Editor -> New query
--   -> paste this file's contents -> Run.
--
-- Safe to re-run.
-- =========================================================================

ALTER TABLE "public"."messages" ADD COLUMN IF NOT EXISTS "image_url" "text";

-- A message now only needs EITHER text or an image, not both.
ALTER TABLE "public"."messages" DROP CONSTRAINT IF EXISTS "messages_body_not_blank";
ALTER TABLE "public"."messages" ADD CONSTRAINT "messages_body_or_image"
  CHECK (length(btrim("body")) > 0 OR "image_url" IS NOT NULL);

-- 1. Create the bucket (public, so getPublicUrl() links actually work --
--    same convention as the "avatars" bucket in setup-avatars-storage.sql).
insert into storage.buckets (id, name, public)
values ('message-images', 'message-images', true)
on conflict (id) do nothing;

-- 2. Let a signed-in user upload into their OWN folder only.
-- Messages.js uploads to "<sender.id>/<timestamp>.<ext>".
drop policy if exists "Users can upload their own message images" on storage.objects;
create policy "Users can upload their own message images"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'message-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- 3. Anyone can view message images (the public URLs shown in the app --
--    who actually gets shown that URL is still gated by the messages
--    table's own RLS, same tradeoff already made for avatars).
drop policy if exists "Public read access to message images" on storage.objects;
create policy "Public read access to message images"
on storage.objects for select
to public
using (bucket_id = 'message-images');

-- Verify afterwards:
-- select id, name, public from storage.buckets where id = 'message-images';
-- select policyname from pg_policies where tablename = 'objects' and policyname like '%message image%';
