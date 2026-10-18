import { beforeEach, describe, expect, it, vi } from "vitest";

// Server actions run against a mocked Prisma client and mocked Meta layer.
// These tests check authorization scoping and the duplicate-publish guard;
// they do not exercise a real database or real Meta.

const PROFILE = "11111111-1111-1111-1111-111111111111";

const db = vi.hoisted(() => ({
  platformVariant: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn(),
  },
  metaConnection: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  draft: { findFirst: vi.fn() },
  contentPlan: { updateMany: vi.fn() },
}));
const publish = vi.hoisted(() => ({
  executePublish: vi.fn(),
  reconcileVariant: vi.fn(),
  graphDeps: vi.fn(() => ({ version: "v25.0" })),
  sweepStalePublishing: vi.fn(async () => ({ count: 0 })),
}));
const media = vi.hoisted(() => ({
  prepareMetaImage: vi.fn(async () => "https://x.supabase.co/new.jpg"),
  MediaPreparationError: class extends Error {},
  deletePublishMedia: vi.fn(async () => undefined),
  sweepPublishedMedia: vi.fn(async () => undefined),
}));
const oauth = vi.hoisted(() => ({ fetchPages: vi.fn() }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/db/prisma", () => ({ prisma: db }));
vi.mock("@/features/knowledge-base/session", () => ({
  requireProfileId: vi.fn(async () => PROFILE),
}));
vi.mock("@/config/env.server", () => ({
  serverEnv: {
    META_APP_ID: "app",
    META_APP_SECRET: "secret",
    TOKEN_ENCRYPTION_KEY: "a".repeat(64),
    META_GRAPH_API_VERSION: "v25.0",
  },
}));
vi.mock("@/config/env.client", () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: "https://app.example.com" },
}));
vi.mock("@/features/platforms/publish", () => publish);
vi.mock("@/features/platforms/media", () => media);
vi.mock("@/features/platforms/media-cleanup", () => media);
vi.mock("@/ai/providers", () => ({ getAIProvider: vi.fn() }));
vi.mock("@/ai/writing/generate-variant", () => ({
  generateVariant: vi.fn(),
  VariantGenerationError: class extends Error {},
}));
vi.mock("@/features/rag/retrieve", () => ({ retrieveRelevantChunks: vi.fn() }));
vi.mock("@/lib/crypto/token-crypto", () => ({
  encryptToken: (t: string) => `enc(${t})`,
  decryptToken: (t: string) => t.replace(/^enc\((.*)\)$/, "$1"),
}));
vi.mock("@/lib/meta/oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/meta/oauth")>()),
  fetchPages: oauth.fetchPages,
}));

import {
  approveVariant,
  generateVariantAction,
  publishVariantNow,
  rejectVariant,
  saveVariant,
} from "@/features/platforms/actions";
import {
  disconnectMeta,
  getMetaConnectionStatus,
  selectMetaPage,
} from "@/features/platforms/meta-actions";

function variantRow(over: Record<string, unknown> = {}) {
  return {
    id: "v1",
    profileId: PROFILE,
    platform: "FACEBOOK",
    status: "COMPLETED",
    approvalStatus: "APPROVED",
    publishStatus: "NOT_PUBLISHED",
    content: "Hello",
    hashtags: [],
    includeImage: false,
    linkUrl: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ownership scoping", () => {
  it("looks variants up through profileId AND the draft's content plan owner", async () => {
    db.platformVariant.findFirst.mockResolvedValue(null);
    expect(
      await saveVariant({ variantId: "v1", content: "x", hashtags: [] }),
    ).toEqual({
      error: "Variant not found.",
    });
    expect(db.platformVariant.findFirst).toHaveBeenCalledWith({
      where: {
        id: "v1",
        profileId: PROFILE,
        draft: { contentPlan: { profileId: PROFILE } },
      },
    });
    expect(db.platformVariant.updateMany).not.toHaveBeenCalled();
  });

  it("another profile's variant can't be rejected, published or approved", async () => {
    db.platformVariant.findFirst.mockResolvedValue(null);
    expect(
      await rejectVariant({ variantId: "other", reason: "" }),
    ).toMatchObject({ error: "Variant not found." });
    expect(await publishVariantNow({ variantId: "other" })).toMatchObject({
      error: "Variant not found.",
    });
    expect(
      await approveVariant({
        variantId: "other",
        scheduledFor: new Date(Date.now() + 3600_000).toISOString(),
      }),
    ).toMatchObject({ error: "Variant not found." });
    expect(publish.executePublish).not.toHaveBeenCalled();
    expect(db.platformVariant.updateMany).not.toHaveBeenCalled();
  });

  it("scopes mutations by profileId", async () => {
    db.platformVariant.findFirst.mockResolvedValue(
      variantRow({ approvalStatus: "PENDING" }),
    );
    db.platformVariant.updateMany.mockResolvedValue({ count: 1 });
    await rejectVariant({ variantId: "v1", reason: "no" });
    expect(db.platformVariant.updateMany.mock.calls[0]![0].where).toMatchObject(
      {
        id: "v1",
        profileId: PROFILE,
      },
    );
  });

  it("only generates for drafts owned through the content plan", async () => {
    db.draft.findFirst.mockResolvedValue(null);
    expect(
      await generateVariantAction({ draftId: "d1", platform: "FACEBOOK" }),
    ).toEqual({
      error: "Draft not found.",
    });
    expect(db.draft.findFirst.mock.calls[0]![0].where).toEqual({
      id: "d1",
      contentPlan: { profileId: PROFILE },
    });
    expect(db.platformVariant.upsert).not.toHaveBeenCalled();
  });

  it("rejects LINKEDIN as a variant platform before touching the database", async () => {
    expect(
      await generateVariantAction({ draftId: "d1", platform: "LINKEDIN" }),
    ).toMatchObject({ error: expect.any(String) });
    expect(db.draft.findFirst).not.toHaveBeenCalled();
  });
});

describe("publish now", () => {
  const connection = { id: "c1", status: "CONNECTED", pageId: "p1" };

  it("refuses unapproved variants without claiming them", async () => {
    db.platformVariant.findFirst.mockResolvedValue(
      variantRow({ approvalStatus: "PENDING" }),
    );
    expect(await publishVariantNow({ variantId: "v1" })).toMatchObject({
      error: expect.stringMatching(/approved/),
    });
    expect(db.platformVariant.updateMany).not.toHaveBeenCalled();
    expect(publish.executePublish).not.toHaveBeenCalled();
  });

  it("refuses when no Page is connected", async () => {
    db.platformVariant.findFirst.mockResolvedValue(variantRow());
    db.metaConnection.findUnique.mockResolvedValue(null);
    expect(await publishVariantNow({ variantId: "v1" })).toMatchObject({
      error: expect.stringMatching(/Connect a Meta account/),
    });
    expect(publish.executePublish).not.toHaveBeenCalled();
  });

  it("refuses when the connection needs re-authorization", async () => {
    db.platformVariant.findFirst.mockResolvedValue(variantRow());
    db.metaConnection.findUnique.mockResolvedValue({
      ...connection,
      status: "NEEDS_REAUTH",
    });
    expect(await publishVariantNow({ variantId: "v1" })).toMatchObject({
      error: expect.stringMatching(/Reconnect/),
    });
    expect(publish.executePublish).not.toHaveBeenCalled();
  });

  it("claims with one conditional update, then publishes and reports success only on 'published'", async () => {
    db.platformVariant.findFirst.mockResolvedValue(variantRow());
    db.metaConnection.findUnique.mockResolvedValue(connection);
    db.platformVariant.updateMany.mockResolvedValue({ count: 1 });
    publish.executePublish.mockResolvedValue({ outcome: "published" });

    expect(await publishVariantNow({ variantId: "v1" })).toEqual({
      success: true,
      message: "Published.",
    });

    const claim = db.platformVariant.updateMany.mock.calls[0]![0];
    expect(claim.where).toMatchObject({
      id: "v1",
      profileId: PROFILE,
      approvalStatus: "APPROVED",
      publishStatus: { in: ["NOT_PUBLISHED", "FAILED"] },
    });
    expect(claim.data).toMatchObject({ publishStatus: "PUBLISHING" });
    expect(publish.executePublish).toHaveBeenCalledWith("v1", PROFILE);
  });

  it("does not publish when another caller already claimed the variant (duplicate protection)", async () => {
    db.platformVariant.findFirst.mockResolvedValue(variantRow());
    db.metaConnection.findUnique.mockResolvedValue(connection);
    db.platformVariant.updateMany.mockResolvedValue({ count: 0 });
    expect(await publishVariantNow({ variantId: "v1" })).toMatchObject({
      error: expect.stringMatching(/already being published/),
    });
    expect(publish.executePublish).not.toHaveBeenCalled();
  });

  it("blocks PUBLISHED and in-flight variants before the claim", async () => {
    db.platformVariant.findFirst.mockResolvedValue(
      variantRow({ publishStatus: "PUBLISHED" }),
    );
    expect(await publishVariantNow({ variantId: "v1" })).toMatchObject({
      error: expect.stringMatching(/already published/),
    });
    db.platformVariant.findFirst.mockResolvedValue(
      variantRow({ publishStatus: "PUBLISHING" }),
    );
    expect(await publishVariantNow({ variantId: "v1" })).toMatchObject({
      error: expect.stringMatching(/in progress/),
    });
    expect(db.platformVariant.updateMany).not.toHaveBeenCalled();
  });

  it("an unconfirmed variant needs acknowledgement, then may be claimed from UNCONFIRMED", async () => {
    db.platformVariant.findFirst.mockResolvedValue(
      variantRow({ publishStatus: "UNCONFIRMED" }),
    );
    db.metaConnection.findUnique.mockResolvedValue(connection);
    expect(await publishVariantNow({ variantId: "v1" })).toMatchObject({
      error: expect.stringMatching(/may have gone live/),
    });
    expect(db.platformVariant.updateMany).not.toHaveBeenCalled();

    db.platformVariant.updateMany.mockResolvedValue({ count: 1 });
    publish.executePublish.mockResolvedValue({ outcome: "published" });
    await publishVariantNow({ variantId: "v1", acknowledgeUnconfirmed: true });
    expect(
      db.platformVariant.updateMany.mock.calls[0]![0].where.publishStatus,
    ).toEqual({
      in: ["NOT_PUBLISHED", "FAILED", "UNCONFIRMED"],
    });
  });

  it("never reports success for failed, pending or unconfirmed outcomes", async () => {
    db.platformVariant.findFirst.mockResolvedValue(variantRow());
    db.metaConnection.findUnique.mockResolvedValue(connection);
    db.platformVariant.updateMany.mockResolvedValue({ count: 1 });

    for (const summary of [
      { outcome: "failed", message: "Meta denied the request." },
      { outcome: "pending", message: "Still processing." },
      { outcome: "unconfirmed", message: "Timed out." },
    ]) {
      publish.executePublish.mockResolvedValue(summary);
      const result = await publishVariantNow({ variantId: "v1" });
      expect(result).toHaveProperty("error");
      expect(result).not.toHaveProperty("success");
    }
  });
});

describe("editing is locked while publishing, published or unconfirmed", () => {
  it.each(["PUBLISHING", "PUBLISHED", "UNCONFIRMED"])(
    "%s variants can't be edited",
    async (publishStatus) => {
      db.platformVariant.findFirst.mockResolvedValue(
        variantRow({ publishStatus }),
      );
      const result = await saveVariant({
        variantId: "v1",
        content: "new",
        hashtags: [],
      });
      expect(result).toHaveProperty("error");
      expect(db.platformVariant.updateMany).not.toHaveBeenCalled();
    },
  );

  it("the edit update also carries the publish-state guard against races", async () => {
    db.platformVariant.findFirst.mockResolvedValue(
      variantRow({ approvalStatus: "PENDING" }),
    );
    db.platformVariant.updateMany.mockResolvedValue({ count: 1 });
    await saveVariant({ variantId: "v1", content: "new", hashtags: [] });
    expect(
      db.platformVariant.updateMany.mock.calls[0]![0].where.publishStatus,
    ).toEqual({
      notIn: ["PUBLISHING", "PUBLISHED", "UNCONFIRMED"],
    });
    expect(db.platformVariant.updateMany.mock.calls[0]![0].data).toMatchObject({
      approvalStatus: "PENDING",
      publishStatus: "NOT_PUBLISHED",
      igContainerId: null,
    });
  });
});

describe("prepared media cleanup", () => {
  it("deletes the previous prepared image after an edit", async () => {
    db.platformVariant.findFirst.mockResolvedValue(
      variantRow({
        approvalStatus: "PENDING",
        mediaUrl: "https://x.supabase.co/old.jpg",
      }),
    );
    db.platformVariant.updateMany.mockResolvedValue({ count: 1 });
    await saveVariant({ variantId: "v1", content: "new", hashtags: [] });
    expect(media.deletePublishMedia).toHaveBeenCalledWith(PROFILE, [
      "https://x.supabase.co/old.jpg",
    ]);
  });

  it("deletes nothing when the edit lost a race against a publish", async () => {
    db.platformVariant.findFirst.mockResolvedValue(
      variantRow({
        approvalStatus: "PENDING",
        mediaUrl: "https://x.supabase.co/old.jpg",
      }),
    );
    db.platformVariant.updateMany.mockResolvedValue({ count: 0 });
    await saveVariant({ variantId: "v1", content: "new", hashtags: [] });
    expect(media.deletePublishMedia).not.toHaveBeenCalled();
  });

  it("rejecting clears the prepared image reference and deletes the file", async () => {
    db.platformVariant.findFirst.mockResolvedValue(
      variantRow({ mediaUrl: "https://x.supabase.co/old.jpg" }),
    );
    db.platformVariant.updateMany.mockResolvedValue({ count: 1 });
    await rejectVariant({ variantId: "v1", reason: "no" });
    expect(db.platformVariant.updateMany.mock.calls[0]![0].data).toMatchObject({
      mediaUrl: null,
      mediaSourceUrl: null,
    });
    expect(media.deletePublishMedia).toHaveBeenCalledWith(PROFILE, [
      "https://x.supabase.co/old.jpg",
    ]);
  });

  it("an unrecorded publish result never reports success and is not retried", async () => {
    db.platformVariant.findFirst.mockResolvedValue(variantRow());
    db.metaConnection.findUnique.mockResolvedValue({
      id: "c1",
      status: "CONNECTED",
      pageId: "p1",
    });
    db.platformVariant.updateMany.mockResolvedValue({ count: 1 });
    publish.executePublish.mockRejectedValue(new Error("db down"));
    const result = await publishVariantNow({ variantId: "v1" });
    expect(result).toHaveProperty("error");
    expect(result).not.toHaveProperty("success");
    expect(publish.executePublish).toHaveBeenCalledTimes(1);
  });
});

describe("Page selection", () => {
  const connectionRow = {
    id: "c1",
    profileId: PROFILE,
    status: "CONNECTED",
    userTokenEnc: "enc(user-token)",
    userTokenExpiresAt: new Date(Date.now() + 86400_000),
  };
  const page = (over = {}) => ({
    id: "p1",
    name: "My Page",
    accessToken: "page-token",
    tasks: ["CREATE_CONTENT"],
    instagram: { id: "ig1", username: "me" },
    ...over,
  });

  it("only accepts a Page that Meta lists for this user's token", async () => {
    db.metaConnection.findUnique.mockResolvedValue(connectionRow);
    oauth.fetchPages.mockResolvedValue([page()]);
    expect(await selectMetaPage({ pageId: "someone-elses-page" })).toEqual({
      error: "That Page isn't available to your Meta account.",
    });
    expect(db.metaConnection.updateMany).not.toHaveBeenCalled();
    expect(oauth.fetchPages).toHaveBeenCalledWith(
      "user-token",
      expect.anything(),
    );
  });

  it("refuses a Page where the user can't create content", async () => {
    db.metaConnection.findUnique.mockResolvedValue(connectionRow);
    oauth.fetchPages.mockResolvedValue([page({ tasks: ["ANALYZE"] })]);
    expect(await selectMetaPage({ pageId: "p1" })).toMatchObject({
      error: expect.stringMatching(/CREATE_CONTENT/),
    });
  });

  it("stores the Page token encrypted, scoped to the profile, with the linked Instagram account", async () => {
    db.metaConnection.findUnique.mockResolvedValue(connectionRow);
    oauth.fetchPages.mockResolvedValue([page()]);
    const result = await selectMetaPage({ pageId: "p1" });
    expect(result).toMatchObject({ success: true });
    const call = db.metaConnection.updateMany.mock.calls[0]![0];
    expect(call.where).toEqual({ profileId: PROFILE });
    expect(call.data.pageTokenEnc).toBe("enc(page-token)");
    expect(JSON.stringify(call.data)).not.toContain('"page-token"');
    expect(call.data).toMatchObject({
      pageId: "p1",
      instagramAccountId: "ig1",
    });
  });

  it("handles a Page without a linked Instagram account", async () => {
    db.metaConnection.findUnique.mockResolvedValue(connectionRow);
    oauth.fetchPages.mockResolvedValue([page({ instagram: null })]);
    const result = await selectMetaPage({ pageId: "p1" });
    expect(result).toMatchObject({
      success: true,
      message: expect.stringMatching(/No Instagram/),
    });
    expect(
      db.metaConnection.updateMany.mock.calls[0]![0].data.instagramAccountId,
    ).toBeNull();
  });

  it("asks to reconnect when the Meta login expired", async () => {
    db.metaConnection.findUnique.mockResolvedValue({
      ...connectionRow,
      userTokenExpiresAt: new Date(Date.now() - 1000),
    });
    expect(await selectMetaPage({ pageId: "p1" })).toMatchObject({
      error: expect.stringMatching(/expired/),
    });
    expect(oauth.fetchPages).not.toHaveBeenCalled();
  });
});

describe("connection status view", () => {
  it("never includes tokens, only safe fields", async () => {
    db.metaConnection.findUnique.mockResolvedValue({
      status: "CONNECTED",
      metaUserName: "Ada",
      pageId: "p1",
      pageName: "My Page",
      instagramAccountId: "ig1",
      instagramUsername: "ada",
      grantedScopes: ["pages_show_list"],
      userTokenExpiresAt: new Date(Date.now() + 86400_000),
      lastError: null,
      userTokenEnc: "enc(SECRET-USER)",
      pageTokenEnc: "enc(SECRET-PAGE)",
    });
    const view = await getMetaConnectionStatus();
    const text = JSON.stringify(view);
    expect(text).not.toMatch(/SECRET/);
    expect(text).not.toContain("secret");
    expect(view.configured).toBe(true);
    expect(view.connection?.missingScopes).toContain(
      "instagram_content_publish",
    );
    expect(view.redirectUri).toBe("https://app.example.com/auth/meta/callback");
  });

  it("disconnect deletes only the caller's connection", async () => {
    await disconnectMeta();
    expect(db.metaConnection.deleteMany).toHaveBeenCalledWith({
      where: { profileId: PROFILE },
    });
  });
});
