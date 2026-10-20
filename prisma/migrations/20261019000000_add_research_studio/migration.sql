-- Research Studio (trend-to-post research with real sources): hand-written
-- like every migration since Milestone 2 — `prisma migrate dev` can't
-- validate against the shadow DB (no `auth` schema there). Apply with
-- `prisma migrate deploy`. Additive only: existing rows are unaffected
-- (trends.profile_id stays NULL = the shared pool).

-- AlterTable
ALTER TABLE "trends" ADD COLUMN "profile_id" UUID;

-- AlterTable
ALTER TABLE "research_briefs"
    ADD COLUMN "why_it_matters_now" TEXT,
    ADD COLUMN "audience_fit" TEXT,
    ADD COLUMN "platform_fit" TEXT[],
    ADD COLUMN "evidence" JSONB;

-- CreateTable
CREATE TABLE "research_requests" (
    "id" TEXT NOT NULL,
    "profile_id" UUID NOT NULL,
    "prompt" TEXT NOT NULL,
    "timeframe_days" INTEGER NOT NULL DEFAULT 7,
    "audience" TEXT,
    "industry" TEXT,
    "angle" TEXT,
    "purpose" TEXT,
    "tone" TEXT,
    "instructions" TEXT,
    "call_to_action" TEXT,
    "include_links" BOOLEAN NOT NULL DEFAULT false,
    "platforms" "Platform"[] DEFAULT ARRAY['LINKEDIN']::"Platform"[],
    "base_trend_id" TEXT,
    "trend_id" TEXT,
    "focus_title" TEXT,
    "discovery_status" "ResearchStatus" NOT NULL DEFAULT 'PENDING',
    "discovery_attempts" INTEGER NOT NULL DEFAULT 0,
    "discovery_error" TEXT,
    "discovered_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "research_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_sources" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "profile_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "publisher" TEXT,
    "url" TEXT NOT NULL,
    "discussion_url" TEXT,
    "published_at" TIMESTAMPTZ(6),
    "retrieved_at" TIMESTAMPTZ(6) NOT NULL,
    "snippet" TEXT,
    "is_recent" BOOLEAN NOT NULL DEFAULT false,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "dedupe_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_discovery_attempts" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "queries" TEXT[],
    "provider_results" JSONB NOT NULL,
    "source_count" INTEGER NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "prompt" TEXT,
    "response" TEXT,
    "succeeded" BOOLEAN NOT NULL,
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_discovery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trends_profile_id_idx" ON "trends"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "research_requests_trend_id_key" ON "research_requests"("trend_id");

-- CreateIndex
CREATE INDEX "research_requests_profile_id_created_at_idx" ON "research_requests"("profile_id", "created_at");

-- CreateIndex
CREATE INDEX "research_sources_request_id_idx" ON "research_sources"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "research_sources_request_id_dedupe_key_key" ON "research_sources"("request_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "research_discovery_attempts_request_id_idx" ON "research_discovery_attempts"("request_id");

-- AddForeignKey
ALTER TABLE "research_requests" ADD CONSTRAINT "research_requests_base_trend_id_fkey" FOREIGN KEY ("base_trend_id") REFERENCES "trends"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_requests" ADD CONSTRAINT "research_requests_trend_id_fkey" FOREIGN KEY ("trend_id") REFERENCES "trends"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_sources" ADD CONSTRAINT "research_sources_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "research_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_discovery_attempts" ADD CONSTRAINT "research_discovery_attempts_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "research_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: same defense-in-depth-only posture as every other table (Prisma's
-- connection bypasses it regardless — see the Milestone 2 migration).
-- Research requests hold profile-specific prompts, so with RLS on and no
-- policies they are unreadable through the Supabase Data API.
ALTER TABLE "research_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "research_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "research_discovery_attempts" ENABLE ROW LEVEL SECURITY;
