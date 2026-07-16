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
  /// Which AIProvider implementation src/ai/providers/index.ts hands back.
  /// Business logic (the Research Agent, and every agent after it) only
  /// ever depends on the AIProvider interface, never on this value or on
  /// Gemini/Ollama specifics directly.
  AI_PROVIDER: z.enum(["gemini", "ollama"]).default("gemini"),
  /// `.env` ships this blank for a fresh checkout (filled in per-developer),
  /// so an empty string is a valid "not configured" state, not a schema
  /// violation — normalize it to `undefined` rather than reject it.
  GEMINI_API_KEY: z
    .string()
    .optional()
    .transform((value) => (value ? value : undefined)),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  OLLAMA_BASE_URL: z.url().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().default("llama3.1"),
});

export const serverEnv = schema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  DIRECT_URL: process.env.DIRECT_URL,
  TREND_WEBHOOK_SECRET: process.env.TREND_WEBHOOK_SECRET,
  AI_PROVIDER: process.env.AI_PROVIDER,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
  OLLAMA_MODEL: process.env.OLLAMA_MODEL,
});
