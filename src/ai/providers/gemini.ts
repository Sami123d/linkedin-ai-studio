import "server-only";

import { GoogleGenAI } from "@google/genai";

import { serverEnv } from "@/config/env.server";

import type { AIGenerateParams, AIGenerateResult, AIProvider } from "./types";

const RETRY_DELAY_MS = 2_000;

/// 503 (model overloaded), 429 (rate limited) and 500 are worth another try
/// on the same or a lighter model; anything else (bad key, bad request) isn't.
export function isTransientGeminiError(error: unknown): boolean {
  const status = (error as { status?: unknown })?.status;
  if (status === 503 || status === 429 || status === 500) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /\b(503|429|500)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand/i.test(
    message,
  );
}

export class GeminiProvider implements AIProvider {
  readonly name = "gemini";
  private readonly client: GoogleGenAI;
  private readonly models: string[];

  constructor() {
    if (!serverEnv.GEMINI_API_KEY) {
      throw new Error(
        "GEMINI_API_KEY is not set. Add it to .env to use AI_PROVIDER=gemini.",
      );
    }
    this.client = new GoogleGenAI({ apiKey: serverEnv.GEMINI_API_KEY });
    this.models = [
      serverEnv.GEMINI_MODEL,
      serverEnv.GEMINI_FALLBACK_MODEL,
    ].filter(
      (model, i, all): model is string => !!model && all.indexOf(model) === i,
    );
  }

  /// Tries the primary model twice, then the fallback model twice, but only
  /// for transient errors (free-tier 503 "high demand" / 429).
  async generate(params: AIGenerateParams): Promise<AIGenerateResult> {
    let lastError: unknown;
    for (const model of this.models) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          return await this.generateWith(model, params);
        } catch (error) {
          lastError = error;
          if (!isTransientGeminiError(error)) throw error;
          if (attempt < 2)
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        }
      }
    }
    throw lastError;
  }

  private async generateWith(
    model: string,
    params: AIGenerateParams,
  ): Promise<AIGenerateResult> {
    const response = await this.client.models.generateContent({
      model,
      contents: params.prompt,
      config: {
        systemInstruction: params.systemPrompt,
        ...(params.json ? { responseMimeType: "application/json" } : {}),
      },
    });

    const text = response.text;
    if (text === undefined) {
      throw new Error("Gemini returned no text content.");
    }

    return {
      text,
      model,
      usage: {
        promptTokens: response.usageMetadata?.promptTokenCount,
        completionTokens: response.usageMetadata?.candidatesTokenCount,
        totalTokens: response.usageMetadata?.totalTokenCount,
      },
    };
  }
}
