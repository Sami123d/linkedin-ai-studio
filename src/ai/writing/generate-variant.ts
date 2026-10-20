import "server-only";

import {
  generateStructured,
  StructuredGenerationError,
} from "@/ai/generate-structured";
import type { AIGenerateResult, AIProvider } from "@/ai/providers";
import {
  formatCreativeContext,
  type CreativeContext,
} from "@/ai/creative-context";
import { validateVariantLimits } from "@/features/platforms/limits";
import {
  variantContentSchema,
  type VariantPlatformValue,
} from "@/validation/platforms";

/// Same reasoning as DraftGenerationError: always carries the prompt, even
/// when the provider call failed before returning anything, so the caller
/// can write a complete VariantAttempt audit row.
export class VariantGenerationError extends Error {
  constructor(
    message: string,
    readonly prompt: string,
    readonly raw?: AIGenerateResult,
  ) {
    super(message);
    this.name = "VariantGenerationError";
  }
}

const SHAPE = `Respond with ONLY a JSON object, no markdown fences, matching exactly this shape:
{
  "content": string,
  "hashtags": string[]
}
"hashtags" are without the # symbol.`;

const SYSTEM_PROMPTS: Record<VariantPlatformValue, string> = {
  FACEBOOK: `You are adapting an approved LinkedIn post into a post for a Facebook Page, for
the same person and the same key message. Facebook is conversational and community-oriented:
shorter and warmer than LinkedIn, less corporate jargon, short paragraphs, optionally one question
to invite comments. Aim for 40-150 words. Keep the voice shown in the person's own writing samples.
Do not invent facts that aren't in the source. Use at most 3 hashtags. ${SHAPE}`,
  INSTAGRAM: `You are adapting an approved LinkedIn post into an Instagram caption for a
professional account, for the same person and the same key message. Open with a strong first line
(it is all people see before "more"), use short lines and line breaks, keep it under 1500
characters, and end with a clear call to action. Keep the voice shown in the person's own writing
samples. Do not invent facts that aren't in the source. Use 5-15 relevant hashtags. The post will
be paired with an image, so don't describe the image. ${SHAPE}`,
};

export type VariantInput = {
  platform: VariantPlatformValue;
  selectedAngle: string;
  hook: string;
  keyMessage: string;
  toneGuidance: string;
  callToAction: string;
  /// The approved LinkedIn text (body, or carousel slides joined).
  sourceContent: string;
  writingSamples: string[];
  knowledgeContext: string[];
  /// Research Studio preferences + verified findings (optional).
  creative?: CreativeContext | null;
};

export function buildPrompt(input: VariantInput): string {
  const lines = [
    `Angle: ${input.selectedAngle}`,
    `Hook: ${input.hook}`,
    `Key message: ${input.keyMessage}`,
    `Tone guidance: ${input.toneGuidance}`,
    `Call to action: ${input.callToAction}`,
    "",
    "LinkedIn source post to adapt:",
    "---",
    input.sourceContent,
    "---",
    "",
  ];

  if (input.writingSamples.length > 0) {
    lines.push(
      "This person's own past writing (match this voice):",
      ...input.writingSamples.map((s) => `---\n${s}`),
      "",
    );
  }

  if (input.knowledgeContext.length > 0) {
    lines.push(
      "Supporting detail from this person's Knowledge Base:",
      ...input.knowledgeContext.map((c) => `- ${c}`),
      "",
    );
  }

  lines.push(...formatCreativeContext(input.creative));
  lines.push("Write the post now.");
  return lines.join("\n");
}

export async function generateVariant(
  provider: AIProvider,
  input: VariantInput,
) {
  const prompt = buildPrompt(input);
  let generated: AIGenerateResult | undefined;
  try {
    const { data, raw } = await generateStructured({
      provider,
      systemPrompt: SYSTEM_PROMPTS[input.platform],
      prompt,
      schema: variantContentSchema,
    });
    generated = raw;
    const issues = validateVariantLimits(
      input.platform,
      data.content,
      data.hashtags,
    );
    if (issues.length > 0) {
      throw new Error(
        `Model output exceeds platform limits: ${issues.join(" ")}`,
      );
    }
    return { data, raw, prompt };
  } catch (error) {
    const raw =
      error instanceof StructuredGenerationError ? error.raw : generated;
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new VariantGenerationError(message, prompt, raw);
  }
}
