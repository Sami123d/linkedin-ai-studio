import { describe, expect, it, vi } from "vitest";

vi.mock("@/db/prisma", () => ({ prisma: {} }));

import { formatCreativeContext } from "@/ai/creative-context";
import { buildPrompt as buildPlanPrompt } from "@/ai/planning/generate-content-plan";
import type { AIProvider } from "@/ai/providers/types";
import {
  extractSearchQueries,
  QueryExtractionError,
} from "@/ai/research/extract-search-queries";
import {
  buildSourcedBriefPrompt,
  generateSourcedBrief,
  groundBrief,
  SourcedBriefGenerationError,
  toBriefColumns,
} from "@/ai/research/generate-sourced-brief";
import { buildPrompt as buildDraftPrompt } from "@/ai/writing/generate-draft";
import { buildPrompt as buildVariantPrompt } from "@/ai/writing/generate-variant";
import { buildCreativeContext } from "@/features/research-studio/context";
import type {
  SourcedBrief,
  SourceSnapshot,
} from "@/validation/research-studio";

const provider = (text: string): AIProvider => ({
  name: "fake",
  async generate() {
    return { text, model: "fake-1" };
  },
});

const sources: SourceSnapshot[] = [
  {
    ref: "S1",
    provider: "hackernews",
    title: "Retailers deploy shopping agents",
    publisher: "news.example",
    url: "https://news.example/agents",
    publishedAt: "2026-10-17T00:00:00.000Z",
    isRecent: true,
  },
  {
    ref: "S2",
    provider: "devto",
    title: "Agent checkout security",
    publisher: "blog.example",
    url: "https://blog.example/security",
    publishedAt: "2026-08-01T00:00:00.000Z",
    isRecent: false,
  },
];

const brief: SourcedBrief = {
  trendSummary: "Retailers are piloting AI shopping agents.",
  whyItMattersNow: "Several launches this week.",
  findings: [
    {
      statement: "Retailers are piloting agents",
      sourceIds: ["S1"],
      confidence: "supported",
    },
    {
      statement: "Security is a concern",
      sourceIds: ["s2", "S9"],
      confidence: "partially_supported",
    },
    {
      statement: "Agents will double conversion",
      sourceIds: ["S7"],
      confidence: "supported",
    },
    {
      statement: "Most shoppers want agents",
      sourceIds: [],
      confidence: "unverified",
    },
  ],
  counterpoints: ["Sources disagree on adoption speed."],
  contentAngles: ["What owners should test first"],
  audienceFit: "Small store owners",
  platformFit: [{ platform: "INSTAGRAM", note: "Visual explainer" }],
};

describe("sourced research brief", () => {
  it("lists every source with its ref, date and recent/background tag", () => {
    const prompt = buildSourcedBriefPrompt({
      focus: "AI shopping agents",
      prompt: "Find trends",
      timeframeDays: 7,
      audience: "owners",
      platforms: ["LINKEDIN"],
      sources: sources.map((s) => ({
        ...s,
        snippet: s.ref === "S1" ? "Excerpt here" : null,
      })),
    });
    expect(prompt).toContain("[S1] [recent] Retailers deploy shopping agents");
    expect(prompt).toContain("[S2] [background]");
    expect(prompt).toContain("Excerpt: Excerpt here");
    expect(prompt).toContain("Target audience: owners");
  });

  it("grounds citations: drops unknown refs and downgrades uncited findings", () => {
    const ev = groundBrief(brief, sources, {
      requestId: "r1",
      timeframeDays: 7,
    });
    expect(ev.findings[0]).toMatchObject({
      confidence: "supported",
      sources: [sources[0]],
    });
    // Case-insensitive match keeps S2; the made-up S9 is dropped.
    expect(ev.findings[1]!.sources.map((s) => s.ref)).toEqual(["S2"]);
    expect(ev.findings[1]!.confidence).toBe("partially_supported");
    // "supported" with only a made-up source becomes unverified.
    expect(ev.findings[2]).toMatchObject({
      confidence: "unverified",
      sources: [],
    });
    expect(ev.droppedRefs.sort()).toEqual(["S7", "S9"]);
  });

  it("never turns unverified findings into key insights", () => {
    const ev = groundBrief(brief, sources, {
      requestId: "r1",
      timeframeDays: 7,
    });
    const cols = toBriefColumns(brief, ev);
    expect(cols.keyInsights).toEqual([
      "Retailers are piloting agents",
      "Security is a concern (partially supported)",
    ]);
    expect(cols.risks).toContain("Unverified: Agents will double conversion");
    expect(cols.risks).toContain("Sources disagree on adoption speed.");
    expect(cols.statistics).toEqual([]);
    expect(cols.platformFit).toEqual(["INSTAGRAM: Visual explainer"]);
  });

  it("parses a valid model response", async () => {
    const r = await generateSourcedBrief(provider(JSON.stringify(brief)), {
      focus: "f",
      prompt: "p",
      timeframeDays: 7,
      platforms: ["LINKEDIN"],
      sources: [],
    });
    expect(r.data.findings).toHaveLength(4);
  });

  it("rejects malformed output, carrying the prompt for the audit row", async () => {
    const bad = { ...brief, findings: [] };
    const error = await generateSourcedBrief(provider(JSON.stringify(bad)), {
      focus: "f",
      prompt: "p",
      timeframeDays: 7,
      platforms: ["LINKEDIN"],
      sources: [],
    }).catch((e) => e);
    expect(error).toBeInstanceOf(SourcedBriefGenerationError);
    expect(error.prompt).toContain("Focus topic: f");
    expect(error.raw?.text).toBeDefined();
  });
});

describe("search query extraction", () => {
  it("returns cleaned, de-duplicated queries", async () => {
    const r = await extractSearchQueries(
      provider(
        '{"queries":["AI agents e-commerce","\\"AI agents e-commerce\\"","agentic checkout"]}',
      ),
      { prompt: "Find trends about AI agents in e-commerce" },
    );
    expect(r.queries).toEqual(["AI agents e-commerce", "agentic checkout"]);
  });

  it("throws a QueryExtractionError (so discovery can fall back) on bad output", async () => {
    const error = await extractSearchQueries(provider("not json"), {
      prompt: "x",
    }).catch((e) => e);
    expect(error).toBeInstanceOf(QueryExtractionError);
    expect(error.prompt).toContain("Research request: x");
  });
});

const prefs = {
  audience: "small e-commerce owners",
  industry: "e-commerce",
  angle: "practical first steps",
  purpose: "educate",
  tone: "friendly",
  callToAction: "Ask what they tried",
  instructions: "Avoid jargon",
  includeLinks: false,
};

describe("findings passed into content generation", () => {
  const evidence = groundBrief(brief, sources, {
    requestId: "r1",
    timeframeDays: 7,
  });

  it("carries preferences and only source-backed findings", () => {
    const ctx = buildCreativeContext(prefs, evidence);
    expect(ctx.findings).toEqual([
      "Retailers are piloting agents",
      "Security is a concern (partially supported by the sources)",
    ]);
    expect(ctx.findings.join(" ")).not.toContain("double conversion");
    expect(ctx.preferences.audience).toBe("small e-commerce owners");
    expect(ctx.sourceLinks).toEqual([]);
  });

  it("offers source links only when the creator allowed them", () => {
    const ctx = buildCreativeContext(
      { ...prefs, includeLinks: true },
      evidence,
    );
    expect(ctx.sourceLinks.map((l) => l.url)).toEqual([
      "https://news.example/agents",
      "https://blog.example/security",
    ]);
    expect(formatCreativeContext(ctx).join("\n")).toContain(
      "https://news.example/agents",
    );
    expect(
      formatCreativeContext(buildCreativeContext(prefs, evidence)).join("\n"),
    ).toContain("Do not include any URLs");
  });

  it("works without evidence (no findings, still preferences)", () => {
    const ctx = buildCreativeContext(prefs, null);
    expect(ctx.findings).toEqual([]);
    expect(formatCreativeContext(ctx).join("\n")).toContain("Tone: friendly");
  });

  it("puts the findings and preferences into planning, writing and variant prompts", () => {
    const ctx = buildCreativeContext(prefs, evidence);
    const plan = buildPlanPrompt({
      trendTopic: "AI agents",
      research: {
        executiveSummary: "s",
        keyInsights: [],
        marketOpportunities: [],
        risks: [],
        statistics: [],
        contentAngles: [],
      },
      knowledgeContext: [],
      goals: [],
      creative: ctx,
    });
    const draft = buildDraftPrompt({
      format: "SINGLE_POST",
      selectedAngle: "a",
      hook: "h",
      keyMessage: "k",
      outline: ["o"],
      toneGuidance: "t",
      callToAction: "c",
      writingSamples: [],
      knowledgeContext: [],
      creative: ctx,
    });
    const variant = buildVariantPrompt({
      platform: "FACEBOOK",
      selectedAngle: "a",
      hook: "h",
      keyMessage: "k",
      toneGuidance: "t",
      callToAction: "c",
      sourceContent: "LinkedIn text",
      writingSamples: [],
      knowledgeContext: [],
      creative: ctx,
    });
    for (const prompt of [plan, draft, variant]) {
      expect(prompt).toContain("- Retailers are piloting agents");
      expect(prompt).toContain("Audience: small e-commerce owners");
      expect(prompt).toContain("Extra instructions: Avoid jargon");
      expect(prompt).not.toContain("double conversion");
    }
  });

  it("leaves classic (non-Research Studio) prompts unchanged", () => {
    const base = {
      format: "SINGLE_POST" as const,
      selectedAngle: "a",
      hook: "h",
      keyMessage: "k",
      outline: ["o"],
      toneGuidance: "t",
      callToAction: "c",
      writingSamples: [],
      knowledgeContext: [],
    };
    expect(buildDraftPrompt(base)).toBe(
      buildDraftPrompt({ ...base, creative: null }),
    );
    expect(buildDraftPrompt(base)).not.toContain("URL");
  });
});
