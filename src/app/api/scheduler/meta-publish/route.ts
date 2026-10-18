import { NextResponse } from "next/server";

import { serverEnv } from "@/config/env.server";
import { prisma } from "@/db/prisma";
import { runBackgroundMediaCleanup } from "@/features/platforms/media-cleanup";
import {
  executePublish,
  sweepStalePublishing,
} from "@/features/platforms/publish";
import { MAX_AUTOMATIC_ATTEMPTS } from "@/features/platforms/publish-state";
import { checkWebhookSecret } from "@/lib/webhook-auth";
import { metaPublishRequestSchema } from "@/validation/scheduler";

export const maxDuration = 60;

/// Unlike the LinkedIn flow (the external job publishes and reports back),
/// Meta tokens stay encrypted inside this app, so this endpoint claims the
/// due variants AND publishes them itself, then returns a per-variant
/// summary. The scheduled job (scripts/meta-publisher.ts) only triggers it.
///
/// Only NOT_PUBLISHED variants are picked up. FAILED ones wait for a human
/// (retry from /platforms) and UNCONFIRMED ones wait for "Check status", so
/// a timeout can never lead to an automatic duplicate post.
/// The function may run for 60s (maxDuration). Stop starting new variants
/// early enough that one already in flight can finish, and cap how long an
/// Instagram container is polled; a still-processing container is resumed by
/// the next run.
const TIME_BUDGET_MS = 20_000;
const INSTAGRAM_MAX_WAIT_MS = 10_000;

type ClaimedRow = { id: string; profile_id: string };

export async function POST(request: Request) {
  const secret = serverEnv.META_PUBLISH_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Meta publishing is not configured" },
      { status: 503 },
    );
  }
  if (!checkWebhookSecret(request, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let raw: unknown = {};
  const text = await request.text();
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
  }
  const parsed = metaPublishRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { limit } = parsed.data;

  await sweepStalePublishing();

  // One atomic UPDATE ... FOR UPDATE SKIP LOCKED claim, so overlapping
  // scheduler runs (or a Publish now click) can not take the same variant.
  const claimed = await prisma.$queryRaw<ClaimedRow[]>`
    UPDATE platform_variants
    SET publish_status = 'PUBLISHING',
        publishing_started_at = now(),
        publish_attempts = publish_attempts + 1,
        publish_error = NULL
    WHERE id IN (
      SELECT id FROM platform_variants
      WHERE approval_status = 'APPROVED'
        AND status = 'COMPLETED'
        AND scheduled_for <= now()
        AND publish_status = 'NOT_PUBLISHED'
        AND publish_attempts < ${MAX_AUTOMATIC_ATTEMPTS}
      ORDER BY scheduled_for ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, profile_id
  `;

  const startedAt = Date.now();
  const results: { variantId: string; outcome: string; message?: string }[] =
    [];

  for (const row of claimed) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      // Out of time: give the claim back untouched for the next run.
      await prisma.platformVariant.updateMany({
        where: { id: row.id, publishStatus: "PUBLISHING" },
        data: {
          publishStatus: "NOT_PUBLISHED",
          publishingStartedAt: null,
          publishAttempts: { decrement: 1 },
        },
      });
      results.push({ variantId: row.id, outcome: "deferred" });
      continue;
    }

    try {
      const summary = await executePublish(row.id, row.profile_id, {
        instagramMaxWaitMs: INSTAGRAM_MAX_WAIT_MS,
      });
      results.push({
        variantId: row.id,
        outcome: summary.outcome,
        ...("message" in summary ? { message: summary.message } : {}),
      });
    } catch {
      // The outcome could not be recorded (for example a database error after
      // the platform call). The variant stays PUBLISHING and the stale sweep
      // turns it into UNCONFIRMED; it is never retried automatically.
      results.push({
        variantId: row.id,
        outcome: "unconfirmed",
        message: "The result could not be recorded; check the platform.",
      });
    }
  }

  // Retry media cleanup that failed earlier and remove orphaned files
  // (service-role key only; never throws, never affects the results above).
  await runBackgroundMediaCleanup();

  return NextResponse.json({ claimed: claimed.length, results });
}
