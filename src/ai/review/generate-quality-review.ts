import "server-only";

import {
  generateStructured,
  StructuredGenerationError,
} from "@/ai/generate-structured";
import type { AIGenerateResult, AIProvider } from "@/ai/providers";
import { qualityReviewSchema } from "@/validation/review";

/// Same reasoning as the other agents' *GenerationError classes: always
/// carries the prompt, even when the provider call itself failed before
/// returning anything, so the caller can write a complete ReviewAttempt
/// audit row regardless of success/failure.
export class ReviewGenerationError extends Error {
  constructor(
    message: string,
    readonly prompt: string,
    readonly raw?: AIGenerateResult,
  ) {
    super(message);
    this.name = "ReviewGenerationError";
  }
}

const SYSTEM_PROMPT = `You are a skeptical editor reviewing a LinkedIn post draft before it
goes to a human for final approval. Be honest and specific — don't rubber-stamp weak drafts,
and don't invent problems that aren't there either. Score each dimension 0-100:
- hookScore: does the opening line actually stop someone scrolling?
- clarityScore: is the point easy to follow, free of jargon/rambling?
- voiceMatchScore: does it sound like the person's own writing samples, not generic AI voice?
- valueScore: does a reader walk away with something real (insight, story, usable idea)?
- ctaScore: is the call to action natural, not forced or generic?
Set verdict to "NEEDS_REVISION" if any dimension scores below 60, or if the draft doesn't
actually match the plan it was supposed to follow; otherwise "APPROVED". Respond with ONLY a
JSON object, no markdown fences, matching exactly this shape:
{
  "verdict": "APPROVED" | "NEEDS_REVISION",
  "hookScore": number,
  "clarityScore": number,
  "voiceMatchScore": number,
  "valueScore": number,
  "ctaScore": number,
  "strengths": string[],
  "feedback": string[]
}
"feedback" must be specific and actionable (e.g. "the second paragraph repeats the hook
instead of adding new information"), not generic praise or generic criticism.`;

export type ReviewInput = {
  format: string;
  hook: string;
  keyMessage: string;
  toneGuidance: string;
  content: string | null;
  slides: string[];
  hashtags: string[];
  writingSamples: string[];
};

function buildPrompt(input: ReviewInput): string {
  const lines = [
    `Format: ${input.format}`,
    `Plan's intended hook: ${input.hook}`,
    `Plan's key message: ${input.keyMessage}`,
    `Plan's tone guidance: ${input.toneGuidance}`,
    "",
    "Draft to review:",
  ];

  if (input.content) {
    lines.push(input.content);
  }
  if (input.slides.length > 0) {
    lines.push(
      ...input.slides.map((slide, i) => `Slide ${i + 1}: ${slide}`),
    );
  }
  if (input.hashtags.length > 0) {
    lines.push(`Hashtags: ${input.hashtags.map((h) => `#${h}`).join(" ")}`);
  }

  lines.push("");
  if (input.writingSamples.length > 0) {
    lines.push(
      "This person's own past writing (compare voice against this):",
      ...input.writingSamples.map((s) => `---\n${s}`),
      "",
    );
  } else {
    lines.push(
      "No writing samples on file — judge voiceMatchScore against the tone guidance alone.",
      "",
    );
  }

  lines.push("Review the draft now.");
  return lines.join("\n");
}

/// Business logic depends only on the AIProvider interface — same pattern
/// as every other agent in this pipeline.
export async function generateQualityReview(
  provider: AIProvider,
  input: ReviewInput,
) {
  const prompt = buildPrompt(input);
  try {
    const { data, raw } = await generateStructured({
      provider,
      systemPrompt: SYSTEM_PROMPT,
      prompt,
      schema: qualityReviewSchema,
    });
    return { data, raw, prompt };
  } catch (error) {
    const raw =
      error instanceof StructuredGenerationError ? error.raw : undefined;
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new ReviewGenerationError(message, prompt, raw);
  }
}
