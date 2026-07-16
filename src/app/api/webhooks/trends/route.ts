import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { serverEnv } from "@/config/env.server";
import { prisma } from "@/db/prisma";
import { trendWebhookBodySchema } from "@/validation/trends";

/// Constant-time secret comparison — a naive `===` leaks timing
/// information proportional to how many leading characters match, which
/// is exactly the kind of oracle an unauthenticated public endpoint like
/// this one shouldn't offer.
function secretsMatch(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

export async function POST(request: Request) {
  const providedSecret = request.headers.get("x-webhook-secret") ?? "";
  if (!secretsMatch(providedSecret, serverEnv.TREND_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (body === null) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = trendWebhookBodySchema.safeParse(body);
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

  const { count } = await prisma.trend.createMany({
    data: items.map((item) => ({
      topic: item.topic,
      summary: item.summary,
      sourceName: item.sourceName,
      sourceUrl: item.sourceUrl || undefined,
      score: item.score,
      publishedAt: item.publishedAt,
    })),
  });

  return NextResponse.json({ inserted: count }, { status: 201 });
}
