-- Milestone 7 (RAG / pgvector): hand-written like every migration since
-- Milestone 2 — `prisma migrate dev` can't validate against the shadow DB
-- (no `auth` schema there). This one additionally uses `Unsupported("vector(n)")`
-- in schema.prisma, which Prisma's migration engine can't generate DDL for
-- at all regardless of the shadow-DB issue. Apply with `prisma migrate deploy`.

-- Supabase ships pgvector as an installable extension; this is idempotent
-- and safe to re-run.
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "KnowledgeSourceType" AS ENUM (
  'RESUME', 'PROJECT', 'EXPERIENCE', 'ACHIEVEMENT', 'SKILL',
  'WRITING_STYLE_SAMPLE', 'GOAL', 'OPINION'
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" TEXT NOT NULL,
    "profile_id" UUID NOT NULL,
    "source_type" "KnowledgeSourceType" NOT NULL,
    "source_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(768) NOT NULL,
    "embedding_model" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_chunks_source_type_source_id_key" ON "knowledge_chunks"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "knowledge_chunks_profile_id_idx" ON "knowledge_chunks"("profile_id");

-- Approximate nearest-neighbor index for cosine distance (`<=>`), the
-- operator src/features/rag/retrieve.ts's similarity query uses. HNSW
-- (not ivfflat) because it doesn't need existing rows/ANALYZE to build a
-- useful index — reasonable default for a KB that starts empty.
CREATE INDEX "knowledge_chunks_embedding_hnsw_idx" ON "knowledge_chunks"
  USING hnsw ("embedding" vector_cosine_ops);

-- RLS: same defense-in-depth-only posture as every other table (Prisma's
-- connection bypasses it regardless — see the Milestone 2 migration).
ALTER TABLE "knowledge_chunks" ENABLE ROW LEVEL SECURITY;
