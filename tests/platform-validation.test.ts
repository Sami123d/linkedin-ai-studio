import { describe, expect, it } from "vitest";

import {
  composeCaption,
  validateVariantLimits,
} from "@/features/platforms/limits";
import {
  buildVariantFailureUpdate,
  buildVariantSuccessUpdate,
  parseHashtagInput,
} from "@/features/platforms/variant-state";
import {
  approveVariantSchema,
  generateVariantSchema,
  platformSelectionSchema,
  rejectVariantSchema,
  saveVariantSchema,
  variantContentSchema,
  variantPlatformSchema,
} from "@/validation/platforms";

describe("platform selection", () => {
  it("accepts a valid selection", () => {
    const r = platformSelectionSchema.safeParse({
      planId: "p1",
      platforms: ["LINKEDIN", "FACEBOOK", "INSTAGRAM"],
    });
    expect(r.success).toBe(true);
  });

  it("rejects empty, duplicate, and unknown platforms (incl. WhatsApp)", () => {
    for (const platforms of [[], ["FACEBOOK", "FACEBOOK"], ["WHATSAPP"]]) {
      expect(
        platformSelectionSchema.safeParse({ planId: "p1", platforms }).success,
      ).toBe(false);
    }
  });

  it("never allows LINKEDIN as a variant platform", () => {
    expect(variantPlatformSchema.safeParse("LINKEDIN").success).toBe(false);
    expect(
      generateVariantSchema.safeParse({ draftId: "d", platform: "LINKEDIN" })
        .success,
    ).toBe(false);
    expect(
      generateVariantSchema.safeParse({ draftId: "d", platform: "FACEBOOK" })
        .success,
    ).toBe(true);
  });
});

describe("platform limits", () => {
  it("accepts Instagram captions within 2200 chars and 30 hashtags", () => {
    expect(validateVariantLimits("INSTAGRAM", "x".repeat(2000), ["a"])).toEqual(
      [],
    );
  });

  it("counts hashtags toward the Instagram caption length", () => {
    const issues = validateVariantLimits("INSTAGRAM", "x".repeat(2195), [
      "abcdefgh",
    ]);
    expect(issues.join(" ")).toMatch(/2200/);
  });

  it("rejects more than 30 Instagram hashtags", () => {
    const tags = Array.from({ length: 31 }, (_, i) => `t${i}`);
    expect(validateVariantLimits("INSTAGRAM", "hi", tags).join(" ")).toMatch(
      /hashtags/,
    );
  });

  it("enforces the Facebook limits", () => {
    expect(validateVariantLimits("FACEBOOK", "x".repeat(63206), [])).toEqual(
      [],
    );
    expect(
      validateVariantLimits("FACEBOOK", "x".repeat(63207), []).length,
    ).toBe(1);
    const tags = Array.from({ length: 11 }, (_, i) => `t${i}`);
    expect(validateVariantLimits("FACEBOOK", "hi", tags).length).toBe(1);
  });

  it("composes body plus hashtags", () => {
    expect(composeCaption("Hello", ["a", "b"])).toBe("Hello\n\n#a #b");
    expect(composeCaption("Hello", [])).toBe("Hello");
  });
});

describe("structured variant output", () => {
  it("normalizes hashtags and defaults them", () => {
    const r = variantContentSchema.parse({
      content: " Hi ",
      hashtags: ["#One", " two ", "one", "#"],
    });
    expect(r.content).toBe("Hi");
    expect(r.hashtags).toEqual(["One", "two", "one"]);
    expect(variantContentSchema.parse({ content: "x" }).hashtags).toEqual([]);
  });

  it("rejects empty content", () => {
    expect(variantContentSchema.safeParse({ content: "  " }).success).toBe(
      false,
    );
  });

  it("parses hashtag text input", () => {
    expect(parseHashtagInput("#a, b  #c")).toEqual(["#a", "b", "#c"]);
  });
});

describe("save / approve / reject validation", () => {
  it("requires non-empty content on save", () => {
    expect(
      saveVariantSchema.safeParse({
        variantId: "v",
        content: " ",
        hashtags: [],
      }).success,
    ).toBe(false);
    expect(
      saveVariantSchema.parse({
        variantId: "v",
        content: "ok",
        hashtags: ["#a"],
      }).hashtags,
    ).toEqual(["a"]);
  });

  it("requires a valid future date to approve", () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const past = new Date(Date.now() - 3_600_000).toISOString();
    expect(
      approveVariantSchema.safeParse({ variantId: "v", scheduledFor: future })
        .success,
    ).toBe(true);
    expect(
      approveVariantSchema.safeParse({ variantId: "v", scheduledFor: past })
        .success,
    ).toBe(false);
    expect(
      approveVariantSchema.safeParse({ variantId: "v", scheduledFor: "nope" })
        .success,
    ).toBe(false);
  });

  it("defaults and bounds the rejection reason", () => {
    expect(rejectVariantSchema.parse({ variantId: "v" }).reason).toBe("");
    expect(
      rejectVariantSchema.safeParse({ variantId: "v", reason: "x".repeat(501) })
        .success,
    ).toBe(false);
  });
});

describe("variant state updates", () => {
  it("failure update never touches saved content or approval", () => {
    const update = buildVariantFailureUpdate("boom", new Date());
    expect(update.status).toBe("FAILED");
    expect(update.errorMessage).toBe("boom");
    for (const key of [
      "content",
      "hashtags",
      "approvalStatus",
      "scheduledFor",
      "publishStatus",
    ]) {
      expect(key in update).toBe(false);
    }
  });

  it("success update replaces content and resets approval and publish state", () => {
    const update = buildVariantSuccessUpdate({
      provider: "p",
      model: "m",
      content: "c",
      hashtags: ["a"],
      now: new Date(),
    });
    expect(update.status).toBe("COMPLETED");
    expect(update.errorMessage).toBeNull();
    expect(update.approvalStatus).toBe("PENDING");
    expect(update.scheduledFor).toBeNull();
    expect(update.publishStatus).toBe("NOT_PUBLISHED");
    expect(update.igContainerId).toBeNull();
  });
});
