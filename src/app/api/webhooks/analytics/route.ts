import { NextResponse } from "next/server";

import { serverEnv } from "@/config/env.server";
import { prisma } from "@/db/prisma";
import { checkWebhookSecret } from "@/lib/webhook-auth";
import { analyticsWebhookBodySchema } from "@/validation/analytics";

export async function POST(request: Request) {
  if (!checkWebhookSecret(request, serverEnv.ANALYTICS_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (body === null) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = analyticsWebhookBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid payload" },
      { status: 400 },
    );
  }

  const items = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  if (items.length === 0) {
    return NextResponse.json({ inserted: 0 });
  }

  // Validate every referenced post belongs to this app before inserting —
  // createMany would otherwise happily insert a snapshot referencing a
  // scheduledPostId that turns out to violate the FK, failing the whole
  // batch instead of reporting which id was bad.
  const validIds = new Set(
    (
      await prisma.scheduledPost.findMany({
        where: { id: { in: items.map((i) => i.scheduledPostId) } },
        select: { id: true },
      })
    ).map((p) => p.id),
  );

  const validItems = items.filter((item) => validIds.has(item.scheduledPostId));
  const unknownIds = items
    .map((i) => i.scheduledPostId)
    .filter((id) => !validIds.has(id));

  if (validItems.length === 0) {
    return NextResponse.json(
      { error: `No matching scheduled posts for: ${unknownIds.join(", ")}` },
      { status: 400 },
    );
  }

  const { count } = await prisma.analyticsSnapshot.createMany({
    data: validItems.map((item) => ({
      scheduledPostId: item.scheduledPostId,
      capturedAt: item.capturedAt,
      impressions: item.impressions,
      likes: item.likes,
      comments: item.comments,
      shares: item.shares,
      clicks: item.clicks,
    })),
  });

  return NextResponse.json(
    { inserted: count, skipped: unknownIds },
    { status: 201 },
  );
}
