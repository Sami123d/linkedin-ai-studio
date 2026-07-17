"use server";

import { revalidatePath } from "next/cache";

import { getAIProvider } from "@/ai/providers";
import {
  generateQualityReview,
  ReviewGenerationError,
} from "@/ai/review/generate-quality-review";
import { prisma } from "@/db/prisma";
import { requireProfileId } from "@/features/knowledge-base/session";
import type { ActionResult } from "@/features/knowledge-base/types";

/// Completed drafts belonging to the current user, joined with their
/// review (if any). Ownership flows Draft -> ContentPlan -> profileId, so
/// filtering the plan by profileId is what actually enforces ownership.
export async function listReviewQueue() {
  const profileId = await requireProfileId();

  return prisma.draft.findMany({
    where: { status: "COMPLETED", contentPlan: { profileId } },
    include: {
      contentPlan: { include: { research: { include: { trend: true } } } },
      qualityReview: true,
    },
    orderBy: { completedAt: "desc" },
  });
}

function average(scores: number[]): number {
  return Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length);
}

export async function runQualityReview(draftId: string): Promise<ActionResult> {
  const profileId = await requireProfileId();

  const draft = await prisma.draft.findUnique({
    where: { id: draftId },
    include: { contentPlan: true },
  });
  if (!draft || draft.contentPlan.profileId !== profileId) {
    return { error: "Draft not found." };
  }
  if (draft.status !== "COMPLETED") {
    return { error: "The draft must be completed before it can be reviewed." };
  }

  const existing = await prisma.qualityReview.findUnique({
    where: { draftId },
  });
  const attemptNumber = (existing?.attempts ?? 0) + 1;
  const attemptStartedAt = new Date();

  const review = await prisma.qualityReview.upsert({
    where: { draftId },
    create: {
      draftId,
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
    const writingSamples = await prisma.writingStyleSample.findMany({
      where: { profileId },
      take: 5,
      orderBy: { createdAt: "desc" },
    });

    const provider = getAIProvider();
    const { data, raw, prompt } = await generateQualityReview(provider, {
      format: draft.contentPlan.format ?? "SINGLE_POST",
      hook: draft.contentPlan.hook ?? "",
      keyMessage: draft.contentPlan.keyMessage ?? "",
      toneGuidance: draft.contentPlan.toneGuidance ?? "",
      content: draft.content,
      slides: draft.slides,
      hashtags: draft.hashtags,
      writingSamples: writingSamples.map((w) => w.content),
    });

    const overallScore = average([
      data.hookScore,
      data.clarityScore,
      data.voiceMatchScore,
      data.valueScore,
      data.ctaScore,
    ]);

    await prisma.$transaction([
      prisma.qualityReview.update({
        where: { id: review.id },
        data: {
          status: "COMPLETED",
          provider: provider.name,
          model: raw.model,
          verdict: data.verdict,
          overallScore,
          hookScore: data.hookScore,
          clarityScore: data.clarityScore,
          voiceMatchScore: data.voiceMatchScore,
          valueScore: data.valueScore,
          ctaScore: data.ctaScore,
          strengths: data.strengths,
          feedback: data.feedback,
          errorMessage: null,
          completedAt: new Date(),
        },
      }),
      prisma.reviewAttempt.create({
        data: {
          reviewId: review.id,
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

    revalidatePath("/review");
    return { success: true, message: "Review completed." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const prompt =
      error instanceof ReviewGenerationError
        ? error.prompt
        : "(provider unavailable before a prompt could be built)";
    const raw =
      error instanceof ReviewGenerationError ? error.raw : undefined;
    const providerName = getAiProviderNameSafely();

    await prisma.$transaction([
      prisma.qualityReview.update({
        where: { id: review.id },
        data: {
          status: "FAILED",
          errorMessage: message,
          completedAt: new Date(),
        },
      }),
      prisma.reviewAttempt.create({
        data: {
          reviewId: review.id,
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

    revalidatePath("/review");
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
