-- Milestone 15 (Learning Agent): hand-written like every migration since
-- Milestone 2 — `prisma migrate dev` can't validate against the shadow DB
-- (no `auth` schema there). Apply with `prisma migrate deploy`.

-- CreateEnum
CREATE TYPE "LearningStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "learning_insights" (
    "id" TEXT NOT NULL,
    "profile_id" UUID NOT NULL,
    "status" "LearningStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT,
    "model" TEXT,
    "summary" TEXT,
    "top_performing_patterns" TEXT[],
    "underperforming_patterns" TEXT[],
    "recommendations" TEXT[],
    "posts_analyzed" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "learning_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_attempts" (
    "id" TEXT NOT NULL,
    "insight_id" TEXT NOT NULL,
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

    CONSTRAINT "learning_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "learning_insights_profile_id_created_at_idx" ON "learning_insights"("profile_id", "created_at");

-- CreateIndex
CREATE INDEX "learning_attempts_insight_id_idx" ON "learning_attempts"("insight_id");

-- AddForeignKey
ALTER TABLE "learning_attempts" ADD CONSTRAINT "learning_attempts_insight_id_fkey" FOREIGN KEY ("insight_id") REFERENCES "learning_insights"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: same defense-in-depth-only posture as every other table (Prisma's
-- connection bypasses it regardless — see the Milestone 2 migration).
ALTER TABLE "learning_insights" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "learning_attempts" ENABLE ROW LEVEL SECURITY;
