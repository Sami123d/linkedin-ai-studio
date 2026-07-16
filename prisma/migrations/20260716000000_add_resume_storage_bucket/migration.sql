-- ─────────────────────────────────────────────────────────────────────────
-- Milestone 4 (Knowledge Base CRUD): Supabase Storage bucket for uploaded
-- resume files.
--
-- Why this is raw SQL, not Prisma schema: `storage.buckets` /
-- `storage.objects` live in Supabase's own "storage" schema, which Prisma
-- doesn't manage (same reason the Milestone 2 auth trigger is raw SQL).
-- This can't go through `prisma migrate dev` (shadow DB has no `storage`
-- schema either) — apply with `prisma migrate deploy` only, per this
-- project's established convention for auth/storage-schema migrations.
--
-- IMPORTANT — this is a *different* authorization path than every other
-- table in this app: Prisma queries run through a privileged Postgres role
-- that bypasses RLS entirely (see the Milestone 2 migration's RLS comment),
-- so those policies are defense-in-depth only. Storage uploads/downloads in
-- this milestone go through the Supabase SSR client authenticated as the
-- signed-in user (src/lib/supabase/server.ts), which talks to the Storage
-- API as that user's role/JWT — so the policies below are the ACTUAL and
-- ONLY access control for this bucket. Get them wrong and either every
-- user's resume is world-readable, or no user can upload their own.
-- ─────────────────────────────────────────────────────────────────────────

-- Private bucket: not publicly readable by URL. Files are served back to
-- the owning user via a signed URL generated server-side, never a public
-- URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'resumes',
  'resumes',
  false,
  10485760, -- 10 MB
  array['application/pdf', 'text/plain', 'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do nothing;

-- Object path convention this app enforces at the application layer:
-- `${profileId}/${fileName}`. `storage.foldername(name)` splits the object
-- path on `/` and returns it as a text[]; index [1] is the first segment,
-- i.e. the profile id the uploader claims. Comparing it against auth.uid()
-- is what actually restricts each user to their own folder — without it,
-- any authenticated user could read/overwrite any other user's resume by
-- guessing/enumerating their profile id.
create policy "Users can read own resume files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can upload own resume files"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can update own resume files"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete own resume files"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
