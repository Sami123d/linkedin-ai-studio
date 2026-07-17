"use server";

import { revalidatePath } from "next/cache";

import { getAIProvider } from "@/ai/providers";
import {
  DraftGenerationError,
  generateDraft,
} from "@/ai/writing/generate-draft";
import { prisma } from "@/db/prisma";
import { requireProfileId } from "@/features/knowledge-base/session";
import type { ActionResult } from "@/features/knowledge-base/types";
import { retrieveRelevantChunks } from "@/features/rag/retrieve";

/// Completed content plans belonging to the current user, joined with their
/// draft (if any). ContentPlan is already scoped to (research, profile),
/// so filtering by profileId here is sufficient — no extra join needed to
/// enforce ownership.
export async function listWritingQueue() {
  const profileId = await requireProfileId();

  return prisma.contentPlan.findMany({
    where: { profileId, status: "COMPLETED" },
    include: { research: { include: { trend: true } }, draft: true },
    orderBy: { completedAt: "desc" },
  });
}

export async function runDraft(planId: string): Promise<ActionResult> {
  const profileId = await requireProfileId();

  const plan = await prisma.contentPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.profileId !== profileId) {
    return { error: "Content plan not found." };
  }
  if (plan.status !== "COMPLETED") {
    return { error: "The content plan must be completed before writing." };
  }
  if (!plan.format || !plan.hook || !plan.keyMessage || !plan.toneGuidance) {
    return { error: "Content plan is missing required fields." };
  }

  const existing = await prisma.draft.findUnique({ where: { planId } });
  const attemptNumber = (existing?.attempts ?? 0) + 1;
  const attemptStartedAt = new Date();

  const draft = await prisma.draft.upsert({
    where: { planId },
    create: {
      planId,
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
    const [writingSamples, knowledgeChunks] = await Promise.all([
      prisma.writingStyleSample.findMany({
        where: { profileId },
        take: 5,
        orderBy: { createdAt: "desc" },
      }),
      retrieveRelevantChunks(profileId, plan.selectedAngle ?? plan.keyMessage, 5).catch(
        () => [],
      ),
    ]);

    const provider = getAIProvider();
    const { data, raw, prompt } = await generateDraft(provider, {
      format: plan.format,
      selectedAngle: plan.selectedAngle ?? "",
      hook: plan.hook,
      keyMessage: plan.keyMessage,
      outline: plan.outline,
      toneGuidance: plan.toneGuidance,
      callToAction: plan.callToAction ?? "",
      writingSamples: writingSamples.map((w) => w.content),
      knowledgeContext: knowledgeChunks.map((c) => c.content),
    });

    await prisma.$transaction([
      prisma.draft.update({
        where: { id: draft.id },
        data: {
          status: "COMPLETED",
          provider: provider.name,
          model: raw.model,
          content: data.content ?? null,
          slides: data.slides,
          hashtags: data.hashtags,
          errorMessage: null,
          completedAt: new Date(),
        },
      }),
      prisma.draftAttempt.create({
        data: {
          draftId: draft.id,
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

    revalidatePath("/writing");
    return { success: true, message: "Draft completed." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const prompt =
      error instanceof DraftGenerationError
        ? error.prompt
        : "(provider unavailable before a prompt could be built)";
    const raw = error instanceof DraftGenerationError ? error.raw : undefined;
    const providerName = getAiProviderNameSafely();

    await prisma.$transaction([
      prisma.draft.update({
        where: { id: draft.id },
        data: {
          status: "FAILED",
          errorMessage: message,
          completedAt: new Date(),
        },
      }),
      prisma.draftAttempt.create({
        data: {
          draftId: draft.id,
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

    revalidatePath("/writing");
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
