-- Milestone 13 (Scheduler): hand-written like every migration since
-- Milestone 2 — `prisma migrate dev` can't validate against the shadow DB
-- (no `auth` schema there), even for an additive column-only change like
-- this one, since Prisma replays the full migration history against it.
-- Apply with `prisma migrate deploy`.

-- AlterTable
ALTER TABLE "scheduled_posts"
  ADD COLUMN "published_url" TEXT,
  ADD COLUMN "publishing_started_at" TIMESTAMPTZ(6),
  ADD COLUMN "publish_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "publish_error" TEXT;
