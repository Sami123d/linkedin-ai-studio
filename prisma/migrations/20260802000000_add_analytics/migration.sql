-- Milestone 14 (Analytics): hand-written like every migration since
-- Milestone 2 — `prisma migrate dev` can't validate against the shadow DB
-- (no `auth` schema there). Apply with `prisma migrate deploy`.

-- CreateTable
CREATE TABLE "analytics_snapshots" (
    "id" TEXT NOT NULL,
    "scheduled_post_id" TEXT NOT NULL,
    "captured_at" TIMESTAMPTZ(6) NOT NULL,
    "impressions" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "clicks" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "analytics_snapshots_scheduled_post_id_captured_at_idx" ON "analytics_snapshots"("scheduled_post_id", "captured_at");

-- AddForeignKey
ALTER TABLE "analytics_snapshots" ADD CONSTRAINT "analytics_snapshots_scheduled_post_id_fkey" FOREIGN KEY ("scheduled_post_id") REFERENCES "scheduled_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: same defense-in-depth-only posture as every other table (Prisma's
-- connection bypasses it regardless — see the Milestone 2 migration).
ALTER TABLE "analytics_snapshots" ENABLE ROW LEVEL SECURITY;
