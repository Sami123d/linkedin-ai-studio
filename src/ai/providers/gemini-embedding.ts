import "server-only";

import { GoogleGenAI } from "@google/genai";

import { serverEnv } from "@/config/env.server";

import type { AIEmbeddingProvider, AIEmbeddingResult } from "./embedding-types";

const EMBEDDING_DIMENSIONS = 768;

export class GeminiEmbeddingProvider implements AIEmbeddingProvider {
  readonly name = "gemini";
  private readonly client: GoogleGenAI;
  private readonly model: string;

  constructor() {
    if (!serverEnv.GEMINI_API_KEY) {
      throw new Error(
        "GEMINI_API_KEY is not set. Add it to .env to use AI_PROVIDER=gemini.",
      );
    }
    this.client = new GoogleGenAI({ apiKey: serverEnv.GEMINI_API_KEY });
    this.model = serverEnv.GEMINI_EMBEDDING_MODEL;
  }

  async embed(text: string): Promise<AIEmbeddingResult> {
    const response = await this.client.models.embedContent({
      model: this.model,
      contents: text,
      config: { outputDimensionality: EMBEDDING_DIMENSIONS },
    });

    const values = response.embeddings?.[0]?.values;
    if (!values) {
      throw new Error("Gemini returned no embedding values.");
    }

    return { embedding: values, model: this.model };
  }
}
