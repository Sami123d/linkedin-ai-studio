import "server-only";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.url(),
  DIRECT_URL: z.url(),
  /// Shared secret the n8n workflow must send back on every trend webhook
  /// call (see src/app/api/webhooks/trends/route.ts) — this endpoint is
  /// unauthenticated by session, so this secret is the only thing standing
  /// between it and anyone who finds the URL.
  TREND_WEBHOOK_SECRET: z.string().min(16),
});

export const serverEnv = schema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  DIRECT_URL: process.env.DIRECT_URL,
  TREND_WEBHOOK_SECRET: process.env.TREND_WEBHOOK_SECRET,
});
