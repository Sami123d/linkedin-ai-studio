import "server-only";

import {
  generateStructured,
  StructuredGenerationError,
} from "@/ai/generate-structured";
import type { AIGenerateResult, AIProvider } from "@/ai/providers";
import {
  sourcedBriefSchema,
  type ResearchEvidence,
  type SourceSnapshot,
  type SourcedBrief,
} from "@/validation/research-studio";

/// Research brief built ONLY from sources a search provider returned. The
/// model must cite source refs (S1, S2…) for each finding; refs are checked
/// against the real list afterwards (see groundBrief) and anything uncited
/// or mis-cited is downgraded to "unverified" rather than trusted.
export class SourcedBriefGenerationError extends Error {
  constructor(
    message: string,
    readonly prompt: string,
    readonly raw?: AIGenerateResult,
  ) {
    super(message);
    this.name = "SourcedBriefGenerationError";
  }
}

const SYSTEM_PROMPT = `You are a careful research analyst. Write a research brief using ONLY
the numbered sources provided. Every finding must cite the source ids (like "S2") that support
it. Rules:
- Never invent sources, URLs, numbers, quotes, dates or facts not present in the sources.
- "supported": stated directly by at least one cited source. "partially_supported": the sources
  suggest it but don't fully establish it. "unverified": your own inference or not in any source.
- If sources disagree, say so in "counterpoints". Note limitations, such as when sources are old,
  few, or only summaries/snippets.
- Sources marked [background] are older than the requested timeframe: don't present them as new.
Respond with ONLY a JSON object, no markdown fences, matching exactly:
{
  "trendSummary": string,
  "whyItMattersNow": string,
  "findings": [{ "statement": string, "sourceIds": string[], "confidence": "supported" | "partially_supported" | "unverified" }],
  "counterpoints": string[],
  "contentAngles": string[],
  "audienceFit": string,
  "platformFit": [{ "platform": "LINKEDIN" | "FACEBOOK" | "INSTAGRAM", "note": string }]
}`;

export type BriefSource = SourceSnapshot & { snippet: string | null };

export type SourcedBriefInput = {
  focus: string;
  prompt: string;
  timeframeDays: number;
  audience?: string | null;
  industry?: string | null;
  angle?: string | null;
  purpose?: string | null;
  platforms: string[];
  sources: BriefSource[];
};

export function buildSourcedBriefPrompt(input: SourcedBriefInput): string {
  const lines = [
    `Focus topic: ${input.focus}`,
    `Creator's research request: ${input.prompt}`,
    `Requested timeframe: last ${input.timeframeDays} day(s)`,
  ];
  if (input.audience) lines.push(`Target audience: ${input.audience}`);
  if (input.industry) lines.push(`Industry/niche: ${input.industry}`);
  if (input.angle) lines.push(`Preferred angle: ${input.angle}`);
  if (input.purpose) lines.push(`Purpose of the post: ${input.purpose}`);
  lines.push(`Target platforms: ${input.platforms.join(", ")}`, "", "Sources:");
  for (const s of input.sources) {
    const date = s.publishedAt ? s.publishedAt.slice(0, 10) : "date unknown";
    const tag = s.publishedAt
      ? s.isRecent
        ? "recent"
        : "background"
      : "undated";
    lines.push(
      `[${s.ref}] [${tag}] ${s.title} — ${s.publisher ?? "unknown publisher"}, ${date}`,
      `  URL: ${s.url}`,
    );
    if (s.snippet) lines.push(`  Excerpt: ${s.snippet}`);
  }
  lines.push("", "Write the research brief now.");
  return lines.join("\n");
}

/// Validates every citation against the real source list. Unknown refs are
/// dropped; a finding left with no valid citation can't be "supported".
export function groundBrief(
  data: SourcedBrief,
  sources: SourceSnapshot[],
  meta: { requestId: string; timeframeDays: number },
): ResearchEvidence {
  const byRef = new Map(sources.map((s) => [s.ref.toUpperCase(), s]));
  const dropped = new Set<string>();
  const findings = data.findings.map((f) => {
    const cited: SourceSnapshot[] = [];
    for (const id of f.sourceIds) {
      const s = byRef.get(id.trim().toUpperCase());
      if (s) {
        if (!cited.includes(s)) cited.push(s);
      } else {
        dropped.add(id);
      }
    }
    return {
      statement: f.statement,
      confidence: cited.length === 0 ? ("unverified" as const) : f.confidence,
      sources: cited,
    };
  });
  return {
    version: 1,
    requestId: meta.requestId,
    timeframeDays: meta.timeframeDays,
    findings,
    sources,
    droppedRefs: [...dropped],
  };
}

/// Maps a grounded brief onto the classic ResearchBrief columns the
/// planning agent already reads. Unverified findings never become
/// "key insights"; they are listed as open questions instead.
export function toBriefColumns(data: SourcedBrief, evidence: ResearchEvidence) {
  const verified = evidence.findings.filter(
    (f) => f.confidence !== "unverified",
  );
  const unverified = evidence.findings.filter(
    (f) => f.confidence === "unverified",
  );
  return {
    executiveSummary: data.trendSummary,
    whyItMattersNow: data.whyItMattersNow,
    keyInsights: verified.map((f) =>
      f.confidence === "partially_supported"
        ? `${f.statement} (partially supported)`
        : f.statement,
    ),
    marketOpportunities: [] as string[],
    risks: [
      ...data.counterpoints,
      ...unverified.map((f) => `Unverified: ${f.statement}`),
    ],
    statistics: [] as string[],
    contentAngles: data.contentAngles,
    audienceFit: data.audienceFit,
    platformFit: data.platformFit.map((p) => `${p.platform}: ${p.note}`),
  };
}

export async function generateSourcedBrief(
  provider: AIProvider,
  input: SourcedBriefInput,
) {
  const prompt = buildSourcedBriefPrompt(input);
  try {
    const { data, raw } = await generateStructured({
      provider,
      systemPrompt: SYSTEM_PROMPT,
      prompt,
      schema: sourcedBriefSchema,
    });
    return { data, raw, prompt };
  } catch (error) {
    const raw =
      error instanceof StructuredGenerationError ? error.raw : undefined;
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new SourcedBriefGenerationError(message, prompt, raw);
  }
}
