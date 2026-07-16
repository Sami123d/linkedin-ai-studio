import "server-only";

import { serverEnv } from "@/config/env.server";

import { GeminiProvider } from "./gemini";
import { OllamaProvider } from "./ollama";
import type { AIProvider } from "./types";

export type { AIGenerateParams, AIGenerateResult, AIProvider, AIUsage } from "./types";

let cached: AIProvider | undefined;

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
