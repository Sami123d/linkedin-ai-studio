"use server";

import { revalidatePath } from "next/cache";

import { getAIProvider } from "@/ai/providers";
import {
  generateResearchBrief,
  ResearchGenerationError,
} from "@/ai/research/generate-research-brief";
import { prisma } from "@/db/prisma";
import { requireProfileId } from "@/features/knowledge-base/session";
import type { ActionResult } from "@/features/knowledge-base/types";

/// Research isn't scoped to a profile (same reasoning as Trend — see
/// schema.prisma) — `requireProfileId()` only enforces "must be logged in."
export async function listResearchQueue() {
  await requireProfileId();
  return prisma.trend.findMany({
    where: { status: "REVIEWED" },
    include: { researchBrief: true },
    orderBy: { createdAt: "desc" },
  });
}

/// Triggers generation for a REVIEWED trend, or re-runs it for one whose
/// last attempt failed — both are the same operation (retry-in-place, see
/// schema.prisma's ResearchBrief comment), so there's one action, not two.
export async function runResearch(trendId: string): Promise<ActionResult> {
  await requireProfileId();

  const trend = await prisma.trend.findUnique({ where: { id: trendId } });
  if (!trend) {
    return { error: "Trend not found." };
  }
  if (trend.status !== "REVIEWED") {
    return { error: "Only reviewed trends can be researched." };
  }

  const existing = await prisma.researchBrief.findUnique({
    where: { trendId },
  });
  const attemptNumber = (existing?.attempts ?? 0) + 1;
  const attemptStartedAt = new Date();

  const brief = await prisma.researchBrief.upsert({
    where: { trendId },
    create: {
      trendId,
      status: "PROCESSING",
      attempts: attemptNumber,
      startedAt: attemptStartedAt,
    },
    update: {
      status: "PROCESSING",
      attempts: attemptNumber,
      startedAt: attemptStartedAt,
      errorMessage: null,
    },
  });

  const trendInput = {
    topic: trend.topic,
    summary: trend.summary,
    sourceName: trend.sourceName,
    sourceUrl: trend.sourceUrl,
  };

  try {
    const provider = getAIProvider();
    const { data, raw, prompt } = await generateResearchBrief(
      provider,
      trendInput,
    );

    await prisma.$transaction([
      prisma.researchBrief.update({
        where: { id: brief.id },
        data: {
          status: "COMPLETED",
          provider: provider.name,
          model: raw.model,
          executiveSummary: data.executiveSummary,
          keyInsights: data.keyInsights,
          marketOpportunities: data.marketOpportunities,
          risks: data.risks,
          statistics: data.statistics,
          contentAngles: data.contentAngles,
          errorMessage: null,
          completedAt: new Date(),
        },
      }),
      prisma.researchAttempt.create({
        data: {
          researchId: brief.id,
          attemptNumber,
          provider: provider.name,
          model: raw.model,
          prompt,
          response: raw.text,
          promptTokens: raw.usage?.promptTokens,
          completionTokens: raw.usage?.completionTokens,
          totalTokens: raw.usage?.totalTokens,
          succeeded: true,
          startedAt: attemptStartedAt,
          completedAt: new Date(),
        },
      }),
    ]);

    revalidatePath("/research");
    revalidatePath("/trends");
    return { success: true, message: "Research completed." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const prompt =
      error instanceof ResearchGenerationError
        ? error.prompt
        : "(provider unavailable before a prompt could be built)";
    const raw =
      error instanceof ResearchGenerationError ? error.raw : undefined;
    const providerName = getAiProviderNameSafely();

    await prisma.$transaction([
      prisma.researchBrief.update({
        where: { id: brief.id },
        data: {
          status: "FAILED",
          errorMessage: message,
          completedAt: new Date(),
        },
      }),
      prisma.researchAttempt.create({
        data: {
          researchId: brief.id,
          attemptNumber,
          provider: providerName,
          model: raw?.model ?? "unknown",
          prompt,
          response: raw?.text,
          promptTokens: raw?.usage?.promptTokens,
          completionTokens: raw?.usage?.completionTokens,
          totalTokens: raw?.usage?.totalTokens,
          succeeded: false,
          errorMessage: message,
          startedAt: attemptStartedAt,
          completedAt: new Date(),
        },
      }),
    ]);

    revalidatePath("/research");
    revalidatePath("/trends");
    return { error: message };
  }
}

/// `getAIProvider()` itself can throw (e.g. missing GEMINI_API_KEY) before
/// we even know its `.name` — fall back to the configured provider id from
/// env for the audit log rather than leaving `provider` blank.
function getAiProviderNameSafely(): string {
  try {
    return getAIProvider().name;
  } catch {
    return process.env.AI_PROVIDER ?? "unknown";
  }
}
