-- Sets up Supabase Storage for the "My Profile" avatar-upload feature
-- (src/screens/ProfileScreen.js).
--
-- Creating a bucket alone is NOT enough: Storage has its own row-level
-- security on storage.objects, so without the policies below, every
-- upload attempt fails with a permission error even in a "public" bucket
-- (public only affects whether uploaded files can be READ via a public
-- URL, not whether a user is allowed to upload one in the first place).
--
-- How to run:
--   Supabase Dashboard -> your project -> SQL Editor -> New query
--   -> paste this file's contents -> Run.
--
-- Safe to re-run: the bucket insert no-ops on conflict, and each policy is
-- dropped before being recreated (CREATE POLICY has no IF NOT EXISTS form
-- in Postgres, unlike CREATE TABLE/INDEX).

-- 1. Create the bucket (public, so getPublicUrl() links actually work).
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- 2. Let a signed-in user upload into their OWN folder only.
-- ProfileScreen.js uploads to "<user.id>/avatar-<timestamp>.<ext>", so the
-- first path segment must match the uploader's own auth.uid().
drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- 3. Let a signed-in user replace/overwrite their own avatar (upsert: true).
drop policy if exists "Users can update their own avatar" on storage.objects;
create policy "Users can update their own avatar"
on storage.objects for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- 4. Anyone can view avatars (the public URLs shown in the app).
drop policy if exists "Public read access to avatars" on storage.objects;
create policy "Public read access to avatars"
on storage.objects for select
to public
using (bucket_id = 'avatars');

-- Verify afterwards:
-- select id, name, public from storage.buckets where id = 'avatars';
-- select policyname from pg_policies where tablename = 'objects' and policyname like '%avatar%';
