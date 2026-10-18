import "server-only";
import { z } from "zod";

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value ? value : undefined));

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
  /// Tried when GEMINI_MODEL is overloaded or rate limited (503/429), which
  /// happens often on the free tier. Set it to an empty string to disable.
  GEMINI_FALLBACK_MODEL: z.string().default("gemini-flash-lite-latest"),
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
  /// real default for now. "pollinations" generates free AI images.
  IMAGE_PROVIDER: z
    .enum(["unsplash", "gemini", "pollinations"])
    .default("unsplash"),
  UNSPLASH_ACCESS_KEY: z
    .string()
    .optional()
    .transform((value) => (value ? value : undefined)),
  /// Optional: without it Pollinations falls back to its legacy anonymous
  /// endpoint (rate limited, watermarked, fixed model). With it, images come
  /// from gen.pollinations.ai and are re-hosted on media.pollinations.ai.
  POLLINATIONS_API_KEY: z
    .string()
    .optional()
    .transform((value) => (value ? value : undefined)),
  /// Only applies with an API key. The cheapest model not marked paid-only.
  POLLINATIONS_MODEL: z.string().default("tongyi-mai/z-image-turbo"),
  /// Shared secret n8n's Schedule Trigger workflow sends on every call to
  /// GET /api/scheduler/due and POST /api/scheduler/publish — same
  /// reasoning as TREND_WEBHOOK_SECRET (these endpoints are unauthenticated
  /// by session). A separate secret from the trends one since it's a
  /// different consumer/purpose, not because the security model differs.
  SCHEDULER_WEBHOOK_SECRET: z.string().min(16),
  /// Shared secret n8n's analytics workflow sends as the `x-webhook-secret`
  /// header on both GET /api/analytics/published-posts and POST
  /// /api/webhooks/analytics. Separate secret from the trend/scheduler ones
  /// (different consumer/purpose), same reasoning throughout this file.
  ANALYTICS_WEBHOOK_SECRET: z.string().min(16),
  /// Meta (Facebook/Instagram) publishing. All optional so the app still
  /// boots without them: the /platforms page then shows setup instructions
  /// instead of a Connect button. Blank strings count as "not set".
  META_APP_ID: optionalString,
  META_APP_SECRET: optionalString,
  /// Pinned Graph API version. v25.0 is the version Meta's current Pages and
  /// Instagram publishing docs use; v26.0 exists but is newer than what the
  /// docs show. Override only after re-checking the changelog.
  META_GRAPH_API_VERSION: z
    .string()
    .optional()
    .transform((value) => (value ? value : "v25.0"))
    .pipe(z.string().regex(/^v\d+\.\d+$/)),
  /// 32 random bytes, hex (64 chars) or base64. Encrypts stored Meta tokens
  /// (AES-256-GCM) and signs the OAuth state. Losing or changing it makes
  /// stored tokens unreadable, so users must reconnect.
  TOKEN_ENCRYPTION_KEY: optionalString,
  /// Secret for POST /api/scheduler/meta-publish (separate consumer, so a
  /// separate secret, like the other webhook secrets).
  META_PUBLISH_WEBHOOK_SECRET: optionalString,
  /// Optional. Lets jobs without a user session (the Meta scheduler, trend
  /// housekeeping) delete prepared images in the `publish-media` bucket.
  /// Used ONLY by src/lib/supabase/admin.ts for that bucket; never sent to
  /// the browser. Without it, cleanup happens when the owner opens
  /// /platforms.
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  /// Optional. Brave Search News API key for Research Studio source discovery
  /// (broad news coverage). Without it, discovery uses the keyless official
  /// APIs only (Hacker News Search, DEV) plus already-collected trends.
  BRAVE_SEARCH_API_KEY: optionalString,
});

export const serverEnv = schema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  DIRECT_URL: process.env.DIRECT_URL,
  TREND_WEBHOOK_SECRET: process.env.TREND_WEBHOOK_SECRET,
  AI_PROVIDER: process.env.AI_PROVIDER,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  GEMINI_FALLBACK_MODEL: process.env.GEMINI_FALLBACK_MODEL,
  GEMINI_EMBEDDING_MODEL: process.env.GEMINI_EMBEDDING_MODEL,
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
  OLLAMA_MODEL: process.env.OLLAMA_MODEL,
  IMAGE_PROVIDER: process.env.IMAGE_PROVIDER,
  UNSPLASH_ACCESS_KEY: process.env.UNSPLASH_ACCESS_KEY,
  POLLINATIONS_API_KEY: process.env.POLLINATIONS_API_KEY,
  POLLINATIONS_MODEL: process.env.POLLINATIONS_MODEL,
  SCHEDULER_WEBHOOK_SECRET: process.env.SCHEDULER_WEBHOOK_SECRET,
  ANALYTICS_WEBHOOK_SECRET: process.env.ANALYTICS_WEBHOOK_SECRET,
  META_APP_ID: process.env.META_APP_ID,
  META_APP_SECRET: process.env.META_APP_SECRET,
  META_GRAPH_API_VERSION: process.env.META_GRAPH_API_VERSION,
  TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY,
  META_PUBLISH_WEBHOOK_SECRET: process.env.META_PUBLISH_WEBHOOK_SECRET,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  BRAVE_SEARCH_API_KEY: process.env.BRAVE_SEARCH_API_KEY,
});
