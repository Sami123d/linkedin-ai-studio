import { describe, expect, it } from "vitest";

import { analyticsWebhookBodySchema } from "@/validation/analytics";
import { qualityReviewSchema } from "@/validation/review";
import { publishCallbackSchema } from "@/validation/scheduler";
import { trendWebhookBodySchema } from "@/validation/trends";

describe("trendWebhookBodySchema", () => {
  it("accepts a single trend and converts publishedAt to a Date", () => {
    const parsed = trendWebhookBodySchema.parse({
      topic: "  Server Components  ",
      sourceUrl: "https://example.com/post",
      publishedAt: "2026-08-01T10:00:00Z",
    });
    if (Array.isArray(parsed)) throw new Error("expected a single trend");
    expect(parsed.topic).toBe("Server Components");
    expect(parsed.publishedAt).toBeInstanceOf(Date);
    expect(parsed.publishedAt?.toISOString()).toBe("2026-08-01T10:00:00.000Z");
  });

  it("accepts a batch and an empty-string sourceUrl", () => {
    const parsed = trendWebhookBodySchema.parse([
      { topic: "A", sourceUrl: "" },
      { topic: "B", score: 12.5, category: "AI" },
    ]);
    expect(parsed).toHaveLength(2);
  });

  it("rejects a blank topic and a malformed URL", () => {
    expect(trendWebhookBodySchema.safeParse({ topic: "   " }).success).toBe(
      false,
    );
    expect(
      trendWebhookBodySchema.safeParse({ topic: "x", sourceUrl: "not a url" })
        .success,
    ).toBe(false);
  });
});

describe("analyticsWebhookBodySchema", () => {
  it("defaults capturedAt to now when omitted", () => {
    const before = Date.now();
    const parsed = analyticsWebhookBodySchema.parse({
      scheduledPostId: "post_1",
      likes: 4,
    });
    if (Array.isArray(parsed)) throw new Error("expected a single snapshot");
    expect(parsed.capturedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(parsed.impressions).toBeUndefined();
  });

  it("rejects negative or fractional counts", () => {
    expect(
      analyticsWebhookBodySchema.safeParse({ scheduledPostId: "p", likes: -1 })
        .success,
    ).toBe(false);
    expect(
      analyticsWebhookBodySchema.safeParse({
        scheduledPostId: "p",
        comments: 1.5,
      }).success,
    ).toBe(false);
  });
});

describe("publishCallbackSchema", () => {
  it("requires scheduledPostId and success", () => {
    expect(publishCallbackSchema.safeParse({ success: true }).success).toBe(
      false,
    );
    expect(
      publishCallbackSchema.safeParse({
        scheduledPostId: "p1",
        success: true,
        publishedUrl: "https://www.linkedin.com/feed/update/urn:li:share:1",
      }).success,
    ).toBe(true);
  });
});

describe("qualityReviewSchema", () => {
  const valid = {
    verdict: "APPROVED",
    hookScore: 80,
    clarityScore: 75,
    voiceMatchScore: 90,
    valueScore: 70,
    ctaScore: 60,
    strengths: ["Strong hook"],
    feedback: ["Tighten the CTA"],
  };

  it("accepts a well-formed review", () => {
    expect(qualityReviewSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects out-of-range scores and unknown verdicts", () => {
    expect(
      qualityReviewSchema.safeParse({ ...valid, hookScore: 101 }).success,
    ).toBe(false);
    expect(
      qualityReviewSchema.safeParse({ ...valid, verdict: "MAYBE" }).success,
    ).toBe(false);
  });
});
