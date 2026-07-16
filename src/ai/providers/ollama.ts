import "server-only";

import { serverEnv } from "@/config/env.server";

import type { AIGenerateParams, AIGenerateResult, AIProvider } from "./types";

/// Scaffold only — not wired up to a real Ollama call yet. Its purpose is
/// to prove the AIProvider interface is actually provider-agnostic: when
/// local execution becomes a real requirement, this is the only file that
/// needs a real implementation (a POST to `${OLLAMA_BASE_URL}/api/generate`)
/// — no business logic changes.
export class OllamaProvider implements AIProvider {
  readonly name = "ollama";

  async generate(params: AIGenerateParams): Promise<AIGenerateResult> {
    throw new Error(
      `Ollama provider is a scaffold, not yet implemented (received a ${params.prompt.length}-character prompt). Configured endpoint: ${serverEnv.OLLAMA_BASE_URL}, model: ${serverEnv.OLLAMA_MODEL}. Set AI_PROVIDER=gemini until this is built out.`,
    );
  }
}
