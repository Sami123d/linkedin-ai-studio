import { NextResponse } from "next/server";

import { serverEnv } from "@/config/env.server";
import { prisma } from "@/db/prisma";
import { checkWebhookSecret } from "@/lib/webhook-auth";
import { publishCallbackSchema } from "@/validation/scheduler";

export async function POST(request: Request) {
  if (!checkWebhookSecret(request, serverEnv.SCHEDULER_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (body === null) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = publishCallbackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid payload" },
      { status: 400 },
    );
  }

  const { scheduledPostId, success, publishedUrl, error } = parsed.data;

  // On failure, clear publishing_started_at so the next GET /due poll can
  // reclaim it immediately rather than waiting out the stale-claim
  // timeout — a reported failure means n8n is done trying, not stuck.
  const { count } = await prisma.scheduledPost.updateMany({
    where: { id: scheduledPostId },
    data: success
      ? {
          publishedAt: new Date(),
          publishedUrl: publishedUrl ?? null,
          publishError: null,
        }
      : {
          publishingStartedAt: null,
          publishError: error ?? "Publish failed (no error detail provided).",
        },
  });

  if (count === 0) {
    return NextResponse.json(
      { error: "Scheduled post not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true });
}
