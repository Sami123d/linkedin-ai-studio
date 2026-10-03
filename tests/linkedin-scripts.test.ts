import { describe, expect, it } from "vitest";

import { publishCallbackSchema } from "@/validation/scheduler";
import { analyticsWebhookBodySchema } from "@/validation/analytics";

import { extractUrn, toSnapshot } from "../scripts/linkedin-analytics";
import {
  buildPostText,
  buildUgcPost,
  postUrl,
} from "../scripts/linkedin-publisher";

describe("LinkedIn publisher", () => {
  it("builds the post body with hashtags", () => {
    expect(
      buildPostText({
        scheduledPostId: "p1",
        content: "Hello",
        hashtags: ["AI", "#nextjs"],
      }),
    ).toBe("Hello\n\n#AI #nextjs");
  });

  it("joins carousel slides into a numbered post when there is no body", () => {
    expect(
      buildPostText({
        scheduledPostId: "p1",
        content: "",
        slides: ["One", "Two"],
      }),
    ).toBe("1. One\n\n2. Two");
  });

  it("caps the text at LinkedIn's 3000 characters", () => {
    expect(
      buildPostText({ scheduledPostId: "p1", content: "x".repeat(4000) }),
    ).toHaveLength(3000);
  });

  it("builds text-only and image ugcPosts bodies", () => {
    const text = buildUgcPost("urn:li:person:abc", "Hi");
    expect(
      text.specificContent["com.linkedin.ugc.ShareContent"].shareMediaCategory,
    ).toBe("NONE");
    expect(
      text.specificContent["com.linkedin.ugc.ShareContent"],
    ).not.toHaveProperty("media");

    const image = buildUgcPost(
      "urn:li:person:abc",
      "Hi",
      "urn:li:digitalmediaAsset:1",
      "Topic",
    );
    expect(
      image.specificContent["com.linkedin.ugc.ShareContent"],
    ).toMatchObject({
      shareMediaCategory: "IMAGE",
      media: [
        {
          status: "READY",
          media: "urn:li:digitalmediaAsset:1",
          title: { text: "Topic" },
        },
      ],
    });
  });

  it("reports results in the shape /api/scheduler/publish accepts", () => {
    const ok = {
      scheduledPostId: "p1",
      success: true,
      publishedUrl: postUrl("urn:li:share:123"),
    };
    const failed = { scheduledPostId: "p1", success: false, error: "HTTP 401" };
    expect(publishCallbackSchema.safeParse(ok).success).toBe(true);
    expect(publishCallbackSchema.safeParse(failed).success).toBe(true);
  });
});

describe("LinkedIn analytics", () => {
  it("pulls the URN out of a published post URL", () => {
    expect(
      extractUrn("https://www.linkedin.com/feed/update/urn:li:share:7123"),
    ).toBe("urn:li:share:7123");
    expect(extractUrn(null)).toBeNull();
  });

  it("keeps only the metrics LinkedIn returned and matches the webhook schema", () => {
    const at = new Date("2026-10-01T08:00:00Z");
    const full = toSnapshot(
      "p1",
      {
        likesSummary: { totalLikes: 12 },
        commentsSummary: { aggregatedTotalComments: 3 },
      },
      at,
    );
    expect(full).toEqual({
      scheduledPostId: "p1",
      capturedAt: "2026-10-01T08:00:00.000Z",
      likes: 12,
      comments: 3,
    });

    const likesOnly = toSnapshot("p2", { likesSummary: { totalLikes: 4 } }, at);
    expect(likesOnly).not.toHaveProperty("comments");
    expect(
      analyticsWebhookBodySchema.safeParse([full, likesOnly]).success,
    ).toBe(true);
  });
});
