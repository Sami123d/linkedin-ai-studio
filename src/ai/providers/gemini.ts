import "server-only";

import { GoogleGenAI } from "@google/genai";

import { serverEnv } from "@/config/env.server";

import type { AIGenerateParams, AIGenerateResult, AIProvider } from "./types";

export class GeminiProvider implements AIProvider {
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
    this.model = serverEnv.GEMINI_MODEL;
  }

  async generate(params: AIGenerateParams): Promise<AIGenerateResult> {
    const response = await this.client.models.generateContent({
      model: this.model,
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
      model: this.model,
      usage: {
        promptTokens: response.usageMetadata?.promptTokenCount,
        completionTokens: response.usageMetadata?.candidatesTokenCount,
        totalTokens: response.usageMetadata?.totalTokenCount,
      },
    };
  }
}
