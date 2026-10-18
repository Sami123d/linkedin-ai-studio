import { beforeEach, describe, expect, it, vi } from "vitest";

// Research Studio server actions against mocked Prisma, search and AI
// layers: ownership scoping, failure/retry audit rows, and content steps.

const PROFILE = "11111111-1111-1111-1111-111111111111";

type Args = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const db = vi.hoisted(() => {
  const fn = () => vi.fn<(args?: Args) => Promise<any>>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  const m = {
    researchRequest: {
      findFirst: fn(),
      findMany: fn(),
      create: fn(),
      updateMany: fn(),
    },
    researchSource: { deleteMany: fn(), createMany: fn(), updateMany: fn() },
    researchDiscoveryAttempt: { create: fn() },
    trend: { findFirst: fn(), findMany: fn(), create: fn(), updateMany: fn() },
    researchBrief: { upsert: fn(), update: fn() },
    researchAttempt: { create: fn() },
    contentPlan: { updateMany: fn(), findFirst: fn() },
    $transaction: vi.fn(),
  };
  return m;
});
const search = vi.hoisted(() => ({ discoverSources: vi.fn() }));
const queries = vi.hoisted(() => ({ extractSearchQueries: vi.fn() }));
const briefAi = vi.hoisted(() => ({ generateSourcedBrief: vi.fn() }));
const pipeline = vi.hoisted(() => ({ runPipelineStep: vi.fn() }));
const variants = vi.hoisted(() => ({ generateVariantAction: vi.fn() }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/features/knowledge-base/session", () => ({
  requireProfileId: vi.fn(async () => PROFILE),
}));
vi.mock("@/config/env.server", () => ({
  serverEnv: { BRAVE_SEARCH_API_KEY: undefined },
}));
vi.mock("@/db/prisma", () => ({ prisma: db }));
vi.mock("@/ai/providers", () => ({
  getAIProvider: () => ({ name: "fake", generate: vi.fn() }),
}));
vi.mock("@/lib/sources/discover", async (orig) => ({
  ...(await orig<typeof import("@/lib/sources/discover")>()),
  discoverSources: search.discoverSources,
}));
vi.mock("@/ai/research/extract-search-queries", async (orig) => ({
  ...(await orig<typeof import("@/ai/research/extract-search-queries")>()),
  extractSearchQueries: queries.extractSearchQueries,
}));
vi.mock("@/ai/research/generate-sourced-brief", async (orig) => ({
  ...(await orig<typeof import("@/ai/research/generate-sourced-brief")>()),
  generateSourcedBrief: briefAi.generateSourcedBrief,
}));
vi.mock("@/features/pipeline/actions", () => pipeline);
vi.mock("@/features/platforms/actions", () => variants);

import { QueryExtractionError } from "@/ai/research/extract-search-queries";
import {
  createResearchRequest,
  getResearchRequest,
  runDiscovery,
  runSourcedResearch,
  runStudioStep,
  saveSourceSelection,
} from "@/features/research-studio/actions";

const raw = { text: "{}", model: "fake-1" };
const NOW = Date.now();
function ranked(i: number, recent: boolean) {
  return {
    provider: "hackernews",
    title: `Story ${i}`,
    publisher: "example.com",
    url: `https://example.com/${i}`,
    discussionUrl: null,
    publishedAt: new Date(NOW - (recent ? 1 : 60) * 86_400_000),
    snippet: null,
    dedupeKey: `https://example.com/${i}`,
    freshness: recent ? "recent" : "background",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === "function"
      ? (arg as (tx: typeof db) => unknown)(db)
      : Promise.all(arg as unknown[]),
  );
  for (const model of Object.values(db)) {
    if (typeof model === "object") {
      for (const f of Object.values(model))
        (f as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
    }
  }
  db.trend.findMany.mockResolvedValue([]);
});

describe("creating a request", () => {
  const valid = {
    prompt: "Find recent trends about AI agents",
    timeframeDays: 7,
    platforms: ["LINKEDIN"],
  };

  it("validates input before touching the database", async () => {
    expect(
      await createResearchRequest({ ...valid, prompt: "x" }),
    ).toHaveProperty("error");
    expect(db.researchRequest.create).not.toHaveBeenCalled();
  });

  it("stores the prompt and preferences on a profile-owned request", async () => {
    db.researchRequest.create.mockResolvedValue({ id: "r1" });
    expect(await createResearchRequest({ ...valid, tone: "warm" })).toEqual({
      success: true,
      id: "r1",
    });
    expect(db.researchRequest.create.mock.calls[0]![0]!.data).toMatchObject({
      profileId: PROFILE,
      prompt: valid.prompt,
      tone: "warm",
    });
  });

  it("only accepts a shared trend as the starting trend", async () => {
    db.trend.findFirst.mockResolvedValue(null);
    expect(
      await createResearchRequest({
        ...valid,
        baseTrendId: "private-of-someone",
      }),
    ).toEqual({
      error: "That trend is no longer available.",
    });
    expect(db.trend.findFirst.mock.calls[0]![0]!.where).toEqual({
      id: "private-of-someone",
      profileId: null,
    });
  });
});

describe("ownership", () => {
  it("reads requests only through the caller's profile", async () => {
    db.researchRequest.findFirst.mockResolvedValue(null);
    expect(await getResearchRequest("r-other")).toBeNull();
    expect(db.researchRequest.findFirst.mock.calls[0]![0]!.where).toEqual({
      id: "r-other",
      profileId: PROFILE,
    });
  });

  it.each([
    ["runDiscovery", () => runDiscovery({ requestId: "r-other" })],
    ["runSourcedResearch", () => runSourcedResearch({ requestId: "r-other" })],
    [
      "saveSourceSelection",
      () => saveSourceSelection({ requestId: "r-other", sourceIds: [] }),
    ],
  ])(
    "%s refuses another profile's request and writes nothing",
    async (_name, call) => {
      db.researchRequest.findFirst.mockResolvedValue(null);
      expect(await call()).toEqual({ error: "Research request not found." });
      expect(db.researchRequest.updateMany).not.toHaveBeenCalled();
      expect(db.researchSource.createMany).not.toHaveBeenCalled();
      expect(db.trend.create).not.toHaveBeenCalled();
    },
  );

  it("runStudioStep refuses a request without the caller's own brief", async () => {
    db.researchRequest.findFirst.mockResolvedValue(null);
    expect(
      await runStudioStep({ requestId: "r-other", step: "plan" }),
    ).toHaveProperty("error");
    expect(pipeline.runPipelineStep).not.toHaveBeenCalled();
  });

  it("source selection updates are scoped by request and profile", async () => {
    db.researchRequest.findFirst.mockResolvedValue({ id: "r1" });
    await saveSourceSelection({
      requestId: "r1",
      sourceIds: ["s1"],
      focusTitle: "Story 1",
    });
    expect(db.researchSource.updateMany.mock.calls[1]![0]).toEqual({
      where: { requestId: "r1", profileId: PROFILE, id: { in: ["s1"] } },
      data: { selected: true },
    });
  });
});

const request = {
  id: "r1",
  profileId: PROFILE,
  prompt: "Find recent trends about AI agents in e-commerce",
  industry: "e-commerce",
  timeframeDays: 7,
  discoveryStatus: "PENDING",
  discoveryAttempts: 0,
  updatedAt: new Date(),
  baseTrend: null,
};

describe("source discovery", () => {
  it("stores real results, pre-selects up to five recent ones and audits the attempt", async () => {
    db.researchRequest.findFirst.mockResolvedValue(request);
    queries.extractSearchQueries.mockResolvedValue({
      queries: ["ai agents e-commerce"],
      raw,
      prompt: "q-prompt",
    });
    search.discoverSources.mockResolvedValue({
      sources: [
        ...Array.from({ length: 7 }, (_, i) => ranked(i, true)),
        ranked(9, false),
      ],
      providerResults: { hackernews: { ok: true, count: 8 } },
      allFailed: false,
    });

    const result = await runDiscovery({ requestId: "r1" });
    expect(result).toMatchObject({
      success: true,
      message: expect.stringMatching(/8 source/),
    });

    // Collected trends come only from the shared pool.
    expect(db.trend.findMany.mock.calls[0]![0]!.where).toMatchObject({
      profileId: null,
    });
    const rows = db.researchSource.createMany.mock.calls[0]![0]!.data;
    expect(rows).toHaveLength(8);
    expect(
      rows.every((r: Args) => r.profileId === PROFILE && r.requestId === "r1"),
    ).toBe(true);
    expect(rows.filter((r: Args) => r.selected)).toHaveLength(5);
    expect(rows.find((r: Args) => !r.isRecent).selected).toBe(false);
    expect(db.researchSource.deleteMany.mock.calls[0]![0]!.where).toEqual({
      requestId: "r1",
      profileId: PROFILE,
    });
    expect(
      db.researchDiscoveryAttempt.create.mock.calls[0]![0]!.data,
    ).toMatchObject({
      attemptNumber: 1,
      queries: ["ai agents e-commerce"],
      succeeded: true,
      prompt: "q-prompt",
    });
  });

  it("falls back to keyword queries when query extraction fails, and audits it", async () => {
    db.researchRequest.findFirst.mockResolvedValue(request);
    queries.extractSearchQueries.mockRejectedValue(
      new QueryExtractionError("bad json", "q-prompt", raw),
    );
    search.discoverSources.mockResolvedValue({
      sources: [],
      providerResults: {},
      allFailed: false,
    });
    const result = await runDiscovery({ requestId: "r1" });
    expect(result).toMatchObject({
      success: true,
      message: expect.stringMatching(/No sources/),
    });
    expect(search.discoverSources.mock.calls[0]![0].queries).toEqual([
      "ai agents e-commerce",
    ]);
    expect(
      db.researchDiscoveryAttempt.create.mock.calls[0]![0]!.data,
    ).toMatchObject({ prompt: "q-prompt", response: "{}" });
  });

  it("marks the request FAILED (retryable) when every provider fails", async () => {
    db.researchRequest.findFirst.mockResolvedValue({
      ...request,
      discoveryAttempts: 2,
    });
    queries.extractSearchQueries.mockResolvedValue({
      queries: ["agents"],
      raw,
      prompt: "p",
    });
    search.discoverSources.mockResolvedValue({
      sources: [],
      providerResults: {
        hackernews: { ok: false, count: 0, error: "HTTP 503" },
        devto: { ok: false, count: 0, error: "Timed out" },
      },
      allFailed: true,
    });
    const result = await runDiscovery({ requestId: "r1" });
    expect(result).toEqual({
      error: expect.stringMatching(/hackernews: HTTP 503/),
    });
    expect(db.researchSource.createMany).not.toHaveBeenCalled();
    const updates = db.researchRequest.updateMany.mock.calls.map(
      (c) => c[0]!.data,
    );
    expect(updates.at(-1)).toMatchObject({ discoveryStatus: "FAILED" });
    expect(
      db.researchDiscoveryAttempt.create.mock.calls[0]![0]!.data,
    ).toMatchObject({ attemptNumber: 3, succeeded: false });
  });

  it("refuses to start a second run while one is in progress", async () => {
    db.researchRequest.findFirst.mockResolvedValue({
      ...request,
      discoveryStatus: "PROCESSING",
      updatedAt: new Date(),
    });
    expect(await runDiscovery({ requestId: "r1" })).toEqual({
      error: "Source discovery is already running.",
    });
    expect(search.discoverSources).not.toHaveBeenCalled();
  });
});

const selected = [
  {
    id: "s1",
    provider: "hackernews",
    title: "Retailers deploy agents",
    publisher: "news.example",
    url: "https://news.example/a",
    publishedAt: new Date("2026-10-17T00:00:00Z"),
    isRecent: true,
    snippet: "ex",
  },
];
const briefJson = {
  trendSummary: "sum",
  whyItMattersNow: "now",
  findings: [
    {
      statement: "Retailers deploy agents",
      sourceIds: ["S1"],
      confidence: "supported",
    },
  ],
  counterpoints: [],
  contentAngles: ["angle"],
  audienceFit: "owners",
  platformFit: [],
};

describe("research brief from sources", () => {
  it("needs at least one selected source", async () => {
    db.researchRequest.findFirst.mockResolvedValue({
      ...request,
      sources: [],
      trend: null,
    });
    expect(await runSourcedResearch({ requestId: "r1" })).toEqual({
      error: "Select at least one source to research.",
    });
  });

  it("creates a PRIVATE trend for the profile and stores grounded evidence", async () => {
    db.researchRequest.findFirst.mockResolvedValue({
      ...request,
      platforms: ["LINKEDIN"],
      sources: selected,
      trend: null,
      trendId: null,
      focusTitle: null,
    });
    db.trend.create.mockResolvedValue({ id: "t-private" });
    db.researchBrief.upsert.mockResolvedValue({ id: "b1" });
    briefAi.generateSourcedBrief.mockResolvedValue({
      data: briefJson,
      raw,
      prompt: "brief-prompt",
    });

    const result = await runSourcedResearch({ requestId: "r1" });
    expect(result).toMatchObject({ success: true });
    expect(db.trend.create.mock.calls[0]![0]!.data).toMatchObject({
      profileId: PROFILE,
      topic: "Retailers deploy agents",
      sourceUrl: "https://news.example/a",
      status: "REVIEWED",
    });
    expect(db.researchRequest.updateMany.mock.calls[0]![0]).toEqual({
      where: { id: "r1", profileId: PROFILE },
      data: { trendId: "t-private" },
    });
    const update = db.researchBrief.update.mock.calls[0]![0]!.data;
    expect(update).toMatchObject({
      status: "COMPLETED",
      keyInsights: ["Retailers deploy agents"],
    });
    expect(update.evidence.findings[0].sources[0]).toMatchObject({
      ref: "S1",
      url: "https://news.example/a",
    });
    expect(db.researchAttempt.create.mock.calls[0]![0]!.data).toMatchObject({
      succeeded: true,
      prompt: "brief-prompt",
    });
  });

  it("records a failed attempt and marks the brief FAILED, retrying in place", async () => {
    db.researchRequest.findFirst.mockResolvedValue({
      ...request,
      platforms: ["LINKEDIN"],
      sources: selected,
      trendId: "t-private",
      focusTitle: null,
      trend: {
        researchBrief: {
          id: "b1",
          status: "FAILED",
          attempts: 1,
          startedAt: null,
        },
      },
    });
    db.researchBrief.upsert.mockResolvedValue({ id: "b1" });
    briefAi.generateSourcedBrief.mockRejectedValue(new Error("model down"));
    expect(await runSourcedResearch({ requestId: "r1" })).toEqual({
      error: "model down",
    });
    expect(db.trend.create).not.toHaveBeenCalled();
    expect(db.trend.updateMany.mock.calls[0]![0]!.where).toEqual({
      id: "t-private",
      profileId: PROFILE,
    });
    expect(db.researchBrief.upsert.mock.calls[0]![0]!.update).toMatchObject({
      status: "PROCESSING",
      attempts: 2,
    });
    expect(db.researchBrief.update.mock.calls[0]![0]!.data).toMatchObject({
      status: "FAILED",
    });
    expect(db.researchAttempt.create.mock.calls[0]![0]!.data).toMatchObject({
      attemptNumber: 2,
      succeeded: false,
    });
  });
});

describe("content steps", () => {
  const ready = {
    trendId: "t-private",
    platforms: ["LINKEDIN", "FACEBOOK", "INSTAGRAM"],
    trend: {
      profileId: PROFILE,
      researchBrief: { id: "b1", status: "COMPLETED" },
    },
  };

  it("requires a completed brief", async () => {
    db.researchRequest.findFirst.mockResolvedValue({
      ...ready,
      trend: {
        profileId: PROFILE,
        researchBrief: { id: "b1", status: "FAILED" },
      },
    });
    expect(
      await runStudioStep({ requestId: "r1", step: "plan" }),
    ).toHaveProperty("error");
    expect(pipeline.runPipelineStep).not.toHaveBeenCalled();
  });

  it("delegates to the existing pipeline and carries the platforms onto the plan", async () => {
    db.researchRequest.findFirst.mockResolvedValue(ready);
    pipeline.runPipelineStep.mockResolvedValue({ success: true });
    await runStudioStep({ requestId: "r1", step: "plan" });
    expect(pipeline.runPipelineStep).toHaveBeenCalledWith({
      trendId: "t-private",
      step: "plan",
    });
    expect(db.contentPlan.updateMany).toHaveBeenCalledWith({
      where: { researchId: "b1", profileId: PROFILE },
      data: { platforms: ["LINKEDIN", "FACEBOOK", "INSTAGRAM"] },
    });
  });

  it("creates only the selected Facebook/Instagram variants and skips completed ones", async () => {
    db.researchRequest.findFirst.mockResolvedValue(ready);
    db.contentPlan.findFirst.mockResolvedValue({
      draft: {
        id: "d1",
        status: "COMPLETED",
        platformVariants: [{ platform: "FACEBOOK", status: "COMPLETED" }],
      },
    });
    variants.generateVariantAction.mockResolvedValue({ success: true });
    expect(
      await runStudioStep({ requestId: "r1", step: "variants" }),
    ).toMatchObject({ success: true });
    expect(variants.generateVariantAction).toHaveBeenCalledTimes(1);
    expect(variants.generateVariantAction).toHaveBeenCalledWith({
      draftId: "d1",
      platform: "INSTAGRAM",
    });
  });

  it("reports variant failures for retry", async () => {
    db.researchRequest.findFirst.mockResolvedValue({
      ...ready,
      platforms: ["FACEBOOK"],
    });
    db.contentPlan.findFirst.mockResolvedValue({
      draft: { id: "d1", status: "COMPLETED", platformVariants: [] },
    });
    variants.generateVariantAction.mockResolvedValue({ error: "model down" });
    expect(await runStudioStep({ requestId: "r1", step: "variants" })).toEqual({
      error: "FACEBOOK: model down",
    });
  });

  it("never approves or publishes anything", async () => {
    db.researchRequest.findFirst.mockResolvedValue(ready);
    pipeline.runPipelineStep.mockResolvedValue({ success: true });
    for (const step of ["plan", "write", "review", "image"] as const) {
      await runStudioStep({ requestId: "r1", step });
    }
    const calls = JSON.stringify(
      vi.mocked(db.contentPlan.updateMany).mock.calls,
    );
    expect(calls).not.toMatch(/APPROVED|PUBLISHED/);
  });
});
