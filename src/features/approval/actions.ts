"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/db/prisma";
import { requireProfileId } from "@/features/knowledge-base/session";
import type { ActionResult } from "@/features/knowledge-base/types";

/// Completed drafts belonging to the current user, with everything a human
/// needs to decide: the draft content, its quality review, its image (if
/// ready), and any existing approval decision. Ownership flows Draft ->
/// ContentPlan -> profileId.
export async function listApprovalQueue() {
  const profileId = await requireProfileId();

  return prisma.draft.findMany({
    where: { status: "COMPLETED", contentPlan: { profileId } },
    include: {
      contentPlan: { include: { research: { include: { trend: true } } } },
      qualityReview: true,
      imageAsset: true,
      scheduledPost: true,
    },
    orderBy: { completedAt: "desc" },
  });
}

async function assertOwnsDraft(draftId: string, profileId: string) {
  const draft = await prisma.draft.findUnique({
    where: { id: draftId },
    include: { contentPlan: true },
  });
  if (!draft || draft.contentPlan.profileId !== profileId) {
    return null;
  }
  return draft;
}

export async function approveDraft(
  draftId: string,
  scheduledFor: string,
): Promise<ActionResult> {
  const profileId = await requireProfileId();

  const draft = await assertOwnsDraft(draftId, profileId);
  if (!draft) {
    return { error: "Draft not found." };
  }
  if (draft.status !== "COMPLETED") {
    return { error: "Only completed drafts can be approved." };
  }

  const date = new Date(scheduledFor);
  if (Number.isNaN(date.getTime())) {
    return { error: "Pick a valid date and time." };
  }
  if (date.getTime() < Date.now()) {
    return { error: "Scheduled time must be in the future." };
  }

  await prisma.scheduledPost.upsert({
    where: { draftId },
    create: {
      draftId,
      approvalStatus: "APPROVED",
      scheduledFor: date,
      approvedAt: new Date(),
    },
    update: {
      approvalStatus: "APPROVED",
      scheduledFor: date,
      approvedAt: new Date(),
      rejectionReason: null,
    },
  });

  revalidatePath("/approval");
  revalidatePath("/calendar");
  return { success: true, message: "Approved and scheduled." };
}

export async function rejectDraft(
  draftId: string,
  reason: string,
): Promise<ActionResult> {
  const profileId = await requireProfileId();

  const draft = await assertOwnsDraft(draftId, profileId);
  if (!draft) {
    return { error: "Draft not found." };
  }

  await prisma.scheduledPost.upsert({
    where: { draftId },
    create: {
      draftId,
      approvalStatus: "REJECTED",
      rejectionReason: reason || null,
    },
    update: {
      approvalStatus: "REJECTED",
      rejectionReason: reason || null,
      scheduledFor: null,
      approvedAt: null,
    },
  });

  revalidatePath("/approval");
  revalidatePath("/calendar");
  return { success: true, message: "Rejected." };
}
