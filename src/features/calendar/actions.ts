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
