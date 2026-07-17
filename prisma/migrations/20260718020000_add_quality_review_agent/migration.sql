-- Milestone 10 (Quality Review Agent): hand-written like every migration
-- since Milestone 2 — `prisma migrate dev` can't validate against the
-- shadow DB (no `auth` schema there). Apply with `prisma migrate deploy`.

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReviewVerdict" AS ENUM ('APPROVED', 'NEEDS_REVISION');

-- CreateTable
CREATE TABLE "quality_reviews" (
    "id" TEXT NOT NULL,
    "draft_id" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT,
    "model" TEXT,
    "verdict" "ReviewVerdict",
    "overall_score" INTEGER,
    "hook_score" INTEGER,
    "clarity_score" INTEGER,
    "voice_match_score" INTEGER,
    "value_score" INTEGER,
    "cta_score" INTEGER,
    "strengths" TEXT[],
    "feedback" TEXT[],
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "quality_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_attempts" (
    "id" TEXT NOT NULL,
    "review_id" TEXT NOT NULL,
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

    CONSTRAINT "review_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quality_reviews_draft_id_key" ON "quality_reviews"("draft_id");

-- CreateIndex
CREATE INDEX "review_attempts_review_id_idx" ON "review_attempts"("review_id");

-- AddForeignKey
ALTER TABLE "quality_reviews" ADD CONSTRAINT "quality_reviews_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_attempts" ADD CONSTRAINT "review_attempts_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "quality_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: same defense-in-depth-only posture as every other table (Prisma's
-- connection bypasses it regardless — see the Milestone 2 migration).
ALTER TABLE "quality_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "review_attempts" ENABLE ROW LEVEL SECURITY;
