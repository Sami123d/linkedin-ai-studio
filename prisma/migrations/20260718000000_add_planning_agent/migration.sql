-- Milestone 8 (Planning Agent): hand-written like every migration since
-- Milestone 2 — `prisma migrate dev` can't validate against the shadow DB
-- (no `auth` schema there). Apply with `prisma migrate deploy`.

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ContentFormat" AS ENUM ('SINGLE_POST', 'CAROUSEL', 'ARTICLE');

-- CreateTable
CREATE TABLE "content_plans" (
    "id" TEXT NOT NULL,
    "research_id" TEXT NOT NULL,
    "profile_id" UUID NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT,
    "model" TEXT,
    "format" "ContentFormat",
    "selected_angle" TEXT,
    "hook" TEXT,
    "key_message" TEXT,
    "outline" TEXT[],
    "tone_guidance" TEXT,
    "call_to_action" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "content_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_attempts" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
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

    CONSTRAINT "plan_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "content_plans_research_id_profile_id_key" ON "content_plans"("research_id", "profile_id");

-- CreateIndex
CREATE INDEX "content_plans_profile_id_idx" ON "content_plans"("profile_id");

-- CreateIndex
CREATE INDEX "plan_attempts_plan_id_idx" ON "plan_attempts"("plan_id");

-- AddForeignKey
ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_research_id_fkey" FOREIGN KEY ("research_id") REFERENCES "research_briefs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_attempts" ADD CONSTRAINT "plan_attempts_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "content_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: same defense-in-depth-only posture as every other table (Prisma's
-- connection bypasses it regardless — see the Milestone 2 migration).
ALTER TABLE "content_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plan_attempts" ENABLE ROW LEVEL SECURITY;
