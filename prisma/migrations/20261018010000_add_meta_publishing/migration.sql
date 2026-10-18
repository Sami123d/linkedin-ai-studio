-- Phase 2 (Meta publishing): hand-written like every migration since
-- Milestone 2 — `prisma migrate dev` can't validate against the shadow DB
-- (no `auth`/`storage` schema there). Apply with `prisma migrate deploy`.
-- Requires 20261018000000_add_platform_variants to be applied first.

-- AlterEnum (the new values are not used inside this migration)
ALTER TYPE "VariantPublishStatus" ADD VALUE 'PUBLISHING';
ALTER TYPE "VariantPublishStatus" ADD VALUE 'UNCONFIRMED';

-- CreateEnum
CREATE TYPE "MetaConnectionStatus" AS ENUM ('CONNECTED', 'NEEDS_REAUTH');

-- CreateEnum
CREATE TYPE "PublishOutcome" AS ENUM ('PUBLISHED', 'FAILED', 'UNCONFIRMED', 'PENDING');

-- CreateTable
CREATE TABLE "meta_connections" (
    "id" TEXT NOT NULL,
    "profile_id" UUID NOT NULL,
    "status" "MetaConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "meta_user_id" TEXT NOT NULL,
    "meta_user_name" TEXT,
    "user_token_enc" TEXT NOT NULL,
    "user_token_expires_at" TIMESTAMPTZ(6),
    "granted_scopes" TEXT[],
    "declined_scopes" TEXT[],
    "page_id" TEXT,
    "page_name" TEXT,
    "page_token_enc" TEXT,
    "instagram_account_id" TEXT,
    "instagram_username" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "meta_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variant_publish_attempts" (
    "id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "step" TEXT NOT NULL,
    "outcome" "PublishOutcome" NOT NULL,
    "target_account_id" TEXT,
    "platform_post_id" TEXT,
    "error_category" TEXT,
    "error_code" INTEGER,
    "error_subcode" INTEGER,
    "http_status" INTEGER,
    "message" TEXT,
    "trace_id" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "variant_publish_attempts_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "platform_variants"
    ADD COLUMN "include_image" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "link_url" TEXT,
    ADD COLUMN "media_url" TEXT,
    ADD COLUMN "media_source_url" TEXT,
    ADD COLUMN "connection_id" TEXT,
    ADD COLUMN "target_account_id" TEXT,
    ADD COLUMN "published_post_id" TEXT,
    ADD COLUMN "publish_attempts" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "publishing_started_at" TIMESTAMPTZ(6),
    ADD COLUMN "ig_container_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "meta_connections_profile_id_key" ON "meta_connections"("profile_id");

-- CreateIndex
CREATE INDEX "variant_publish_attempts_variant_id_idx" ON "variant_publish_attempts"("variant_id");

-- AddForeignKey
ALTER TABLE "platform_variants" ADD CONSTRAINT "platform_variants_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "meta_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_publish_attempts" ADD CONSTRAINT "variant_publish_attempts_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "platform_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: same defense-in-depth-only posture as every other table (Prisma's
-- connection bypasses it regardless — see the Milestone 2 migration).
-- meta_connections holds encrypted tokens, so with RLS on and no policies it
-- is also unreadable through the Supabase Data API.
ALTER TABLE "meta_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "variant_publish_attempts" ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────
-- Public bucket for the JPEGs Meta downloads when publishing. Meta's servers
-- must be able to fetch the image by URL, so reads are public; object names
-- are random UUIDs under the owner's profile folder. Like the resumes
-- bucket, writes go through the signed-in user's Supabase client, so these
-- policies are the actual access control for uploads.
-- ─────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'publish-media',
  'publish-media',
  true,
  8388608, -- 8 MB (Instagram's image limit)
  array['image/jpeg']
)
on conflict (id) do nothing;

create policy "Users can upload own publish media"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'publish-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete own publish media"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'publish-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
