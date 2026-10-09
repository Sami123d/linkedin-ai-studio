import { describe, expect, it, vi } from "vitest";

vi.mock("@/db/prisma", () => ({ prisma: {} }));

const { buildCleanupFilters, DEFAULT_RETENTION } =
  await import("@/features/cleanup/cleanup");

const now = new Date("2026-10-10T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

describe("buildCleanupFilters", () => {
  it("only targets untouched NEW/DISMISSED trends older than the retention", () => {
    const { untouchedTrends } = buildCleanupFilters({ now });
    expect(untouchedTrends).toEqual({
      status: { in: ["NEW", "DISMISSED"] },
      researchBrief: { is: null },
      createdAt: { lt: hoursAgo(DEFAULT_RETENTION.untouchedTrendDays * 24) },
    });
  });

  it("never selects pipelines that have an approved or published post", () => {
    const { failedPipelines, unapprovedPipelines } = buildCleanupFilters({
      now,
    });
    for (const filter of [failedPipelines, unapprovedPipelines]) {
      const keep = JSON.stringify(filter.NOT);
      expect(keep).toContain('"approvalStatus":"APPROVED"');
      expect(keep).toContain('"publishedAt":{"not":null}');
    }
  });

  it("measures pipeline age from when the pipeline started", () => {
    const { unapprovedPipelines } = buildCleanupFilters({ now });
    expect(unapprovedPipelines.researchBrief).toEqual({
      is: {
        createdAt: { lt: hoursAgo(DEFAULT_RETENTION.unapprovedDays * 24) },
      },
    });
  });

  it("treats FAILED and long-stuck PROCESSING stages as failed", () => {
    const { failedPipelines } = buildCleanupFilters({ now });
    const json = JSON.stringify(failedPipelines);
    const stuckBefore = hoursAgo(DEFAULT_RETENTION.stuckMinutes / 60);
    expect(json).toContain('{"status":"FAILED"}');
    expect(json).toContain(
      `{"status":"PROCESSING","updatedAt":{"lt":"${stuckBefore.toISOString()}"}}`,
    );
    // Every stage is covered: research, plan, draft, review, image.
    for (const relation of [
      "contentPlans",
      "draft",
      "qualityReview",
      "imageAsset",
    ]) {
      expect(json).toContain(`"${relation}"`);
    }
  });

  it("lets retention be overridden, e.g. 0 for a one-time full cleanup", () => {
    const { unapprovedPipelines, failedPipelines } = buildCleanupFilters({
      now,
      unapprovedDays: 0,
      failedHours: 0,
    });
    expect(unapprovedPipelines.researchBrief).toEqual({
      is: { createdAt: { lt: now } },
    });
    expect(JSON.stringify(failedPipelines)).toContain(
      `"createdAt":{"lt":"${now.toISOString()}"}`,
    );
  });
});
