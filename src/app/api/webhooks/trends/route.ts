import { NextResponse } from "next/server";

import { serverEnv } from "@/config/env.server";
import { prisma } from "@/db/prisma";
import { checkWebhookSecret } from "@/lib/webhook-auth";
import { trendWebhookBodySchema } from "@/validation/trends";

export async function POST(request: Request) {
  if (!checkWebhookSecret(request, serverEnv.TREND_WEBHOOK_SECRET)) {
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
      category: item.category,
      score: item.score,
      publishedAt: item.publishedAt,
    })),
  });

  return NextResponse.json({ inserted: count }, { status: 201 });
}
