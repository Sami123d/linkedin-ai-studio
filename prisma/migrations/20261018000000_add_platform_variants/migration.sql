-- Phase 1 (multi-platform variants): hand-written like every migration since
-- Milestone 2 — `prisma migrate dev` can't validate against the shadow DB
-- (no `auth` schema there). Apply with `prisma migrate deploy`.

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('LINKEDIN', 'FACEBOOK', 'INSTAGRAM');

-- CreateEnum
CREATE TYPE "VariantPlatform" AS ENUM ('FACEBOOK', 'INSTAGRAM');

-- CreateEnum
CREATE TYPE "VariantPublishStatus" AS ENUM ('NOT_PUBLISHED', 'PUBLISHED', 'FAILED');

-- AlterTable
ALTER TABLE "content_plans" ADD COLUMN "platforms" "Platform"[] DEFAULT ARRAY['LINKEDIN']::"Platform"[];

-- CreateTable
CREATE TABLE "platform_variants" (
    "id" TEXT NOT NULL,
    "profile_id" UUID NOT NULL,
    "draft_id" TEXT NOT NULL,
    "platform" "VariantPlatform" NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT,
    "model" TEXT,
    "content" TEXT,
    "hashtags" TEXT[],
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "approval_status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "scheduled_for" TIMESTAMPTZ(6),
    "rejection_reason" TEXT,
    "approved_at" TIMESTAMPTZ(6),
    "publish_status" "VariantPublishStatus" NOT NULL DEFAULT 'NOT_PUBLISHED',
    "published_at" TIMESTAMPTZ(6),
    "published_url" TEXT,
    "publish_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "platform_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variant_attempts" (
    "id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "response" TEXT,
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "total_tokens" INTEGER,
    "succeeded" BOOLEAN NOT NULL,
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "variant_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_variants_draft_id_platform_key" ON "platform_variants"("draft_id", "platform");

-- CreateIndex
CREATE INDEX "platform_variants_profile_id_scheduled_for_idx" ON "platform_variants"("profile_id", "scheduled_for");

-- CreateIndex
CREATE INDEX "variant_attempts_variant_id_idx" ON "variant_attempts"("variant_id");

-- AddForeignKey
ALTER TABLE "platform_variants" ADD CONSTRAINT "platform_variants_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_attempts" ADD CONSTRAINT "variant_attempts_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "platform_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: same defense-in-depth-only posture as every other table (Prisma's
-- connection bypasses it regardless — see the Milestone 2 migration).
ALTER TABLE "platform_variants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "variant_attempts" ENABLE ROW LEVEL SECURITY;
