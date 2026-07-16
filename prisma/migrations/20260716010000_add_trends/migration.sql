-- Milestone 5 (Trend Collection): hand-written like the two migrations
-- before it — `prisma migrate dev` can't validate against the shadow DB
-- because the shadow DB has no `auth` schema, and that failure blocks even
-- unrelated `public`-schema migrations from being generated automatically.
-- See the Milestone 2/4 migrations for the full explanation. Apply with
-- `prisma migrate deploy`.

-- CreateEnum
CREATE TYPE "TrendStatus" AS ENUM ('NEW', 'REVIEWED', 'DISMISSED');

-- CreateTable
CREATE TABLE "trends" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "summary" TEXT,
    "source_name" TEXT,
    "source_url" TEXT,
    "score" DOUBLE PRECISION,
    "published_at" TIMESTAMPTZ(6),
    "status" "TrendStatus" NOT NULL DEFAULT 'NEW',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "trends_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trends_status_created_at_idx" ON "trends"("status", "created_at");

-- RLS: same defense-in-depth-only posture as every other table (see the
-- Milestone 2 migration) — Prisma's connection bypasses it regardless.
ALTER TABLE "trends" ENABLE ROW LEVEL SECURITY;
