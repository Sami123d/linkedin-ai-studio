import { describe, expect, it } from "vitest";

import {
  applyPublishResult,
  contentIssues,
  deriveDisplayState,
  MANUAL_CLAIMABLE,
  publishBlocker,
  type PublishableVariant,
} from "@/features/platforms/publish-state";
import {
  buildVariantFailureUpdate,
  buildVariantSuccessUpdate,
  EDIT_RESETS_PUBLISH,
} from "@/features/platforms/variant-state";
import { MetaApiError } from "@/lib/meta/graph";
import {
  publishVariantSchema,
  variantOptionsSchema,
} from "@/validation/platforms";
import { metaPublishRequestSchema } from "@/validation/scheduler";
import { summarize } from "../scripts/meta-publisher";

const now = new Date("2026-10-18T12:00:00Z");

function variant(over: Partial<PublishableVariant> = {}): PublishableVariant {
  return {
    platform: "FACEBOOK",
    status: "COMPLETED",
    approvalStatus: "APPROVED",
    publishStatus: "NOT_PUBLISHED",
    content: "Hello",
    hashtags: [],
    includeImage: false,
    linkUrl: null,
    mediaUrl: null,
    mediaSourceUrl: null,
    ...over,
  };
}

describe("publish eligibility (approval checks)", () => {
  it("allows an approved, completed, unpublished variant", () => {
    expect(publishBlocker(variant())).toBeNull();
  });

  it("blocks unapproved, rejected and incomplete variants", () => {
    expect(publishBlocker(variant({ approvalStatus: "PENDING" }))).toMatch(
      /approved/,
    );
    expect(publishBlocker(variant({ approvalStatus: "REJECTED" }))).toMatch(
      /approved/,
    );
    expect(publishBlocker(variant({ status: "FAILED" }))).toMatch(/completed/);
    expect(publishBlocker(variant({ content: "  " }))).toMatch(/completed/);
  });

  it("blocks duplicate publishing of PUBLISHING and PUBLISHED variants", () => {
    expect(publishBlocker(variant({ publishStatus: "PUBLISHING" }))).toMatch(
      /in progress/,
    );
    expect(publishBlocker(variant({ publishStatus: "PUBLISHED" }))).toMatch(
      /already published/,
    );
  });

  it("requires explicit acknowledgement to publish after an unconfirmed attempt", () => {
    const v = variant({ publishStatus: "UNCONFIRMED" });
    expect(publishBlocker(v)).toMatch(/may have gone live/);
    expect(publishBlocker(v, { acknowledgeUnconfirmed: true })).toBeNull();
  });

  it("allows retrying a FAILED variant", () => {
    expect(publishBlocker(variant({ publishStatus: "FAILED" }))).toBeNull();
    expect(MANUAL_CLAIMABLE).toEqual(["NOT_PUBLISHED", "FAILED"]);
    // The claim set excludes every state that must not publish again.
    expect(MANUAL_CLAIMABLE).not.toContain("PUBLISHING");
    expect(MANUAL_CLAIMABLE).not.toContain("PUBLISHED");
    expect(MANUAL_CLAIMABLE).not.toContain("UNCONFIRMED");
  });
});

describe("content and media validation", () => {
  it("requires a prepared image for Instagram", () => {
    const issues = contentIssues(
      variant({ platform: "INSTAGRAM", includeImage: true }),
      null,
    );
    expect(issues.join(" ")).toMatch(/need an image/);
  });

  it("rejects an Instagram image that changed after approval", () => {
    const v = variant({
      platform: "INSTAGRAM",
      includeImage: true,
      mediaUrl: "https://x.supabase.co/a.jpg",
      mediaSourceUrl: "https://old.example.com/a.png",
    });
    expect(contentIssues(v, "https://new.example.com/b.png").join(" ")).toMatch(
      /changed after approval/,
    );
    expect(contentIssues(v, "https://old.example.com/a.png")).toEqual([]);
  });

  it("enforces Instagram caption limits", () => {
    const v = variant({
      platform: "INSTAGRAM",
      includeImage: true,
      content: "x".repeat(2300),
      mediaUrl: "https://x/a.jpg",
      mediaSourceUrl: "https://s/a",
    });
    expect(contentIssues(v, "https://s/a").join(" ")).toMatch(/2200/);
  });

  it("allows text-only and link Facebook posts, but not link plus image", () => {
    expect(contentIssues(variant(), null)).toEqual([]);
    expect(
      contentIssues(variant({ linkUrl: "https://example.com" }), null),
    ).toEqual([]);
    expect(
      contentIssues(
        variant({
          linkUrl: "https://example.com",
          includeImage: true,
          mediaUrl: "https://x/a.jpg",
          mediaSourceUrl: "s",
        }),
        "s",
      ).join(" "),
    ).toMatch(/either a link or an image/);
  });
});

describe("status updates after a platform result", () => {
  it("marks PUBLISHED only for a published result, with id, link and timestamp", () => {
    const { variant: v, audit } = applyPublishResult(
      { kind: "published", postId: "1_2", permalink: "https://fb/1_2" },
      now,
      "facebook.publish",
    );
    expect(v).toMatchObject({
      publishStatus: "PUBLISHED",
      publishedAt: now,
      publishedPostId: "1_2",
      publishedUrl: "https://fb/1_2",
      publishError: null,
      igContainerId: null,
    });
    expect(audit.outcome).toBe("PUBLISHED");
  });

  it("failed results become FAILED with the safe message and are retryable", () => {
    const error = new MetaApiError("Meta denied the request.", "permission", {
      code: 200,
      write: true,
    });
    const { variant: v, audit } = applyPublishResult(
      { kind: "failed", error },
      now,
      "x",
    );
    expect(v.publishStatus).toBe("FAILED");
    expect(v.publishError).toBe("Meta denied the request.");
    expect("publishedAt" in v).toBe(false);
    expect(audit).toMatchObject({
      outcome: "FAILED",
      errorCategory: "permission",
      errorCode: 200,
    });
    expect(MANUAL_CLAIMABLE).toContain(v.publishStatus);
  });

  it("unconfirmed results are never PUBLISHED and block a blind retry", () => {
    const { variant: v } = applyPublishResult(
      {
        kind: "unconfirmed",
        error: null,
        message: "Timed out",
        containerId: "c1",
      },
      now,
      "x",
    );
    expect(v.publishStatus).toBe("UNCONFIRMED");
    expect(v).toMatchObject({ igContainerId: "c1" });
    expect("publishedAt" in v).toBe(false);
    expect(MANUAL_CLAIMABLE).not.toContain(v.publishStatus);
  });

  it("pending Instagram containers go back to NOT_PUBLISHED and keep the container", () => {
    const { variant: v } = applyPublishResult(
      { kind: "pending", containerId: "c1" },
      now,
      "x",
    );
    expect(v.publishStatus).toBe("NOT_PUBLISHED");
    expect(v.igContainerId).toBe("c1");
  });

  it("a failed container resets the saved container id", () => {
    const error = new MetaApiError("Container error", "rejected", {
      write: false,
    });
    const { variant: v } = applyPublishResult(
      { kind: "failed", error, resetContainer: true },
      now,
      "x",
    );
    expect(v).toMatchObject({ igContainerId: null });
  });
});

describe("approval reset and generation failures keep publish state consistent", () => {
  it("editing or regenerating clears publish state, container and prepared media", () => {
    expect(EDIT_RESETS_PUBLISH).toEqual({
      publishStatus: "NOT_PUBLISHED",
      publishError: null,
      igContainerId: null,
      mediaUrl: null,
      mediaSourceUrl: null,
    });
    const success = buildVariantSuccessUpdate({
      provider: "p",
      model: "m",
      content: "c",
      hashtags: [],
      now,
    });
    expect(success).toMatchObject({
      approvalStatus: "PENDING",
      scheduledFor: null,
      ...EDIT_RESETS_PUBLISH,
    });
  });

  it("a failed generation touches no content, approval or publish fields", () => {
    const update = buildVariantFailureUpdate("boom", now);
    expect(Object.keys(update).sort()).toEqual([
      "completedAt",
      "errorMessage",
      "status",
    ]);
  });
});

describe("display states", () => {
  const base = {
    approvalStatus: "APPROVED" as const,
    publishStatus: "NOT_PUBLISHED" as const,
    scheduledFor: null,
  };
  it("distinguishes approved, scheduled, publishing, published, failed and not connected", () => {
    const future = new Date(now.getTime() + 3600_000);
    expect(
      deriveDisplayState({ ...base, approvalStatus: "PENDING" }, true, now),
    ).toBe("NOT_APPROVED");
    expect(deriveDisplayState(base, false, now)).toBe("ACCOUNT_NOT_CONNECTED");
    expect(deriveDisplayState(base, true, now)).toBe("APPROVED");
    expect(
      deriveDisplayState({ ...base, scheduledFor: future }, true, now),
    ).toBe("SCHEDULED");
    expect(
      deriveDisplayState({ ...base, publishStatus: "PUBLISHING" }, true, now),
    ).toBe("PUBLISHING");
    expect(
      deriveDisplayState({ ...base, publishStatus: "PUBLISHED" }, false, now),
    ).toBe("PUBLISHED");
    expect(
      deriveDisplayState({ ...base, publishStatus: "FAILED" }, true, now),
    ).toBe("FAILED");
    expect(
      deriveDisplayState({ ...base, publishStatus: "UNCONFIRMED" }, true, now),
    ).toBe("UNCONFIRMED");
  });
});

describe("request validation", () => {
  it("validates the scheduler body", () => {
    expect(metaPublishRequestSchema.parse({}).limit).toBe(3);
    expect(metaPublishRequestSchema.safeParse({ limit: 0 }).success).toBe(
      false,
    );
    expect(metaPublishRequestSchema.safeParse({ limit: 11 }).success).toBe(
      false,
    );
    expect(metaPublishRequestSchema.safeParse({ limit: "3" }).success).toBe(
      false,
    );
  });

  it("validates publish-now input", () => {
    expect(
      publishVariantSchema.parse({ variantId: "v" }).acknowledgeUnconfirmed,
    ).toBe(false);
    expect(publishVariantSchema.safeParse({}).success).toBe(false);
  });

  it("validates Facebook options: https links only, blank means none", () => {
    expect(
      variantOptionsSchema.parse({
        variantId: "v",
        includeImage: false,
        linkUrl: "",
      }).linkUrl,
    ).toBeUndefined();
    expect(
      variantOptionsSchema.safeParse({
        variantId: "v",
        includeImage: false,
        linkUrl: "http://example.com",
      }).success,
    ).toBe(false);
    expect(
      variantOptionsSchema.safeParse({
        variantId: "v",
        includeImage: false,
        linkUrl: "javascript:alert(1)",
      }).success,
    ).toBe(false);
    expect(
      variantOptionsSchema.parse({
        variantId: "v",
        includeImage: false,
        linkUrl: "https://example.com/a",
      }).linkUrl,
    ).toBe("https://example.com/a");
  });
});

describe("Meta publisher script", () => {
  it("summarizes results and flags failures", () => {
    const ok = summarize({
      claimed: 1,
      results: [{ variantId: "v1", outcome: "published" }],
    });
    expect(ok.hasProblems).toBe(false);
    const bad = summarize({
      claimed: 2,
      results: [
        { variantId: "v1", outcome: "failed", message: "denied" },
        { variantId: "v2", outcome: "unconfirmed" },
      ],
    });
    expect(bad.hasProblems).toBe(true);
    expect(bad.lines[0]).toBe("v1: failed (denied)");
  });
});
