import "server-only";

import {
  generateStructured,
  StructuredGenerationError,
} from "@/ai/generate-structured";
import type { AIGenerateResult, AIProvider } from "@/ai/providers";
import { contentPlanSchema } from "@/validation/planning";

/// Same reasoning as ResearchGenerationError (src/ai/research/generate-research-brief.ts):
/// always carries the prompt, even when the provider call itself failed
/// before returning anything, so the caller can write a complete
/// PlanAttempt audit row regardless of success/failure.
export class PlanGenerationError extends Error {
  constructor(
    message: string,
    readonly prompt: string,
    readonly raw?: AIGenerateResult,
  ) {
    super(message);
    this.name = "PlanGenerationError";
  }
}

const SYSTEM_PROMPT = `You are a content strategist planning a LinkedIn post for a specific
person, using their own research, Knowledge Base, and stated goals. Choose the single best
angle and format for THIS person, not a generic take. Ground the hook, tone, and outline in
the provided Knowledge Base context and writing voice where relevant, and connect the content
to at least one of their goals if a natural fit exists — don't force it if none fits. Respond
with ONLY a JSON object, no markdown fences, matching exactly this shape:
{
  "format": "SINGLE_POST" | "CAROUSEL" | "ARTICLE",
  "selectedAngle": string,
  "hook": string,
  "keyMessage": string,
  "outline": string[],
  "toneGuidance": string,
  "callToAction": string
}`;

export type PlanningInput = {
  trendTopic: string;
  research: {
    executiveSummary: string | null;
    keyInsights: string[];
    marketOpportunities: string[];
    risks: string[];
    statistics: string[];
    contentAngles: string[];
  };
  knowledgeContext: string[];
  goals: string[];
};

function buildPrompt(input: PlanningInput): string {
  const lines = [`Trending topic: ${input.trendTopic}`, ""];

  if (input.research.executiveSummary) {
    lines.push(`Research summary: ${input.research.executiveSummary}`);
  }
  if (input.research.keyInsights.length > 0) {
    lines.push(`Key insights:\n- ${input.research.keyInsights.join("\n- ")}`);
  }
  if (input.research.contentAngles.length > 0) {
    lines.push(
      `Suggested angles from research:\n- ${input.research.contentAngles.join("\n- ")}`,
    );
  }
  if (input.research.marketOpportunities.length > 0) {
    lines.push(
      `Market opportunities:\n- ${input.research.marketOpportunities.join("\n- ")}`,
    );
  }
  if (input.research.risks.length > 0) {
    lines.push(`Risks/challenges:\n- ${input.research.risks.join("\n- ")}`);
  }
  if (input.research.statistics.length > 0) {
    lines.push(`Statistics/facts:\n- ${input.research.statistics.join("\n- ")}`);
  }

  lines.push("");
  if (input.knowledgeContext.length > 0) {
    lines.push(
      "Relevant context from this person's own Knowledge Base (background, past work, writing voice):",
      ...input.knowledgeContext.map((c) => `- ${c}`),
      "",
    );
  } else {
    lines.push(
      "No Knowledge Base context was retrieved (their KB may be empty or not synced yet) — plan from the research alone.",
      "",
    );
  }

  if (input.goals.length > 0) {
    lines.push(
      "This person's stated goals (connect to one only if it's a genuine fit):",
      ...input.goals.map((g) => `- ${g}`),
      "",
    );
  }

  lines.push(
    "Produce the content plan now: pick one format, one angle, a hook (opening line), the " +
      "key message, an outline (sections for a single post, or one bullet per slide for a " +
      "carousel), tone guidance, and a call to action.",
  );

  return lines.join("\n");
}

/// Business logic depends only on the AIProvider interface — same pattern
/// as generateResearchBrief (Milestone 6).
export async function generateContentPlan(
  provider: AIProvider,
  input: PlanningInput,
) {
  const prompt = buildPrompt(input);
  try {
    const { data, raw } = await generateStructured({
      provider,
      systemPrompt: SYSTEM_PROMPT,
      prompt,
      schema: contentPlanSchema,
    });
    return { data, raw, prompt };
  } catch (error) {
    const raw =
      error instanceof StructuredGenerationError ? error.raw : undefined;
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new PlanGenerationError(message, prompt, raw);
  }
}
