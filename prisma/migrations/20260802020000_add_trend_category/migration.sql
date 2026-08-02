-- Adds Trend.category (nullable, additive) so the n8n Trend Collector
-- workflow's categorization step has somewhere to land instead of being
-- computed and discarded. Hand-written like every migration since
-- Milestone 2 — `prisma migrate dev` can't validate against the shadow DB
-- (no `auth` schema there). Apply with `prisma migrate deploy`.

-- AlterTable
ALTER TABLE "trends" ADD COLUMN "category" TEXT;
