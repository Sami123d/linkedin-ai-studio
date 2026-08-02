import { NextResponse } from "next/server";

import { serverEnv } from "@/config/env.server";
import { prisma } from "@/db/prisma";
import { checkWebhookSecret } from "@/lib/webhook-auth";

/// A claim older than this is treated as stale and reclaimable — covers an
/// n8n run that crashed mid-publish without ever POSTing back to
/// /api/scheduler/publish, so the post doesn't get stuck unpublishable
/// forever.
const CLAIM_TIMEOUT_MINUTES = 15;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

type ClaimedRow = { id: string };

export async function GET(request: Request) {
  if (!checkWebhookSecret(request, serverEnv.SCHEDULER_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const requestedLimit = Number(url.searchParams.get("limit"));
  const limit =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(Math.floor(requestedLimit), MAX_LIMIT)
      : DEFAULT_LIMIT;

  // Single atomic UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP
  // LOCKED) — claims rows for this poll so a second, overlapping poll
  // (e.g. two n8n runs) can't hand the same post to LinkedIn twice.
  const claimed = await prisma.$queryRaw<ClaimedRow[]>`
    UPDATE scheduled_posts
    SET publishing_started_at = now(), publish_attempts = publish_attempts + 1
    WHERE id IN (
      SELECT id FROM scheduled_posts
      WHERE approval_status = 'APPROVED'
        AND scheduled_for <= now()
        AND published_at IS NULL
        AND (
          publishing_started_at IS NULL
          OR publishing_started_at < now() - make_interval(mins => ${CLAIM_TIMEOUT_MINUTES})
        )
      ORDER BY scheduled_for ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `;

  if (claimed.length === 0) {
    return NextResponse.json({ posts: [] });
  }

  const posts = await prisma.scheduledPost.findMany({
    where: { id: { in: claimed.map((c) => c.id) } },
    include: {
      draft: {
        include: {
          contentPlan: { include: { research: { include: { trend: true } } } },
          imageAsset: true,
        },
      },
    },
  });

  return NextResponse.json({
    posts: posts.map((post) => ({
      scheduledPostId: post.id,
      topic: post.draft.contentPlan.research.trend.topic,
      format: post.draft.contentPlan.format,
      content: post.draft.content,
      slides: post.draft.slides,
      hashtags: post.draft.hashtags,
      imageUrl:
        post.draft.imageAsset?.status === "COMPLETED"
          ? post.draft.imageAsset.url
          : null,
      scheduledFor: post.scheduledFor,
    })),
  });
}
