import "server-only";

import {
  generateStructured,
  StructuredGenerationError,
} from "@/ai/generate-structured";
import type { AIGenerateResult, AIProvider } from "@/ai/providers";
import { learningInsightSchema } from "@/validation/learning";

/// Same reasoning as every other agent's *GenerationError class: always
/// carries the prompt, even when the provider call itself failed before
/// returning anything, so the caller can write a complete LearningAttempt
/// audit row regardless of success/failure.
export class LearningGenerationError extends Error {
  constructor(
    message: string,
    readonly prompt: string,
    readonly raw?: AIGenerateResult,
  ) {
    super(message);
    this.name = "LearningGenerationError";
  }
}

const SYSTEM_PROMPT = `You are a content strategist analyzing a LinkedIn creator's own
published post history to find what's actually working. Look for real patterns across
format, angle, tone, and topic — not generic LinkedIn advice. Ground every claim in the
specific posts provided; don't invent patterns the data doesn't support. If the data is too
thin or too uniform to draw a confident pattern, say so plainly rather than forcing one.
Recommendations must be concrete enough to change what gets planned next (e.g. "lean into
contrarian angles on AI topics — your two highest-engagement posts both took a skeptical
stance" not "post more engaging content"). Respond with ONLY a JSON object, no markdown
fences, matching exactly this shape:
{
  "summary": string,
  "topPerformingPatterns": string[],
  "underperformingPatterns": string[],
  "recommendations": string[]
}`;

export type PublishedPostSummary = {
  topic: string;
  format: string;
  selectedAngle: string | null;
  toneGuidance: string | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  impressions: number | null;
  engagementRate: number | null;
};

function buildPrompt(posts: PublishedPostSummary[]): string {
  const lines = [
    `${posts.length} published post(s) with engagement data:`,
    "",
  ];

  posts.forEach((post, i) => {
    lines.push(
      `${i + 1}. Topic: ${post.topic}`,
      `   Format: ${post.format}`,
      post.selectedAngle ? `   Angle: ${post.selectedAngle}` : "",
      post.toneGuidance ? `   Tone: ${post.toneGuidance}` : "",
      `   Engagement: ${post.likes ?? 0} likes, ${post.comments ?? 0} comments, ${post.shares ?? 0} shares` +
        (post.impressions !== null ? `, ${post.impressions} impressions` : "") +
        (post.engagementRate !== null
          ? ` (${(post.engagementRate * 100).toFixed(1)}% engagement rate)`
          : ""),
      "",
    );
  });

  lines.push(
    "Analyze this history now: what patterns separate the better-performing posts from " +
      "the weaker ones, and what should be done differently for future content plans.",
  );

  return lines.filter(Boolean).join("\n");
}

/// Business logic depends only on the AIProvider interface — same pattern
/// as every other agent in this pipeline.
export async function generateLearningInsight(
  provider: AIProvider,
  posts: PublishedPostSummary[],
) {
  const prompt = buildPrompt(posts);
  try {
    const { data, raw } = await generateStructured({
      provider,
      systemPrompt: SYSTEM_PROMPT,
      prompt,
      schema: learningInsightSchema,
    });
    return { data, raw, prompt };
  } catch (error) {
    const raw =
      error instanceof StructuredGenerationError ? error.raw : undefined;
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new LearningGenerationError(message, prompt, raw);
  }
}
