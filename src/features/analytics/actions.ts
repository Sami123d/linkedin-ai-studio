"use server";

import { prisma } from "@/db/prisma";
import { requireProfileId } from "@/features/knowledge-base/session";

/// Published posts belonging to the current user, with every analytics
/// snapshot captured for each so far (newest first). Ownership flows
/// ScheduledPost -> Draft -> ContentPlan -> profileId.
export async function listAnalytics() {
  const profileId = await requireProfileId();

  return prisma.scheduledPost.findMany({
    where: {
      publishedAt: { not: null },
      draft: { contentPlan: { profileId } },
    },
    include: {
      draft: {
        include: {
          contentPlan: { include: { research: { include: { trend: true } } } },
        },
      },
      analyticsSnapshots: { orderBy: { capturedAt: "desc" } },
    },
    orderBy: { publishedAt: "desc" },
  });
}
