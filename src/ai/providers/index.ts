import "server-only";

import { serverEnv } from "@/config/env.server";

import type { AIEmbeddingProvider } from "./embedding-types";
import { GeminiEmbeddingProvider } from "./gemini-embedding";
import { GeminiImageProvider } from "./gemini-image";
import { GeminiProvider } from "./gemini";
import type { ImageProvider } from "./image-types";
import { OllamaEmbeddingProvider } from "./ollama-embedding";
import { OllamaProvider } from "./ollama";
import { PollinationsImageProvider } from "./pollinations";
import type { AIProvider } from "./types";
import { UnsplashImageProvider } from "./unsplash";

export type { AIGenerateParams, AIGenerateResult, AIProvider, AIUsage } from "./types";
export type { AIEmbeddingProvider, AIEmbeddingResult } from "./embedding-types";
export type { ImageProvider, ImageResult } from "./image-types";

let cached: AIProvider | undefined;
let cachedEmbedding: AIEmbeddingProvider | undefined;
let cachedImage: ImageProvider | undefined;

/// The only place AI_PROVIDER is read. Everything downstream (the research
/// generation service, and every future agent) takes an AIProvider as a
/// parameter/dependency rather than calling this directly, so swapping
/// providers — or injecting a fake one — never touches business logic.
export function getAIProvider(): AIProvider {
  if (cached) return cached;

  switch (serverEnv.AI_PROVIDER) {
    case "gemini":
      cached = new GeminiProvider();
      return cached;
    case "ollama":
      cached = new OllamaProvider();
      return cached;
  }
}

/// Same AI_PROVIDER switch as getAIProvider() — one env var picks both the
/// text-generation and embedding implementation for a given provider,
/// since in practice you'd run one AI backend, not mix and match.
export function getAIEmbeddingProvider(): AIEmbeddingProvider {
  if (cachedEmbedding) return cachedEmbedding;

  switch (serverEnv.AI_PROVIDER) {
    case "gemini":
      cachedEmbedding = new GeminiEmbeddingProvider();
      return cachedEmbedding;
    case "ollama":
      cachedEmbedding = new OllamaEmbeddingProvider();
      return cachedEmbedding;
  }
}

/// Separate env var (IMAGE_PROVIDER, not AI_PROVIDER) — unlike text/
/// embedding, you might genuinely want Gemini for writing but Unsplash for
/// images (e.g. no billing enabled yet), so these aren't coupled to the
/// same backend choice.
export function getImageProvider(): ImageProvider {
  if (cachedImage) return cachedImage;

  switch (serverEnv.IMAGE_PROVIDER) {
    case "unsplash":
      cachedImage = new UnsplashImageProvider();
      return cachedImage;
    case "gemini":
      cachedImage = new GeminiImageProvider();
      return cachedImage;
    case "pollinations":
      cachedImage = new PollinationsImageProvider();
      return cachedImage;
  }
}
