"use server";

import { revalidatePath } from "next/cache";

import { generateReviewedImage } from "@/ai/images/generate-reviewed-image";
import { getAIProvider, getImageProvider } from "@/ai/providers";
import { prisma } from "@/db/prisma";
import { requireProfileId } from "@/features/knowledge-base/session";
import type { ActionResult } from "@/features/knowledge-base/types";

/// Completed drafts belonging to the current user, joined with their image
/// asset (if any). Ownership flows Draft -> ContentPlan -> profileId.
export async function listImageQueue() {
  const profileId = await requireProfileId();

  return prisma.draft.findMany({
    where: { status: "COMPLETED", contentPlan: { profileId } },
    include: {
      contentPlan: { include: { research: { include: { trend: true } } } },
      imageAsset: true,
    },
    orderBy: { completedAt: "desc" },
  });
}

export async function runImageGeneration(draftId: string): Promise<ActionResult> {
  const profileId = await requireProfileId();

  const draft = await prisma.draft.findUnique({
    where: { id: draftId },
    include: { contentPlan: { include: { research: { include: { trend: true } } } } },
  });
  if (!draft || draft.contentPlan.profileId !== profileId) {
    return { error: "Draft not found." };
  }
  if (draft.status !== "COMPLETED") {
    return { error: "The draft must be completed before generating an image." };
  }

  const query =
    draft.contentPlan.selectedAngle || draft.contentPlan.research.trend.topic;

  const existing = await prisma.imageAsset.findUnique({ where: { draftId } });
  const attemptNumber = (existing?.attempts ?? 0) + 1;
  const attemptStartedAt = new Date();

  const image = await prisma.imageAsset.upsert({
    where: { draftId },
    create: {
      draftId,
      status: "PROCESSING",
      attempts: attemptNumber,
      query,
      startedAt: attemptStartedAt,
    },
    update: {
      status: "PROCESSING",
      attempts: attemptNumber,
      query,
      startedAt: attemptStartedAt,
      errorMessage: null,
    },
  });

  try {
    const provider = getImageProvider();
    // A generative provider would draw the angle's words as a text slide,
    // so it gets a wordless scene written from the post, and the result is
    // reviewed against the post (and regenerated if off-topic).
    const reviewed = provider.generative
      ? await generateReviewedImage(getAIProvider(), provider, {
          topic: draft.contentPlan.research.trend.topic,
          angle: draft.contentPlan.selectedAngle,
          hook: draft.contentPlan.hook,
          content: draft.content ?? draft.slides.join("\n"),
        })
      : null;
    const imageQuery = reviewed?.scene ?? query;
    const result = reviewed?.result ?? (await provider.getImage(query));

    await prisma.$transaction([
      prisma.imageAsset.update({
        where: { id: image.id },
        data: {
          status: "COMPLETED",
          provider: provider.name,
          query: imageQuery,
          url: result.url,
          thumbUrl: result.thumbUrl,
          attributionName: result.attributionName,
          attributionUrl: result.attributionUrl,
          sourceUrl: result.sourceUrl,
          errorMessage: null,
          completedAt: new Date(),
        },
      }),
      prisma.imageAttempt.create({
        data: {
          imageId: image.id,
          attemptNumber,
          provider: provider.name,
          query: imageQuery,
          resultUrl: result.url,
          succeeded: true,
          startedAt: attemptStartedAt,
          completedAt: new Date(),
        },
      }),
    ]);

    revalidatePath("/images");
    return {
      success: true,
      message: reviewed?.review
        ? `Image generated: relevance ${reviewed.review.relevance}/10 after ${reviewed.rounds} attempt(s).`
        : "Image found.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const providerName = getImageProviderNameSafely();

    await prisma.$transaction([
      prisma.imageAsset.update({
        where: { id: image.id },
        data: {
          status: "FAILED",
          errorMessage: message,
          completedAt: new Date(),
        },
      }),
      prisma.imageAttempt.create({
        data: {
          imageId: image.id,
          attemptNumber,
          provider: providerName,
          query,
          succeeded: false,
          errorMessage: message,
          startedAt: attemptStartedAt,
          completedAt: new Date(),
        },
      }),
    ]);

    revalidatePath("/images");
    return { error: message };
  }
}

function getImageProviderNameSafely(): string {
  try {
    return getImageProvider().name;
  } catch {
    return process.env.IMAGE_PROVIDER ?? "unknown";
  }
}
