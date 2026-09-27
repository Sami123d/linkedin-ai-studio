import { describe, expect, it } from "vitest";

import { computeEngagementRate } from "@/features/analytics/utils";
import { toVectorLiteral } from "@/features/rag/vector";
import { checkWebhookSecret, secretsMatch } from "@/lib/webhook-auth";

describe("computeEngagementRate", () => {
  it("divides likes + comments + shares by impressions", () => {
    expect(
      computeEngagementRate({
        impressions: 200,
        likes: 10,
        comments: 5,
        shares: 5,
      }),
    ).toBe(0.1);
  });

  it("treats missing counts as zero", () => {
    expect(
      computeEngagementRate({
        impressions: 50,
        likes: 5,
        comments: null,
        shares: null,
      }),
    ).toBe(0.1);
  });

  it("returns null when impressions are unknown or zero", () => {
    const counts = { likes: 3, comments: 1, shares: 0 };
    expect(computeEngagementRate({ impressions: null, ...counts })).toBeNull();
    expect(computeEngagementRate({ impressions: 0, ...counts })).toBeNull();
  });
});

describe("toVectorLiteral", () => {
  it("formats an embedding as a pgvector literal", () => {
    expect(toVectorLiteral([0.1, -0.2, 3])).toBe("[0.1,-0.2,3]");
  });
});

describe("webhook secret checks", () => {
  it("matches only identical secrets", () => {
    expect(secretsMatch("abc123", "abc123")).toBe(true);
    expect(secretsMatch("abc124", "abc123")).toBe(false);
    expect(secretsMatch("abc", "abc123")).toBe(false);
  });

  it("reads the x-webhook-secret header", () => {
    const ok = new Request("http://localhost/x", {
      headers: { "x-webhook-secret": "s3cret-value" },
    });
    const missing = new Request("http://localhost/x");
    expect(checkWebhookSecret(ok, "s3cret-value")).toBe(true);
    expect(checkWebhookSecret(missing, "s3cret-value")).toBe(false);
  });
});
