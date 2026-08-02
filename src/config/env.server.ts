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
  /// Fixed at 768 dimensions to match the `vector(768)` column on
  /// KnowledgeChunk (see the Milestone 7 migration) — changing this model
  /// to one with a different native dimensionality requires a schema
  /// migration, not just an env change.
  GEMINI_EMBEDDING_MODEL: z.string().default("gemini-embedding-001"),
  OLLAMA_BASE_URL: z.url().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().default("llama3.1"),
  /// Which ImageProvider implementation src/ai/providers/image/index.ts
  /// hands back. "gemini" is a billing-gated scaffold (verified live: the
  /// free tier for Gemini's image models is 0 — see gemini-image.ts) until
  /// the user enables billing; "unsplash" (search, not generation) is the
  /// real default for now.
  IMAGE_PROVIDER: z.enum(["unsplash", "gemini"]).default("unsplash"),
  UNSPLASH_ACCESS_KEY: z
    .string()
    .optional()
    .transform((value) => (value ? value : undefined)),
  /// Shared secret n8n's Schedule Trigger workflow sends on every call to
  /// GET /api/scheduler/due and POST /api/scheduler/publish — same
  /// reasoning as TREND_WEBHOOK_SECRET (these endpoints are unauthenticated
  /// by session). A separate secret from the trends one since it's a
  /// different consumer/purpose, not because the security model differs.
  SCHEDULER_WEBHOOK_SECRET: z.string().min(16),
});

export const serverEnv = schema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  DIRECT_URL: process.env.DIRECT_URL,
  TREND_WEBHOOK_SECRET: process.env.TREND_WEBHOOK_SECRET,
  AI_PROVIDER: process.env.AI_PROVIDER,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  GEMINI_EMBEDDING_MODEL: process.env.GEMINI_EMBEDDING_MODEL,
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
  OLLAMA_MODEL: process.env.OLLAMA_MODEL,
  IMAGE_PROVIDER: process.env.IMAGE_PROVIDER,
  UNSPLASH_ACCESS_KEY: process.env.UNSPLASH_ACCESS_KEY,
  SCHEDULER_WEBHOOK_SECRET: process.env.SCHEDULER_WEBHOOK_SECRET,
});
