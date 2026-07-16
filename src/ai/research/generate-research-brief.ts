import "server-only";

import {
  generateStructured,
  StructuredGenerationError,
} from "@/ai/generate-structured";
import type { AIGenerateResult, AIProvider } from "@/ai/providers";
import { researchBriefSchema } from "@/validation/research";

/// Always carries the prompt that was sent, even when the provider call
/// itself failed before returning anything — the caller (the research
/// server action) needs the prompt in both branches to write a complete
/// ResearchAttempt audit row regardless of success/failure.
export class ResearchGenerationError extends Error {
  constructor(
    message: string,
    readonly prompt: string,
    readonly raw?: AIGenerateResult,
  ) {
    super(message);
    this.name = "ResearchGenerationError";
  }
}

const SYSTEM_PROMPT = `You are a research analyst supporting a personal-branding content
pipeline for LinkedIn. Given a trending topic, produce a concise, well-grounded research
brief a content strategist can act on immediately. Be specific and concrete — avoid vague
generalities. If you are not confident about a specific statistic, omit it rather than
inventing one. Respond with ONLY a JSON object, no markdown fences, matching exactly this
shape:
{
  "executiveSummary": string,
  "keyInsights": string[],
  "marketOpportunities": string[],
  "risks": string[],
  "statistics": string[],
  "contentAngles": string[]
}`;

function buildPrompt(trend: {
  topic: string;
  summary: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
}): string {
  const lines = [`Trending topic: ${trend.topic}`];
  if (trend.summary) lines.push(`Context from source: ${trend.summary}`);
  if (trend.sourceName) lines.push(`Source: ${trend.sourceName}`);
  if (trend.sourceUrl) lines.push(`Source URL: ${trend.sourceUrl}`);
  lines.push(
    "",
    "Produce the research brief now, covering: an executive summary, key insights, " +
      "market opportunities, risks/challenges, relevant statistics or facts (omit if " +
      "none you're confident about), and suggested content angles for a LinkedIn post " +
      "about this topic.",
  );
  return lines.join("\n");
}

/// Business logic depends only on the AIProvider interface — this function
/// has no idea whether `provider` is Gemini, Ollama, or a test double.
export async function generateResearchBrief(
  provider: AIProvider,
  trend: {
    topic: string;
    summary: string | null;
    sourceName: string | null;
    sourceUrl: string | null;
  },
) {
  const prompt = buildPrompt(trend);
  try {
    const { data, raw } = await generateStructured({
      provider,
      systemPrompt: SYSTEM_PROMPT,
      prompt,
      schema: researchBriefSchema,
    });
    return { data, raw, prompt };
  } catch (error) {
    const raw =
      error instanceof StructuredGenerationError ? error.raw : undefined;
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new ResearchGenerationError(message, prompt, raw);
  }
}
