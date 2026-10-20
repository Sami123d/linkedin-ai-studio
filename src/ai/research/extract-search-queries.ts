import "server-only";

import {
  generateStructured,
  StructuredGenerationError,
} from "@/ai/generate-structured";
import type { AIGenerateResult, AIProvider } from "@/ai/providers";
import { searchQueriesSchema } from "@/validation/research-studio";

/// Turns a natural-language research request into short keyword queries for
/// the search APIs. The model only writes QUERIES; it never sees or invents
/// results. Same error pattern as the other agents so the caller can audit
/// the prompt/response either way.
export class QueryExtractionError extends Error {
  constructor(
    message: string,
    readonly prompt: string,
    readonly raw?: AIGenerateResult,
  ) {
    super(message);
    this.name = "QueryExtractionError";
  }
}

const SYSTEM_PROMPT = `You turn a content creator's research request into search queries for
news and developer search engines (Hacker News search, DEV article search, a news search API).
Return 1 to 3 short keyword queries (2-6 words each) that capture the core subject. Do not include
dates, timeframes, platform names, audience or tone words, quotes or search operators, and do not
answer the request. Respond with ONLY a JSON object, no markdown fences:
{ "queries": string[] }`;

export function buildQueryPrompt(input: {
  prompt: string;
  industry?: string | null;
}): string {
  const lines = [`Research request: ${input.prompt}`];
  if (input.industry) lines.push(`Industry/niche: ${input.industry}`);
  lines.push("", "Write the search queries now.");
  return lines.join("\n");
}

export async function extractSearchQueries(
  provider: AIProvider,
  input: { prompt: string; industry?: string | null },
) {
  const prompt = buildQueryPrompt(input);
  try {
    const { data, raw } = await generateStructured({
      provider,
      systemPrompt: SYSTEM_PROMPT,
      prompt,
      schema: searchQueriesSchema,
    });
    const queries = [
      ...new Set(data.queries.map((q) => q.replace(/["']/g, "").trim())),
    ].filter((q) => q.length >= 2);
    if (queries.length === 0) throw new Error("No usable search queries.");
    return { queries, raw, prompt };
  } catch (error) {
    const raw =
      error instanceof StructuredGenerationError ? error.raw : undefined;
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new QueryExtractionError(message, prompt, raw);
  }
}
