"use server";

import { prisma } from "@/db/prisma";
import { requireProfileId } from "@/features/knowledge-base/session";

/// Approved, scheduled posts belonging to the current user. Ownership
/// flows ScheduledPost -> Draft -> ContentPlan -> profileId.
export async function listScheduledPosts() {
  const profileId = await requireProfileId();

  return prisma.scheduledPost.findMany({
    where: {
      approvalStatus: "APPROVED",
      scheduledFor: { not: null },
      draft: { contentPlan: { profileId } },
    },
    include: {
      draft: {
        include: {
          contentPlan: { include: { research: { include: { trend: true } } } },
        },
      },
    },
    orderBy: { scheduledFor: "asc" },
  });
}

/// Approved Facebook/Instagram variants with a planned date. These are NOT
/// handled by the scheduler/publisher — the calendar shows them as planned
/// entries only. Ownership: variant.profileId plus Draft -> ContentPlan.
export async function listPlannedVariants() {
  const profileId = await requireProfileId();

  return prisma.platformVariant.findMany({
    where: {
      profileId,
      approvalStatus: "APPROVED",
      scheduledFor: { not: null },
      draft: { contentPlan: { profileId } },
    },
    include: {
      draft: {
        include: {
          contentPlan: { include: { research: { include: { trend: true } } } },
        },
      },
    },
    orderBy: { scheduledFor: "asc" },
  });
}
