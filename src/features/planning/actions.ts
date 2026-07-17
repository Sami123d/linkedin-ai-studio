"use server";

import { revalidatePath } from "next/cache";

import { getAIProvider } from "@/ai/providers";
import {
  generateContentPlan,
  PlanGenerationError,
} from "@/ai/planning/generate-content-plan";
import { prisma } from "@/db/prisma";
import { requireProfileId } from "@/features/knowledge-base/session";
import type { ActionResult } from "@/features/knowledge-base/types";
import { retrieveRelevantChunks } from "@/features/rag/retrieve";

/// Completed research briefs, joined with the current user's own plan for
/// each one (if any) — a ContentPlan is scoped to (research, profile), so
/// two users planning off the same brief never see each other's plan.
export async function listPlanningQueue() {
  const profileId = await requireProfileId();

  const researchBriefs = await prisma.researchBrief.findMany({
    where: { status: "COMPLETED" },
    include: {
      trend: true,
      contentPlans: { where: { profileId } },
    },
    orderBy: { completedAt: "desc" },
  });

  return researchBriefs.map((r) => ({
    ...r,
    contentPlan: r.contentPlans[0] ?? null,
  }));
}

export async function runContentPlan(researchId: string): Promise<ActionResult> {
  const profileId = await requireProfileId();

  const research = await prisma.researchBrief.findUnique({
    where: { id: researchId },
    include: { trend: true },
  });
  if (!research) {
    return { error: "Research brief not found." };
  }
  if (research.status !== "COMPLETED") {
    return { error: "Research must be completed before planning." };
  }

  const existing = await prisma.contentPlan.findUnique({
    where: { researchId_profileId: { researchId, profileId } },
  });
  const attemptNumber = (existing?.attempts ?? 0) + 1;
  const attemptStartedAt = new Date();

  const plan = await prisma.contentPlan.upsert({
    where: { researchId_profileId: { researchId, profileId } },
    create: {
      researchId,
      profileId,
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

  try {
    const [knowledgeChunks, goals] = await Promise.all([
      retrieveRelevantChunks(profileId, research.trend.topic, 8).catch(
        () => [],
      ),
      prisma.goal.findMany({ where: { profileId } }),
    ]);

    const provider = getAIProvider();
    const { data, raw, prompt } = await generateContentPlan(provider, {
      trendTopic: research.trend.topic,
      research: {
        executiveSummary: research.executiveSummary,
        keyInsights: research.keyInsights,
        marketOpportunities: research.marketOpportunities,
        risks: research.risks,
        statistics: research.statistics,
        contentAngles: research.contentAngles,
      },
      knowledgeContext: knowledgeChunks.map((c) => c.content),
      goals: goals.map((g) => `${g.title}: ${g.content}`),
    });

    await prisma.$transaction([
      prisma.contentPlan.update({
        where: { id: plan.id },
        data: {
          status: "COMPLETED",
          provider: provider.name,
          model: raw.model,
          format: data.format,
          selectedAngle: data.selectedAngle,
          hook: data.hook,
          keyMessage: data.keyMessage,
          outline: data.outline,
          toneGuidance: data.toneGuidance,
          callToAction: data.callToAction,
          errorMessage: null,
          completedAt: new Date(),
        },
      }),
      prisma.planAttempt.create({
        data: {
          planId: plan.id,
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

    revalidatePath("/planning");
    return { success: true, message: "Plan completed." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const prompt =
      error instanceof PlanGenerationError
        ? error.prompt
        : "(provider unavailable before a prompt could be built)";
    const raw = error instanceof PlanGenerationError ? error.raw : undefined;
    const providerName = getAiProviderNameSafely();

    await prisma.$transaction([
      prisma.contentPlan.update({
        where: { id: plan.id },
        data: {
          status: "FAILED",
          errorMessage: message,
          completedAt: new Date(),
        },
      }),
      prisma.planAttempt.create({
        data: {
          planId: plan.id,
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

    revalidatePath("/planning");
    return { error: message };
  }
}

function getAiProviderNameSafely(): string {
  try {
    return getAIProvider().name;
  } catch {
    return process.env.AI_PROVIDER ?? "unknown";
  }
}
