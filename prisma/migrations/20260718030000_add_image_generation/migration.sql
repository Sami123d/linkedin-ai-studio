-- Milestone 11 (Image Generation): hand-written like every migration since
-- Milestone 2 — `prisma migrate dev` can't validate against the shadow DB
-- (no `auth` schema there). Apply with `prisma migrate deploy`.

-- CreateEnum
CREATE TYPE "ImageStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "image_assets" (
    "id" TEXT NOT NULL,
    "draft_id" TEXT NOT NULL,
    "status" "ImageStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT,
    "query" TEXT,
    "url" TEXT,
    "thumb_url" TEXT,
    "attribution_name" TEXT,
    "attribution_url" TEXT,
    "source_url" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "image_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "image_attempts" (
    "id" TEXT NOT NULL,
    "image_id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "result_url" TEXT,
    "succeeded" BOOLEAN NOT NULL,
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "image_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "image_assets_draft_id_key" ON "image_assets"("draft_id");

-- CreateIndex
CREATE INDEX "image_attempts_image_id_idx" ON "image_attempts"("image_id");

-- AddForeignKey
ALTER TABLE "image_assets" ADD CONSTRAINT "image_assets_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "image_attempts" ADD CONSTRAINT "image_attempts_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "image_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: same defense-in-depth-only posture as every other table (Prisma's
-- connection bypasses it regardless — see the Milestone 2 migration).
ALTER TABLE "image_assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "image_attempts" ENABLE ROW LEVEL SECURITY;
