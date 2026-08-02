"use server";

import { revalidatePath } from "next/cache";

import {
  generateLearningInsight,
  LearningGenerationError,
  type PublishedPostSummary,
} from "@/ai/learning/generate-learning-insight";
import { getAIProvider } from "@/ai/providers";
import { prisma } from "@/db/prisma";
import { computeEngagementRate } from "@/features/analytics/utils";
import { requireProfileId } from "@/features/knowledge-base/session";
import type { ActionResult } from "@/features/knowledge-base/types";

export async function listLearningInsights() {
  const profileId = await requireProfileId();
  return prisma.learningInsight.findMany({
    where: { profileId },
    orderBy: { createdAt: "desc" },
  });
}

async function getPublishedPostSummaries(
  profileId: string,
): Promise<PublishedPostSummary[]> {
  const posts = await prisma.scheduledPost.findMany({
    where: {
      publishedAt: { not: null },
      draft: { contentPlan: { profileId } },
      analyticsSnapshots: { some: {} },
    },
    include: {
      draft: {
        include: {
          contentPlan: { include: { research: { include: { trend: true } } } },
        },
      },
      analyticsSnapshots: { orderBy: { capturedAt: "desc" }, take: 1 },
    },
  });

  return posts.map((post) => {
    const latest = post.analyticsSnapshots[0];
    return {
      topic: post.draft.contentPlan.research.trend.topic,
      format: post.draft.contentPlan.format ?? "SINGLE_POST",
      selectedAngle: post.draft.contentPlan.selectedAngle,
      toneGuidance: post.draft.contentPlan.toneGuidance,
      likes: latest.likes,
      comments: latest.comments,
      shares: latest.shares,
      impressions: latest.impressions,
      engagementRate: computeEngagementRate(latest),
    };
  });
}

/// `insightId` is omitted to generate a fresh insight (creates a new row);
/// passing an existing FAILED insight's id retries it in place instead.
export async function runLearningInsight(
  insightId?: string,
): Promise<ActionResult> {
  const profileId = await requireProfileId();

  const posts = await getPublishedPostSummaries(profileId);
  if (posts.length === 0) {
    return {
      error:
        "Not enough data yet — publish at least one post and let analytics report in before generating insights.",
    };
  }

  const existing = insightId
    ? await prisma.learningInsight.findUnique({ where: { id: insightId } })
    : null;
  if (insightId && (!existing || existing.profileId !== profileId)) {
    return { error: "Insight not found." };
  }

  const attemptNumber = (existing?.attempts ?? 0) + 1;
  const attemptStartedAt = new Date();

  const insight = existing
    ? await prisma.learningInsight.update({
        where: { id: existing.id },
        data: {
          status: "PROCESSING",
          attempts: attemptNumber,
          startedAt: attemptStartedAt,
          errorMessage: null,
        },
      })
    : await prisma.learningInsight.create({
        data: {
          profileId,
          status: "PROCESSING",
          attempts: 1,
          startedAt: attemptStartedAt,
        },
      });

  try {
    const provider = getAIProvider();
    const { data, raw, prompt } = await generateLearningInsight(
      provider,
      posts,
    );

    await prisma.$transaction([
      prisma.learningInsight.update({
        where: { id: insight.id },
        data: {
          status: "COMPLETED",
          provider: provider.name,
          model: raw.model,
          summary: data.summary,
          topPerformingPatterns: data.topPerformingPatterns,
          underperformingPatterns: data.underperformingPatterns,
          recommendations: data.recommendations,
          postsAnalyzed: posts.length,
          errorMessage: null,
          completedAt: new Date(),
        },
      }),
      prisma.learningAttempt.create({
        data: {
          insightId: insight.id,
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

    revalidatePath("/learning");
    return { success: true, message: "Insights generated." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const prompt =
      error instanceof LearningGenerationError
        ? error.prompt
        : "(provider unavailable before a prompt could be built)";
    const raw =
      error instanceof LearningGenerationError ? error.raw : undefined;
    const providerName = getAiProviderNameSafely();

    await prisma.$transaction([
      prisma.learningInsight.update({
        where: { id: insight.id },
        data: {
          status: "FAILED",
          errorMessage: message,
          completedAt: new Date(),
        },
      }),
      prisma.learningAttempt.create({
        data: {
          insightId: insight.id,
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

    revalidatePath("/learning");
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
