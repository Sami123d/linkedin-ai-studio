import "server-only";

import { serverEnv } from "@/config/env.server";

import type { AIEmbeddingProvider, AIEmbeddingResult } from "./embedding-types";

/// Scaffold only, same reasoning as OllamaProvider (src/ai/providers/ollama.ts):
/// proves AIEmbeddingProvider is genuinely provider-agnostic. A real
/// implementation would POST to `${OLLAMA_BASE_URL}/api/embeddings` — but
/// note it would ALSO need a schema migration unless the local model
/// happens to produce 768-dimension vectors, since KnowledgeChunk.embedding
/// is fixed at vector(768) (see GEMINI_EMBEDDING_MODEL in env.server.ts).
export class OllamaEmbeddingProvider implements AIEmbeddingProvider {
  readonly name = "ollama";

  async embed(text: string): Promise<AIEmbeddingResult> {
    throw new Error(
      `Ollama embedding provider is a scaffold, not yet implemented (received a ${text.length}-character input). Configured endpoint: ${serverEnv.OLLAMA_BASE_URL}. Set AI_PROVIDER=gemini until this is built out.`,
    );
  }
}
