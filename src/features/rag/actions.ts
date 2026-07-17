"use server";

import { revalidatePath } from "next/cache";

import { requireProfileId } from "@/features/knowledge-base/session";
import { retrieveRelevantChunks, type RetrievedChunk } from "@/features/rag/retrieve";
import { syncKnowledgeBase, type SyncResult } from "@/features/rag/sync";
import { prisma } from "@/db/prisma";

export type SyncActionResult =
  | { error: string }
  | { success: true; result: SyncResult };

export async function runKnowledgeBaseSync(): Promise<SyncActionResult> {
  const profileId = await requireProfileId();

  try {
    const result = await syncKnowledgeBase(profileId);
    revalidatePath("/knowledge-base");
    return { success: true, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { error: message };
  }
}

export async function getKnowledgeChunkCount(): Promise<number> {
  const profileId = await requireProfileId();
  return prisma.knowledgeChunk.count({ where: { profileId } });
}

export type TestRetrievalResult =
  | { error: string }
  | { success: true; chunks: RetrievedChunk[] };

export async function testRetrieval(query: string): Promise<TestRetrievalResult> {
  const profileId = await requireProfileId();

  const trimmed = query.trim();
  if (!trimmed) {
    return { error: "Enter a query to test." };
  }

  try {
    const chunks = await retrieveRelevantChunks(profileId, trimmed, 5);
    return { success: true, chunks };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { error: message };
  }
}
