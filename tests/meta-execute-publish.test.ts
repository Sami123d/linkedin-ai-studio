import { beforeEach, describe, expect, it, vi } from "vitest";

// executePublish with mocked Prisma and a mocked Meta API layer. Proves the
// orchestration (claim release, audit rows, reauth marking, no publish on
// invalid state), not that live Meta publishing works.

const PROFILE = "11111111-1111-1111-1111-111111111111";

type WriteArgs = { where?: object; data: Record<string, unknown> };

const db = vi.hoisted(() => ({
  platformVariant: {
    findFirst: vi.fn(),
    updateMany: vi.fn<(args: WriteArgs) => Promise<{ count: number }>>(
      async () => ({ count: 1 }),
    ),
  },
  variantPublishAttempt: {
    create: vi.fn<(args: WriteArgs) => Promise<object>>(async () => ({})),
  },
  metaConnection: {
    findUnique: vi.fn(),
    updateMany: vi.fn<(args: WriteArgs) => Promise<{ count: number }>>(
      async () => ({ count: 1 }),
    ),
  },
  $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
}));
const api = vi.hoisted(() => ({
  publishFacebookPost: vi.fn(),
  publishInstagramImage: vi.fn(),
  reconcileFacebook: vi.fn(),
  reconcileInstagram: vi.fn(),
}));

vi.mock("@/config/env.server", () => ({
  serverEnv: { META_GRAPH_API_VERSION: "v25.0" },
}));
vi.mock("@/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/crypto/token-crypto", () => ({
  decryptToken: (t: string) => {
    if (t === "bad") throw new Error("nope");
    return t.replace(/^enc\((.*)\)$/, "$1");
  },
}));
vi.mock("@/lib/meta/publish-api", () => api);
const cleanup = vi.hoisted(() => ({
  cleanupAfterPublish: vi.fn<
    (variantId: string, profileId: string) => Promise<void>
  >(async () => undefined),
}));
vi.mock("@/features/platforms/media-cleanup", () => cleanup);

import { executePublish } from "@/features/platforms/publish";
import { MetaApiError } from "@/lib/meta/graph";

const connection = {
  id: "c1",
  status: "CONNECTED",
  pageId: "p1",
  pageTokenEnc: "enc(PAGE-TOKEN)",
  instagramAccountId: "ig1",
};

function variant(over: Record<string, unknown> = {}, image: unknown = null) {
  return {
    id: "v1",
    platform: "FACEBOOK",
    status: "COMPLETED",
    approvalStatus: "APPROVED",
    publishStatus: "PUBLISHING",
    publishAttempts: 1,
    content: "Hello",
    hashtags: ["a"],
    includeImage: false,
    linkUrl: null,
    mediaUrl: null,
    mediaSourceUrl: null,
    igContainerId: null,
    draft: { imageAsset: image },
    ...over,
  };
}

const lastVariantUpdate = () =>
  (
    db.platformVariant.updateMany.mock.calls.at(-1) as unknown as [
      { where: object; data: Record<string, unknown> },
    ]
  )[0];
const lastAudit = () =>
  (
    db.variantPublishAttempt.create.mock.calls.at(-1) as unknown as [
      { data: Record<string, unknown> },
    ]
  )[0].data;

beforeEach(() => {
  vi.clearAllMocks();
  db.metaConnection.findUnique.mockResolvedValue(connection);
});

describe("executePublish", () => {
  it("publishes a Facebook text post with the decrypted Page token and records PUBLISHED", async () => {
    db.platformVariant.findFirst.mockResolvedValue(variant());
    api.publishFacebookPost.mockResolvedValue({
      kind: "published",
      postId: "p1_9",
      permalink: "https://fb/p1_9",
    });

    const summary = await executePublish("v1", PROFILE);

    expect(summary).toEqual({ outcome: "published", url: "https://fb/p1_9" });
    expect(api.publishFacebookPost.mock.calls[0]![0]).toMatchObject({
      pageId: "p1",
      pageToken: "PAGE-TOKEN",
      message: "Hello\n\n#a",
    });
    expect(lastVariantUpdate().where).toEqual({ id: "v1", profileId: PROFILE });
    expect(lastVariantUpdate().data).toMatchObject({
      publishStatus: "PUBLISHED",
      publishedPostId: "p1_9",
      publishedUrl: "https://fb/p1_9",
      targetAccountId: "p1",
    });
    expect(lastAudit()).toMatchObject({
      outcome: "PUBLISHED",
      platformPostId: "p1_9",
      attemptNumber: 1,
    });
  });

  it("looks the variant up through profileId and the draft's content plan", async () => {
    db.platformVariant.findFirst.mockResolvedValue(null);
    expect(await executePublish("v1", PROFILE)).toMatchObject({
      outcome: "failed",
    });
    expect(db.platformVariant.findFirst.mock.calls[0]![0].where).toEqual({
      id: "v1",
      profileId: PROFILE,
      draft: { contentPlan: { profileId: PROFILE } },
    });
    expect(api.publishFacebookPost).not.toHaveBeenCalled();
  });

  it("releases the claim as FAILED (retryable) when no Page is connected", async () => {
    db.platformVariant.findFirst.mockResolvedValue(variant());
    db.metaConnection.findUnique.mockResolvedValue(null);
    const summary = await executePublish("v1", PROFILE);
    expect(summary.outcome).toBe("failed");
    expect(lastVariantUpdate().data).toMatchObject({ publishStatus: "FAILED" });
    expect(api.publishFacebookPost).not.toHaveBeenCalled();
  });

  it("fails without calling Meta when the connection needs reauthorization", async () => {
    db.platformVariant.findFirst.mockResolvedValue(variant());
    db.metaConnection.findUnique.mockResolvedValue({
      ...connection,
      status: "NEEDS_REAUTH",
    });
    expect((await executePublish("v1", PROFILE)).outcome).toBe("failed");
    expect(api.publishFacebookPost).not.toHaveBeenCalled();
  });

  it("fails when the stored token can't be decrypted and flags the connection", async () => {
    db.platformVariant.findFirst.mockResolvedValue(variant());
    db.metaConnection.findUnique.mockResolvedValue({
      ...connection,
      pageTokenEnc: "bad",
    });
    const summary = await executePublish("v1", PROFILE);
    expect(summary).toMatchObject({
      outcome: "failed",
      message: expect.stringMatching(/Reconnect/),
    });
    expect(db.metaConnection.updateMany.mock.calls[0]![0].data).toMatchObject({
      status: "NEEDS_REAUTH",
    });
    expect(api.publishFacebookPost).not.toHaveBeenCalled();
  });

  it("refuses Instagram without a linked Instagram account", async () => {
    db.platformVariant.findFirst.mockResolvedValue(
      variant(
        {
          platform: "INSTAGRAM",
          includeImage: true,
          mediaUrl: "https://x/a.jpg",
          mediaSourceUrl: "https://s/a",
        },
        { status: "COMPLETED", url: "https://s/a" },
      ),
    );
    db.metaConnection.findUnique.mockResolvedValue({
      ...connection,
      instagramAccountId: null,
    });
    expect(await executePublish("v1", PROFILE)).toMatchObject({
      outcome: "failed",
      message: expect.stringMatching(/no linked Instagram/i),
    });
    expect(api.publishInstagramImage).not.toHaveBeenCalled();
  });

  it("refuses Instagram when the campaign image changed after approval", async () => {
    db.platformVariant.findFirst.mockResolvedValue(
      variant(
        {
          platform: "INSTAGRAM",
          includeImage: true,
          mediaUrl: "https://x/a.jpg",
          mediaSourceUrl: "https://old/a",
        },
        { status: "COMPLETED", url: "https://new/b" },
      ),
    );
    expect(await executePublish("v1", PROFILE)).toMatchObject({
      outcome: "failed",
      message: expect.stringMatching(/changed after approval/),
    });
    expect(api.publishInstagramImage).not.toHaveBeenCalled();
  });

  it("refuses Instagram when no media was prepared (text-only is not publishable)", async () => {
    db.platformVariant.findFirst.mockResolvedValue(
      variant({ platform: "INSTAGRAM", includeImage: true }),
    );
    expect(await executePublish("v1", PROFILE)).toMatchObject({
      outcome: "failed",
      message: expect.stringMatching(/need an image/),
    });
    expect(api.publishInstagramImage).not.toHaveBeenCalled();
  });

  it("publishes Instagram with the prepared JPEG URL and resumes a saved container", async () => {
    db.platformVariant.findFirst.mockResolvedValue(
      variant(
        {
          platform: "INSTAGRAM",
          includeImage: true,
          mediaUrl: "https://x/a.jpg",
          mediaSourceUrl: "https://s/a",
          igContainerId: "c7",
        },
        { status: "COMPLETED", url: "https://s/a" },
      ),
    );
    api.publishInstagramImage.mockResolvedValue({
      kind: "published",
      postId: "m1",
      permalink: "https://ig/p/x",
    });
    const summary = await executePublish("v1", PROFILE);
    expect(summary).toMatchObject({ outcome: "published" });
    expect(api.publishInstagramImage.mock.calls[0]![0]).toMatchObject({
      igId: "ig1",
      token: "PAGE-TOKEN",
      imageUrl: "https://x/a.jpg",
      containerId: "c7",
    });
    expect(lastVariantUpdate().data).toMatchObject({
      publishStatus: "PUBLISHED",
      publishedPostId: "m1",
      igContainerId: null,
      targetAccountId: "ig1",
    });
  });

  it("marks the connection NEEDS_REAUTH when Meta rejects the token", async () => {
    db.platformVariant.findFirst.mockResolvedValue(variant());
    api.publishFacebookPost.mockResolvedValue({
      kind: "failed",
      error: new MetaApiError("Reconnect your Meta account.", "auth", {
        code: 190,
        write: true,
      }),
    });
    const summary = await executePublish("v1", PROFILE);
    expect(summary).toMatchObject({
      outcome: "failed",
      message: "Reconnect your Meta account.",
    });
    expect(lastVariantUpdate().data).toMatchObject({ publishStatus: "FAILED" });
    expect(db.metaConnection.updateMany.mock.calls[0]![0]).toMatchObject({
      where: { id: "c1", profileId: PROFILE },
      data: { status: "NEEDS_REAUTH" },
    });
  });

  it("records an ambiguous result as UNCONFIRMED and never as published", async () => {
    db.platformVariant.findFirst.mockResolvedValue(variant());
    api.publishFacebookPost.mockResolvedValue({
      kind: "unconfirmed",
      error: null,
      message: "Meta did not respond in time.",
    });
    const summary = await executePublish("v1", PROFILE);
    expect(summary.outcome).toBe("unconfirmed");
    expect(lastVariantUpdate().data).toMatchObject({
      publishStatus: "UNCONFIRMED",
    });
    expect(lastVariantUpdate().data).not.toHaveProperty("publishedAt");
    expect(lastAudit()).toMatchObject({ outcome: "UNCONFIRMED" });
  });

  it("treats an unexpected exception during the platform call as UNCONFIRMED", async () => {
    db.platformVariant.findFirst.mockResolvedValue(variant());
    api.publishFacebookPost.mockRejectedValue(new Error("boom"));
    const summary = await executePublish("v1", PROFILE);
    expect(summary.outcome).toBe("unconfirmed");
    expect(lastVariantUpdate().data).toMatchObject({
      publishStatus: "UNCONFIRMED",
    });
  });

  it("keeps the Instagram container when processing is still pending", async () => {
    db.platformVariant.findFirst.mockResolvedValue(
      variant(
        {
          platform: "INSTAGRAM",
          includeImage: true,
          mediaUrl: "https://x/a.jpg",
          mediaSourceUrl: "https://s/a",
        },
        { status: "COMPLETED", url: "https://s/a" },
      ),
    );
    api.publishInstagramImage.mockResolvedValue({
      kind: "pending",
      containerId: "c3",
    });
    const summary = await executePublish("v1", PROFILE);
    expect(summary.outcome).toBe("pending");
    expect(lastVariantUpdate().data).toMatchObject({
      publishStatus: "NOT_PUBLISHED",
      igContainerId: "c3",
    });
  });

  it("never puts the token in anything it records", async () => {
    db.platformVariant.findFirst.mockResolvedValue(variant());
    api.publishFacebookPost.mockResolvedValue({
      kind: "published",
      postId: "p1_9",
    });
    await executePublish("v1", PROFILE);
    const recorded = JSON.stringify([
      db.platformVariant.updateMany.mock.calls,
      db.variantPublishAttempt.create.mock.calls,
    ]);
    expect(recorded).not.toContain("PAGE-TOKEN");
  });

  it("cleans up temporary media after a confirmed publish (manual or scheduled)", async () => {
    db.platformVariant.findFirst.mockResolvedValue(variant());
    api.publishFacebookPost.mockResolvedValue({
      kind: "published",
      postId: "p1_9",
    });
    await executePublish("v1", PROFILE);
    expect(cleanup.cleanupAfterPublish).toHaveBeenCalledWith("v1", PROFILE);
  });

  it("does not clean up media for failed, unconfirmed or pending outcomes", async () => {
    db.platformVariant.findFirst.mockResolvedValue(variant());
    for (const result of [
      { kind: "unconfirmed", error: null, message: "?" },
      {
        kind: "failed",
        error: new MetaApiError("x", "rejected", { write: true }),
      },
    ]) {
      api.publishFacebookPost.mockResolvedValue(result);
      await executePublish("v1", PROFILE);
    }
    expect(cleanup.cleanupAfterPublish).not.toHaveBeenCalled();
  });

  it("a cleanup failure never turns a confirmed publish into a failure", async () => {
    db.platformVariant.findFirst.mockResolvedValue(variant());
    api.publishFacebookPost.mockResolvedValue({
      kind: "published",
      postId: "p1_9",
    });
    cleanup.cleanupAfterPublish.mockRejectedValueOnce(
      new Error("storage down"),
    );
    const summary = await executePublish("v1", PROFILE);
    expect(summary.outcome).toBe("published");
    expect(lastVariantUpdate().data).toMatchObject({
      publishStatus: "PUBLISHED",
    });
  });
});
