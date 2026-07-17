import "server-only";

import crypto from "node:crypto";

import { getAIEmbeddingProvider } from "@/ai/providers";
import { prisma } from "@/db/prisma";
import { toVectorLiteral } from "@/features/rag/vector";
import type { KnowledgeSourceType } from "@/generated/prisma/client";

type ChunkInput = {
  sourceType: KnowledgeSourceType;
  sourceId: string;
  content: string;
};

/// Builds the desired chunk set straight from the 8 Knowledge Base facets
/// (Milestone 4) — one chunk per row, prefixed with enough context (title,
/// company, etc.) that the embedding captures more than a bare description.
/// Rows with empty/blank content are skipped rather than embedding an empty
/// string.
async function collectDesiredChunks(profileId: string): Promise<ChunkInput[]> {
  const [
    resume,
    projects,
    experiences,
    achievements,
    skills,
    writingSamples,
    goals,
    opinions,
  ] = await Promise.all([
    prisma.resume.findUnique({ where: { profileId } }),
    prisma.project.findMany({ where: { profileId } }),
    prisma.experience.findMany({ where: { profileId } }),
    prisma.achievement.findMany({ where: { profileId } }),
    prisma.skill.findMany({ where: { profileId } }),
    prisma.writingStyleSample.findMany({ where: { profileId } }),
    prisma.goal.findMany({ where: { profileId } }),
    prisma.opinion.findMany({ where: { profileId } }),
  ]);

  const chunks: ChunkInput[] = [];

  if (resume?.content.trim()) {
    chunks.push({
      sourceType: "RESUME",
      sourceId: resume.id,
      content: resume.content.trim(),
    });
  }
  for (const p of projects) {
    if (!p.content.trim()) continue;
    chunks.push({
      sourceType: "PROJECT",
      sourceId: p.id,
      content: `${p.title}: ${p.content.trim()}`,
    });
  }
  for (const e of experiences) {
    if (!e.content.trim()) continue;
    chunks.push({
      sourceType: "EXPERIENCE",
      sourceId: e.id,
      content: `${e.title} at ${e.company}: ${e.content.trim()}`,
    });
  }
  for (const a of achievements) {
    if (!a.content.trim()) continue;
    chunks.push({
      sourceType: "ACHIEVEMENT",
      sourceId: a.id,
      content: `${a.title}: ${a.content.trim()}`,
    });
  }
  for (const s of skills) {
    const body = s.content?.trim() || s.name;
    chunks.push({
      sourceType: "SKILL",
      sourceId: s.id,
      content: `${s.name}: ${body}`,
    });
  }
  for (const w of writingSamples) {
    if (!w.content.trim()) continue;
    const label = w.title || w.source || "Writing sample";
    chunks.push({
      sourceType: "WRITING_STYLE_SAMPLE",
      sourceId: w.id,
      content: `${label}: ${w.content.trim()}`,
    });
  }
  for (const g of goals) {
    if (!g.content.trim()) continue;
    chunks.push({
      sourceType: "GOAL",
      sourceId: g.id,
      content: `${g.title}: ${g.content.trim()}`,
    });
  }
  for (const o of opinions) {
    if (!o.content.trim()) continue;
    chunks.push({
      sourceType: "OPINION",
      sourceId: o.id,
      content: `${o.topic}: ${o.content.trim()}`,
    });
  }

  return chunks;
}

export type SyncResult = {
  created: number;
  updated: number;
  deleted: number;
  failed: number;
};

/// Re-embeds anything new or changed since the last sync and removes chunks
/// whose source row was deleted. Diffing on `content` (not a hash) is fine
/// at this KB's scale and keeps the comparison readable.
export async function syncKnowledgeBase(profileId: string): Promise<SyncResult> {
  const [desired, existing] = await Promise.all([
    collectDesiredChunks(profileId),
    prisma.knowledgeChunk.findMany({
      where: { profileId },
      select: { id: true, sourceType: true, sourceId: true, content: true },
    }),
  ]);

  const key = (c: { sourceType: string; sourceId: string }) =>
    `${c.sourceType}:${c.sourceId}`;

  const existingByKey = new Map(existing.map((c) => [key(c), c]));
  const desiredKeys = new Set(desired.map(key));

  const toDeleteIds = existing
    .filter((c) => !desiredKeys.has(key(c)))
    .map((c) => c.id);

  const toEmbed = desired.filter((c) => {
    const match = existingByKey.get(key(c));
    return !match || match.content !== c.content;
  });

  const provider = getAIEmbeddingProvider();
  let created = 0;
  let updated = 0;
  let failed = 0;

  for (const chunk of toEmbed) {
    const isNew = !existingByKey.has(key(chunk));
    try {
      const { embedding, model } = await provider.embed(chunk.content);
      const vectorLiteral = toVectorLiteral(embedding);

      await prisma.$executeRaw`
        INSERT INTO knowledge_chunks
          (id, profile_id, source_type, source_id, content, embedding, embedding_model, created_at, updated_at)
        VALUES
          (${crypto.randomUUID()}, ${profileId}::uuid, ${chunk.sourceType}::"KnowledgeSourceType", ${chunk.sourceId}, ${chunk.content}, ${vectorLiteral}::vector, ${model}, now(), now())
        ON CONFLICT (source_type, source_id) DO UPDATE SET
          profile_id = EXCLUDED.profile_id,
          content = EXCLUDED.content,
          embedding = EXCLUDED.embedding,
          embedding_model = EXCLUDED.embedding_model,
          updated_at = now()
      `;

      if (isNew) created++;
      else updated++;
    } catch {
      failed++;
    }
  }

  if (toDeleteIds.length > 0) {
    await prisma.knowledgeChunk.deleteMany({ where: { id: { in: toDeleteIds } } });
  }

  return { created, updated, deleted: toDeleteIds.length, failed };
}
