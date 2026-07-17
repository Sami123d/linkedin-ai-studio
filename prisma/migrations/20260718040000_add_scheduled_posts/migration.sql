-- Milestone 12 (Content Calendar + Approval UI): hand-written like every
-- migration since Milestone 2 — `prisma migrate dev` can't validate
-- against the shadow DB (no `auth` schema there). Apply with
-- `prisma migrate deploy`.

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "scheduled_posts" (
    "id" TEXT NOT NULL,
    "draft_id" TEXT NOT NULL,
    "approval_status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "scheduled_for" TIMESTAMPTZ(6),
    "rejection_reason" TEXT,
    "approved_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "scheduled_posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_posts_draft_id_key" ON "scheduled_posts"("draft_id");

-- AddForeignKey
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: same defense-in-depth-only posture as every other table (Prisma's
-- connection bypasses it regardless — see the Milestone 2 migration).
ALTER TABLE "scheduled_posts" ENABLE ROW LEVEL SECURITY;
