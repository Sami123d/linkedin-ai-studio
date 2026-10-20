-- Follow-up to 20261018010000_add_meta_publishing (kept as its own migration so
-- it works whether or not that one was already applied).
--
-- Deleting a storage object needs the row to be visible to the caller: a
-- DELETE ... WHERE reads the row, so without a SELECT policy the existing
-- "delete own publish media" policy matches nothing and the app's cleanup of
-- prepared images silently does nothing. This lets a signed-in user see only
-- the objects in their own profile folder. It does NOT change who can read
-- the images: the bucket is public, so anyone with an object's (random) URL
-- can already fetch it, which Meta needs.
create policy "Users can read own publish media"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'publish-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
