import "server-only";

import type { z } from "zod";

import type { AIGenerateResult, AIProvider } from "@/ai/providers";

export class StructuredGenerationError extends Error {
  constructor(
    message: string,
    readonly raw: AIGenerateResult,
  ) {
    super(message);
    this.name = "StructuredGenerationError";
  }
}

/// The one place JSON-mode prompting + response parsing lives, so every
/// agent (Research now, Planning/Writing/Review later) gets structured
/// output the same way regardless of which AIProvider is active. Providers
/// only need to implement "generate text from a prompt" (see
/// src/ai/providers/types.ts) — schema enforcement happens here, not in
/// the provider, because not every provider (e.g. a local Ollama model) can
/// guarantee schema-conformant JSON the way Gemini's native JSON mode can.
export async function generateStructured<T>({
  provider,
  systemPrompt,
  prompt,
  schema,
}: {
  provider: AIProvider;
  systemPrompt?: string;
  prompt: string;
  schema: z.ZodType<T>;
}): Promise<{ data: T; raw: AIGenerateResult }> {
  const raw = await provider.generate({ systemPrompt, prompt, json: true });

  let json: unknown;
  try {
    json = JSON.parse(raw.text);
  } catch {
    throw new StructuredGenerationError(
      `${provider.name} response was not valid JSON.`,
      raw,
    );
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new StructuredGenerationError(
      `${provider.name} response didn't match the expected shape: ${parsed.error.issues[0]?.message ?? "unknown validation error"}`,
      raw,
    );
  }

  return { data: parsed.data, raw };
}
