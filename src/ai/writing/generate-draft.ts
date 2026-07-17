import "server-only";

import {
  generateStructured,
  StructuredGenerationError,
} from "@/ai/generate-structured";
import type { AIGenerateResult, AIProvider } from "@/ai/providers";
import type { ContentFormat } from "@/generated/prisma/client";
import { draftContentSchema, type DraftContent } from "@/validation/writing";

/// Same reasoning as ResearchGenerationError/PlanGenerationError: always
/// carries the prompt, even when the provider call itself failed before
/// returning anything, so the caller can write a complete DraftAttempt
/// audit row regardless of success/failure.
export class DraftGenerationError extends Error {
  constructor(
    message: string,
    readonly prompt: string,
    readonly raw?: AIGenerateResult,
  ) {
    super(message);
    this.name = "DraftGenerationError";
  }
}

const SYSTEM_PROMPT = `You are a ghostwriter producing the final LinkedIn post for a specific
person, following a content plan someone else already approved. Write in the voice shown by
their own past writing samples below — match their sentence rhythm, vocabulary, and level of
formality, don't default to generic "LinkedIn thought leader" voice. Follow the plan's hook,
key message, outline, tone, and call to action closely; don't invent a different angle. Respond
with ONLY a JSON object, no markdown fences, matching exactly this shape:
{
  "content": string,
  "slides": string[],
  "hashtags": string[]
}
For a SINGLE_POST or ARTICLE format: write the full post in "content" (typical LinkedIn post
length, 150-300 words for a SINGLE_POST, longer for an ARTICLE); leave "slides" as an empty
array. For a CAROUSEL format: leave "content" as an empty string, and write one short, punchy
slide of text per array entry in "slides" (one entry per outline point is a reasonable default).
"hashtags" is always a short list (3-6) of relevant hashtags without the # symbol.`;

export type WritingInput = {
  format: ContentFormat;
  selectedAngle: string;
  hook: string;
  keyMessage: string;
  outline: string[];
  toneGuidance: string;
  callToAction: string;
  writingSamples: string[];
  knowledgeContext: string[];
};

function buildPrompt(input: WritingInput): string {
  const lines = [
    `Format: ${input.format}`,
    `Angle: ${input.selectedAngle}`,
    `Hook: ${input.hook}`,
    `Key message: ${input.keyMessage}`,
    `Outline:\n- ${input.outline.join("\n- ")}`,
    `Tone guidance: ${input.toneGuidance}`,
    `Call to action: ${input.callToAction}`,
    "",
  ];

  if (input.writingSamples.length > 0) {
    lines.push(
      "This person's own past writing (match this voice):",
      ...input.writingSamples.map((s) => `---\n${s}`),
      "",
    );
  } else {
    lines.push(
      "No writing samples on file — use the tone guidance above as your only voice signal.",
      "",
    );
  }

  if (input.knowledgeContext.length > 0) {
    lines.push(
      "Supporting detail from this person's Knowledge Base (use for specificity, don't just list it):",
      ...input.knowledgeContext.map((c) => `- ${c}`),
      "",
    );
  }

  lines.push("Write the post now.");
  return lines.join("\n");
}

function validateShape(data: DraftContent, format: ContentFormat): void {
  if (format === "CAROUSEL") {
    if (data.slides.length === 0) {
      throw new Error(
        "Model returned no slides for a CAROUSEL-format plan.",
      );
    }
  } else if (!data.content || data.content.trim().length === 0) {
    throw new Error(
      `Model returned no content for a ${format}-format plan.`,
    );
  }
}

/// Business logic depends only on the AIProvider interface — same pattern
/// as generateResearchBrief/generateContentPlan.
export async function generateDraft(provider: AIProvider, input: WritingInput) {
  const prompt = buildPrompt(input);
  try {
    const { data, raw } = await generateStructured({
      provider,
      systemPrompt: SYSTEM_PROMPT,
      prompt,
      schema: draftContentSchema,
    });
    validateShape(data, input.format);
    return { data, raw, prompt };
  } catch (error) {
    const raw =
      error instanceof StructuredGenerationError ? error.raw : undefined;
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new DraftGenerationError(message, prompt, raw);
  }
}
