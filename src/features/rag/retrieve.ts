import "server-only";

import { getAIEmbeddingProvider } from "@/ai/providers";
import { prisma } from "@/db/prisma";
import { toVectorLiteral } from "@/features/rag/vector";
import type { KnowledgeSourceType } from "@/generated/prisma/client";

export type RetrievedChunk = {
  id: string;
  sourceType: KnowledgeSourceType;
  sourceId: string;
  content: string;
  /// Cosine similarity in [-1, 1] (typically [0, 1] for embeddings of real
  /// text) — `1 - cosine distance`, so higher is more relevant.
  similarity: number;
};

/// What the Planning Agent (Milestone 8) will call to pull the most
/// relevant Knowledge Base content for a given topic/brief into its
/// generation context. Scoped to `profileId` — never returns another
/// user's KB content.
export async function retrieveRelevantChunks(
  profileId: string,
  query: string,
  k = 5,
): Promise<RetrievedChunk[]> {
  const provider = getAIEmbeddingProvider();
  const { embedding } = await provider.embed(query);
  const vectorLiteral = toVectorLiteral(embedding);

  return prisma.$queryRaw<RetrievedChunk[]>`
    SELECT
      id,
      source_type AS "sourceType",
      source_id AS "sourceId",
      content,
      1 - (embedding <=> ${vectorLiteral}::vector) AS similarity
    FROM knowledge_chunks
    WHERE profile_id = ${profileId}::uuid
    ORDER BY embedding <=> ${vectorLiteral}::vector
    LIMIT ${k}
  `;
}
