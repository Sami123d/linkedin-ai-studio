import { NextResponse } from "next/server";

import { serverEnv } from "@/config/env.server";
import { prisma } from "@/db/prisma";
import { checkWebhookSecret } from "@/lib/webhook-auth";

/// Tells n8n's analytics workflow which published posts exist so it knows
/// what to check on LinkedIn. Unbounded by time on purpose — engagement
/// keeps changing long after publish, so there's no "too old to check"
/// cutoff here; n8n's own schedule/backoff decides how often to re-poll
/// an older post.
export async function GET(request: Request) {
  if (!checkWebhookSecret(request, serverEnv.ANALYTICS_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const posts = await prisma.scheduledPost.findMany({
    where: { publishedAt: { not: null }, publishedUrl: { not: null } },
    select: {
      id: true,
      publishedUrl: true,
      publishedAt: true,
      draft: {
        select: {
          contentPlan: {
            select: { research: { select: { trend: { select: { topic: true } } } } },
          },
        },
      },
    },
    orderBy: { publishedAt: "desc" },
  });

  return NextResponse.json({
    posts: posts.map((post) => ({
      scheduledPostId: post.id,
      publishedUrl: post.publishedUrl,
      publishedAt: post.publishedAt,
      topic: post.draft.contentPlan.research.trend.topic,
    })),
  });
}
