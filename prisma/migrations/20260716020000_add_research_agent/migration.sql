-- Milestone 6 (Research Agent): hand-written like every migration since
-- Milestone 2 — `prisma migrate dev` can't validate against the shadow DB
-- (no `auth` schema there), which blocks generation even for migrations
-- that only touch `public`. Apply with `prisma migrate deploy`.

-- CreateEnum
CREATE TYPE "ResearchStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "research_briefs" (
    "id" TEXT NOT NULL,
    "trend_id" TEXT NOT NULL,
    "status" "ResearchStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT,
    "model" TEXT,
    "executive_summary" TEXT,
    "key_insights" TEXT[],
    "market_opportunities" TEXT[],
    "risks" TEXT[],
    "statistics" TEXT[],
    "content_angles" TEXT[],
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "research_briefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_attempts" (
    "id" TEXT NOT NULL,
    "research_id" TEXT NOT NULL,
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

    CONSTRAINT "research_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "research_briefs_trend_id_key" ON "research_briefs"("trend_id");

-- CreateIndex
CREATE INDEX "research_attempts_research_id_idx" ON "research_attempts"("research_id");

-- AddForeignKey
ALTER TABLE "research_briefs" ADD CONSTRAINT "research_briefs_trend_id_fkey" FOREIGN KEY ("trend_id") REFERENCES "trends"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_attempts" ADD CONSTRAINT "research_attempts_research_id_fkey" FOREIGN KEY ("research_id") REFERENCES "research_briefs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: same defense-in-depth-only posture as every other table (Prisma's
-- connection bypasses it regardless — see the Milestone 2 migration).
ALTER TABLE "research_briefs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "research_attempts" ENABLE ROW LEVEL SECURITY;
