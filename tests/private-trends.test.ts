import { beforeEach, describe, expect, it, vi } from "vitest";

// Private (Research Studio) trends must never leak through the shared trend,
// research, planning and pipeline views or actions.

const PROFILE = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

const db = vi.hoisted(() => ({
  trend: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
  researchBrief: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
  contentPlan: { findUnique: vi.fn() },
}));
const stages = vi.hoisted(() => ({
  runContentPlan: vi.fn(),
  runDraft: vi.fn(),
  runQualityReview: vi.fn(),
  runImageGeneration: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/features/knowledge-base/session", () => ({
  requireProfileId: vi.fn(async () => PROFILE),
}));
vi.mock("@/db/prisma", () => ({ prisma: db }));
vi.mock("@/ai/providers", () => ({ getAIProvider: vi.fn() }));
vi.mock("@/features/rag/retrieve", () => ({ retrieveRelevantChunks: vi.fn() }));
vi.mock("@/features/research-studio/context", () => ({
  loadCreativeContext: vi.fn(),
}));
vi.mock("@/features/writing/actions", () => ({ runDraft: stages.runDraft }));
vi.mock("@/features/review/actions", () => ({
  runQualityReview: stages.runQualityReview,
}));
vi.mock("@/features/images/actions", () => ({
  runImageGeneration: stages.runImageGeneration,
}));

import { runPipelineStep } from "@/features/pipeline/actions";
import { listPlanningQueue, runContentPlan } from "@/features/planning/actions";
import { listResearchQueue, runResearch } from "@/features/research/actions";
import { listTrends, updateTrendStatus } from "@/features/trends/actions";

beforeEach(() => {
  vi.clearAllMocks();
  db.trend.findMany.mockResolvedValue([]);
  db.researchBrief.findMany.mockResolvedValue([]);
  db.trend.updateMany.mockResolvedValue({ count: 0 });
});

describe("shared views exclude private trends", () => {
  it("Trends page lists only the shared pool", async () => {
    await listTrends();
    expect(db.trend.findMany.mock.calls[0]![0].where).toEqual({
      profileId: null,
    });
  });

  it("trend status changes only apply to shared trends", async () => {
    expect(await updateTrendStatus("t-private", "DISMISSED")).toEqual({
      error: "Trend not found.",
    });
    expect(db.trend.updateMany.mock.calls[0]![0].where).toEqual({
      id: "t-private",
      profileId: null,
    });
  });

  it("the classic research queue lists only shared trends", async () => {
    await listResearchQueue();
    expect(db.trend.findMany.mock.calls[0]![0].where).toEqual({
      status: "REVIEWED",
      profileId: null,
    });
  });

  it("the planning queue shows shared briefs and only the caller's private ones", async () => {
    await listPlanningQueue();
    expect(db.researchBrief.findMany.mock.calls[0]![0].where).toEqual({
      status: "COMPLETED",
      trend: { OR: [{ profileId: null }, { profileId: PROFILE }] },
    });
  });
});

describe("actions refuse other profiles' private trends", () => {
  it("classic research refuses private trends (theirs or ours)", async () => {
    db.trend.findUnique.mockResolvedValue({
      id: "t",
      profileId: OTHER,
      status: "REVIEWED",
    });
    expect(await runResearch("t")).toEqual({ error: "Trend not found." });
    db.trend.findUnique.mockResolvedValue({
      id: "t",
      profileId: PROFILE,
      status: "REVIEWED",
    });
    expect(await runResearch("t")).toEqual({
      error: "Research this topic from its sources in Research Studio.",
    });
    expect(db.researchBrief.upsert).not.toHaveBeenCalled();
  });

  it("planning refuses another profile's private brief", async () => {
    db.researchBrief.findUnique.mockResolvedValue({
      id: "b",
      status: "COMPLETED",
      trend: { profileId: OTHER, topic: "x" },
    });
    expect(await runContentPlan("b")).toEqual({
      error: "Research brief not found.",
    });
  });

  it("the pipeline refuses another profile's private trend at every step", async () => {
    db.trend.findUnique.mockResolvedValue({ profileId: OTHER });
    for (const step of [
      "research",
      "plan",
      "write",
      "review",
      "image",
    ] as const) {
      expect(await runPipelineStep({ trendId: "t", step })).toEqual({
        error: "Trend not found.",
      });
    }
    expect(stages.runDraft).not.toHaveBeenCalled();
  });

  it("the pipeline runs the caller's own private trend", async () => {
    db.trend.findUnique
      .mockResolvedValueOnce({ profileId: PROFILE })
      .mockResolvedValueOnce({
        id: "t",
        status: "REVIEWED",
        researchBrief: { status: "COMPLETED" },
      });
    expect(
      await runPipelineStep({ trendId: "t", step: "research" }),
    ).toMatchObject({ success: true });
  });
});
