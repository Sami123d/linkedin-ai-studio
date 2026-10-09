"use server";

import { prisma } from "@/db/prisma";
import { requireProfileId } from "@/features/knowledge-base/session";
import { runImageGeneration } from "@/features/images/actions";
import type { ActionResult } from "@/features/knowledge-base/types";
import { runContentPlan } from "@/features/planning/actions";
import { runResearch } from "@/features/research/actions";
import { runQualityReview } from "@/features/review/actions";
import { runDraft } from "@/features/writing/actions";
import { pipelineStepInputSchema } from "@/validation/pipeline";

const ALREADY_DONE: ActionResult = { success: true, message: "Already done." };

/// Runs ONE stage of the post pipeline for a trend. The browser calls this
/// once per stage (see components/trends/pipeline-runner.tsx) so each stage
/// is its own short request — a single call doing all five could exceed the
/// serverless time limit. Each stage looks up the previous stage's row id
/// itself and delegates to the existing stage action, so the retry-in-place
/// and audit-row behaviour is unchanged. A stage that already COMPLETED is
/// skipped, which makes "retry" resume from the step that failed instead of
/// redoing (and re-billing) the earlier ones.
export async function runPipelineStep(input: unknown): Promise<ActionResult> {
  const profileId = await requireProfileId();

  const parsed = pipelineStepInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Invalid pipeline step." };
  }
  const { trendId, step } = parsed.data;

  if (step === "research") {
    const trend = await prisma.trend.findUnique({
      where: { id: trendId },
      include: { researchBrief: true },
    });
    if (!trend) return { error: "Trend not found." };
    if (trend.researchBrief?.status === "COMPLETED") return ALREADY_DONE;

    // Starting the pipeline is the user's decision to use this trend, and
    // runResearch only accepts REVIEWED ones.
    if (trend.status !== "REVIEWED") {
      await prisma.trend.update({
        where: { id: trendId },
        data: { status: "REVIEWED" },
      });
    }
    return runResearch(trendId);
  }

  const research = await prisma.researchBrief.findUnique({
    where: { trendId },
  });
  if (!research) return { error: "Research has not been run for this trend." };

  const plan = await prisma.contentPlan.findUnique({
    where: { researchId_profileId: { researchId: research.id, profileId } },
  });

  if (step === "plan") {
    if (plan?.status === "COMPLETED") return ALREADY_DONE;
    return runContentPlan(research.id);
  }
  if (!plan) return { error: "The content plan has not been created yet." };

  const draft = await prisma.draft.findUnique({ where: { planId: plan.id } });

  if (step === "write") {
    if (draft?.status === "COMPLETED") return ALREADY_DONE;
    return runDraft(plan.id);
  }
  if (!draft) return { error: "The draft has not been written yet." };

  if (step === "review") {
    const review = await prisma.qualityReview.findUnique({
      where: { draftId: draft.id },
    });
    if (review?.status === "COMPLETED") return ALREADY_DONE;
    return runQualityReview(draft.id);
  }

  const image = await prisma.imageAsset.findUnique({
    where: { draftId: draft.id },
  });
  if (image?.status === "COMPLETED") return ALREADY_DONE;
  return runImageGeneration(draft.id);
}
