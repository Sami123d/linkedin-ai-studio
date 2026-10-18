import { describe, expect, it, vi } from "vitest";

import { aspectCrop } from "@/features/platforms/media-geometry";
import {
  classifyGraphError,
  MetaApiError,
  type GraphDeps,
} from "@/lib/meta/graph";
import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  fetchPages,
} from "@/lib/meta/oauth";
import {
  publishFacebookPost,
  publishInstagramImage,
  reconcileFacebook,
  reconcileInstagram,
} from "@/lib/meta/publish-api";

// All Meta responses below are mocked. Passing these tests proves the
// request/response handling, NOT that live publishing works.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

function scripted(responses: (Response | Error)[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: URL | string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    if (next instanceof Error) throw next;
    return next;
  });
  const deps: GraphDeps = {
    version: "v25.0",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  };
  return { deps, calls };
}

const timeout = () => new DOMException("timed out", "TimeoutError");
const graphError = (code: number, status = 400, subcode?: number) =>
  json(
    {
      error: {
        message: "raw provider text",
        code,
        error_subcode: subcode,
        fbtrace_id: "T1",
      },
    },
    status,
  );

describe("error classification", () => {
  it("maps invalid/expired tokens to auth (reconnect), never leaking raw text", () => {
    const e = classifyGraphError({
      httpStatus: 400,
      code: 190,
      subcode: 463,
      write: true,
    });
    expect(e.category).toBe("auth");
    expect(e.needsReconnect).toBe(true);
    expect(e.safeMessage).not.toMatch(/raw provider/);
  });

  it("maps permission and rate-limit codes", () => {
    expect(
      classifyGraphError({ httpStatus: 400, code: 200, write: true }).category,
    ).toBe("permission");
    expect(
      classifyGraphError({ httpStatus: 400, code: 10, write: true }).category,
    ).toBe("permission");
    expect(
      classifyGraphError({ httpStatus: 400, code: 4, write: true }).category,
    ).toBe("rate_limit");
    expect(
      classifyGraphError({ httpStatus: 400, code: 17, write: true }).category,
    ).toBe("rate_limit");
  });

  it("treats a definitive rejection as not ambiguous but a 5xx write as ambiguous", () => {
    expect(
      classifyGraphError({ httpStatus: 400, code: 100, write: true }).ambiguous,
    ).toBe(false);
    expect(classifyGraphError({ httpStatus: 500, write: true }).ambiguous).toBe(
      true,
    );
    expect(
      classifyGraphError({ httpStatus: 500, write: false }).ambiguous,
    ).toBe(false);
  });
});

describe("OAuth token exchange", () => {
  it("exchanges the code, then the short-lived token for a long-lived one", async () => {
    const { deps, calls } = scripted([
      json({ access_token: "short", expires_in: 3600 }),
      json({ access_token: "long", expires_in: 5183944 }),
    ]);
    const short = await exchangeCodeForToken(
      { appId: "1", appSecret: "s", redirectUri: "https://x/cb", code: "c" },
      deps,
    );
    const long = await exchangeForLongLivedToken(
      { appId: "1", appSecret: "s", shortLivedToken: short.token },
      deps,
    );
    expect(long.token).toBe("long");
    expect(long.expiresAt!.getTime()).toBeGreaterThan(
      Date.now() + 50 * 86400_000,
    );
    expect(calls[0]!.url).toContain("/v25.0/oauth/access_token");
    expect(calls[1]!.url).toContain("grant_type=fb_exchange_token");
  });

  it("rejects a response without an access token", async () => {
    const { deps } = scripted([json({})]);
    await expect(
      exchangeCodeForToken(
        { appId: "1", appSecret: "s", redirectUri: "r", code: "c" },
        deps,
      ),
    ).rejects.toBeInstanceOf(MetaApiError);
  });

  it("lists Pages with their Instagram account and tasks", async () => {
    const { deps, calls } = scripted([
      json({
        data: [
          {
            id: "p1",
            name: "My Page",
            access_token: "page-token",
            tasks: ["CREATE_CONTENT"],
            instagram_business_account: { id: "ig1", username: "me" },
          },
          { id: "p2", name: "No IG", access_token: "t2", tasks: [] },
        ],
      }),
    ]);
    const pages = await fetchPages("user-token", deps);
    expect(pages).toHaveLength(2);
    expect(pages[0]!.instagram).toEqual({ id: "ig1", username: "me" });
    expect(pages[1]!.instagram).toBeNull();
    expect(calls[0]!.url).toContain("me/accounts");
    expect(calls[0]!.url).toContain("instagram_business_account");
  });
});

describe("Facebook Page publishing", () => {
  it("posts text to /feed with the Page token in the body, not the URL", async () => {
    const { deps, calls } = scripted([
      json({ id: "123_456" }),
      json({ permalink_url: "https://www.facebook.com/123/posts/456" }),
    ]);
    const result = await publishFacebookPost(
      { pageId: "123", pageToken: "PAGE-TOKEN", message: "Hello" },
      deps,
    );
    expect(result).toEqual({
      kind: "published",
      postId: "123_456",
      permalink: "https://www.facebook.com/123/posts/456",
    });
    expect(calls[0]!.url).toBe("https://graph.facebook.com/v25.0/123/feed");
    expect(calls[0]!.init?.method).toBe("POST");
    const body = String(calls[0]!.init?.body);
    expect(body).toContain("message=Hello");
    expect(body).toContain("access_token=PAGE-TOKEN");
    expect(calls[0]!.url).not.toContain("PAGE-TOKEN");
  });

  it("sends a link post to /feed with the link parameter", async () => {
    const { deps, calls } = scripted([json({ id: "1_2" }), json({})]);
    await publishFacebookPost(
      {
        pageId: "1",
        pageToken: "t",
        message: "Read",
        link: "https://example.com/a",
      },
      deps,
    );
    expect(String(calls[0]!.init?.body)).toContain(
      "link=https%3A%2F%2Fexample.com%2Fa",
    );
  });

  it("sends a photo post to /photos with the image url and uses post_id", async () => {
    const { deps, calls } = scripted([
      json({ id: "photo9", post_id: "1_77" }),
      json({}),
    ]);
    const result = await publishFacebookPost(
      {
        pageId: "1",
        pageToken: "t",
        message: "Pic",
        photoUrl: "https://cdn.example.com/a.jpg",
      },
      deps,
    );
    expect(calls[0]!.url).toBe("https://graph.facebook.com/v25.0/1/photos");
    expect(String(calls[0]!.init?.body)).toContain(
      "url=https%3A%2F%2Fcdn.example.com%2Fa.jpg",
    );
    expect(result).toMatchObject({ kind: "published", postId: "1_77" });
  });

  it("is still published (without link) when only the permalink lookup fails", async () => {
    const { deps } = scripted([json({ id: "1_2" }), graphError(1, 500)]);
    const result = await publishFacebookPost(
      { pageId: "1", pageToken: "t", message: "x" },
      deps,
    );
    expect(result).toEqual({
      kind: "published",
      postId: "1_2",
      permalink: undefined,
    });
  });

  it("reports an invalid token as a definitive failure needing reconnect", async () => {
    const { deps } = scripted([graphError(190, 401, 463)]);
    const result = await publishFacebookPost(
      { pageId: "1", pageToken: "t", message: "x" },
      deps,
    );
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.error.needsReconnect).toBe(true);
      expect(result.error.safeMessage).not.toMatch(/raw provider/);
    }
  });

  it("reports missing permissions as a definitive failure", async () => {
    const { deps } = scripted([graphError(200, 403)]);
    const result = await publishFacebookPost(
      { pageId: "1", pageToken: "t", message: "x" },
      deps,
    );
    expect(result).toMatchObject({ kind: "failed" });
    if (result.kind === "failed")
      expect(result.error.category).toBe("permission");
  });

  it("treats a timeout as UNCONFIRMED, not failed (no blind retry)", async () => {
    const { deps } = scripted([timeout()]);
    const result = await publishFacebookPost(
      { pageId: "1", pageToken: "t", message: "x" },
      deps,
    );
    expect(result.kind).toBe("unconfirmed");
  });

  it("treats a 5xx on the write as UNCONFIRMED", async () => {
    const { deps } = scripted([json({}, 503)]);
    const result = await publishFacebookPost(
      { pageId: "1", pageToken: "t", message: "x" },
      deps,
    );
    expect(result.kind).toBe("unconfirmed");
  });

  it("treats a 2xx without an id as UNCONFIRMED, never as published", async () => {
    const { deps } = scripted([json({ success: true })]);
    const result = await publishFacebookPost(
      { pageId: "1", pageToken: "t", message: "x" },
      deps,
    );
    expect(result.kind).toBe("unconfirmed");
  });

  it("treats rate limiting as a definitive failure", async () => {
    const { deps } = scripted([graphError(4, 429)]);
    const result = await publishFacebookPost(
      { pageId: "1", pageToken: "t", message: "x" },
      deps,
    );
    expect(result.kind).toBe("failed");
  });
});

const ig = {
  igId: "ig1",
  token: "T",
  imageUrl: "https://cdn.example.com/a.jpg",
  caption: "Hi #tag",
};
const fast = { sleep: async () => {}, pollIntervalMs: 1, maxWaitMs: 3 };

describe("Instagram publishing", () => {
  it("creates a container, waits for FINISHED, publishes and fetches the permalink", async () => {
    const { deps, calls } = scripted([
      json({ id: "c1" }),
      json({ status_code: "IN_PROGRESS" }),
      json({ status_code: "FINISHED" }),
      json({ id: "m1" }),
      json({ permalink: "https://www.instagram.com/p/abc/" }),
    ]);
    const result = await publishInstagramImage(ig, deps, fast);
    expect(result).toEqual({
      kind: "published",
      postId: "m1",
      permalink: "https://www.instagram.com/p/abc/",
    });
    expect(calls[0]!.url).toBe("https://graph.facebook.com/v25.0/ig1/media");
    expect(String(calls[0]!.init?.body)).toContain("image_url=");
    expect(String(calls[0]!.init?.body)).toContain("caption=Hi");
    expect(calls[1]!.url).toContain("/c1?");
    expect(calls[1]!.url).toContain("fields=status_code");
    expect(calls[3]!.url).toBe(
      "https://graph.facebook.com/v25.0/ig1/media_publish",
    );
    expect(String(calls[3]!.init?.body)).toContain("creation_id=c1");
  });

  it("never publishes while the container is not FINISHED (pending, container kept)", async () => {
    const { deps, calls } = scripted([
      json({ id: "c1" }),
      json({ status_code: "IN_PROGRESS" }),
      json({ status_code: "IN_PROGRESS" }),
      json({ status_code: "IN_PROGRESS" }),
      json({ status_code: "IN_PROGRESS" }),
    ]);
    const result = await publishInstagramImage(ig, deps, fast);
    expect(result).toEqual({ kind: "pending", containerId: "c1" });
    expect(calls.some((c) => c.url.endsWith("media_publish"))).toBe(false);
  });

  it("resumes an existing container instead of creating another", async () => {
    const { deps, calls } = scripted([
      json({ status_code: "FINISHED" }),
      json({ id: "m2" }),
      json({}),
    ]);
    const result = await publishInstagramImage(
      { ...ig, containerId: "c9" },
      deps,
      fast,
    );
    expect(result).toMatchObject({ kind: "published", postId: "m2" });
    expect(calls.some((c) => c.url.endsWith("/ig1/media"))).toBe(false);
  });

  it("fails and resets the container when processing errors (unsupported media)", async () => {
    const { deps } = scripted([
      json({ id: "c1" }),
      json({ status_code: "ERROR" }),
    ]);
    const result = await publishInstagramImage(ig, deps, fast);
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") expect(result.resetContainer).toBe(true);
  });

  it("fails and resets an EXPIRED container", async () => {
    const { deps } = scripted([json({ status_code: "EXPIRED" })]);
    const result = await publishInstagramImage(
      { ...ig, containerId: "old" },
      deps,
      fast,
    );
    expect(result).toMatchObject({ kind: "failed", resetContainer: true });
  });

  it("does not call media_publish for a container that is already PUBLISHED", async () => {
    const { deps, calls } = scripted([json({ status_code: "PUBLISHED" })]);
    const result = await publishInstagramImage(
      { ...ig, containerId: "c1" },
      deps,
      fast,
    );
    expect(result.kind).toBe("unconfirmed");
    expect(calls.some((c) => c.url.endsWith("media_publish"))).toBe(false);
  });

  it("reports unavailable media (Meta rejects the image URL) as a definitive failure", async () => {
    const { deps } = scripted([graphError(100, 400)]);
    const result = await publishInstagramImage(ig, deps, fast);
    expect(result.kind).toBe("failed");
  });

  it("treats a container-creation timeout as failed (nothing was published)", async () => {
    const { deps } = scripted([timeout()]);
    const result = await publishInstagramImage(ig, deps, fast);
    expect(result.kind).toBe("failed");
  });

  it("treats a media_publish timeout as UNCONFIRMED and keeps the container id", async () => {
    const { deps } = scripted([
      json({ id: "c1" }),
      json({ status_code: "FINISHED" }),
      timeout(),
    ]);
    const result = await publishInstagramImage(ig, deps, fast);
    expect(result).toMatchObject({ kind: "unconfirmed", containerId: "c1" });
  });

  it("treats media_publish without a media id as UNCONFIRMED", async () => {
    const { deps } = scripted([
      json({ id: "c1" }),
      json({ status_code: "FINISHED" }),
      json({}),
    ]);
    const result = await publishInstagramImage(ig, deps, fast);
    expect(result.kind).toBe("unconfirmed");
  });

  it("reports an invalid token on publish as failed needing reconnect", async () => {
    const { deps } = scripted([
      json({ id: "c1" }),
      json({ status_code: "FINISHED" }),
      graphError(190, 400, 467),
    ]);
    const result = await publishInstagramImage(ig, deps, fast);
    expect(result.kind).toBe("failed");
    if (result.kind === "failed")
      expect(result.error.needsReconnect).toBe(true);
  });
});

describe("reconciliation after an unconfirmed outcome", () => {
  const since = new Date("2026-10-18T10:00:00Z");

  it("finds a matching Facebook post by text and time", async () => {
    const { deps } = scripted([
      json({
        data: [
          {
            id: "1_9",
            message: "Other",
            created_time: "2026-10-18T10:00:30+0000",
          },
          {
            id: "1_10",
            message: "Hello",
            created_time: "2026-10-18T10:00:40+0000",
            permalink_url: "https://www.facebook.com/1/posts/10",
          },
        ],
      }),
    ]);
    const r = await reconcileFacebook(
      { pageId: "1", token: "t", message: "Hello", since },
      deps,
    );
    expect(r).toEqual({
      kind: "found",
      postId: "1_10",
      permalink: "https://www.facebook.com/1/posts/10",
    });
  });

  it("reports not_found when nothing matches", async () => {
    const { deps } = scripted([json({ data: [] })]);
    expect(
      await reconcileFacebook(
        { pageId: "1", token: "t", message: "Hello", since },
        deps,
      ),
    ).toEqual({ kind: "not_found" });
  });

  it("returns unknown (not not_found) when the platform can't be queried", async () => {
    const { deps } = scripted([graphError(190, 400, 463)]);
    expect(
      (
        await reconcileFacebook(
          { pageId: "1", token: "t", message: "Hello", since },
          deps,
        )
      ).kind,
    ).toBe("unknown");
  });

  it("Instagram: a container that is not PUBLISHED proves nothing was posted", async () => {
    const { deps, calls } = scripted([json({ status_code: "FINISHED" })]);
    const r = await reconcileInstagram(
      { igId: "ig1", token: "t", containerId: "c1", caption: "Hi", since },
      deps,
    );
    expect(r.kind).toBe("not_found");
    expect(calls).toHaveLength(1);
  });

  it("Instagram: matches the published media by caption and time", async () => {
    const { deps } = scripted([
      json({ status_code: "PUBLISHED" }),
      json({
        data: [
          {
            id: "m1",
            caption: "Hi",
            timestamp: "2026-10-18T10:01:00+0000",
            permalink: "https://www.instagram.com/p/x/",
          },
        ],
      }),
    ]);
    const r = await reconcileInstagram(
      { igId: "ig1", token: "t", containerId: "c1", caption: "Hi", since },
      deps,
    );
    expect(r).toMatchObject({ kind: "found", postId: "m1" });
  });
});

describe("Instagram image geometry", () => {
  it("leaves images inside 4:5 to 1.91:1 alone", () => {
    expect(aspectCrop(1080, 1080)).toBeNull();
    expect(aspectCrop(1080, 1350)).toBeNull();
  });

  it("crops the 1200x627 branded image, which is slightly too wide", () => {
    const crop = aspectCrop(1200, 627)!;
    expect(1200 / 627).toBeGreaterThan(1.91);
    expect(crop.width / crop.height).toBeLessThanOrEqual(1.91);
    expect(crop.height).toBe(627);
  });

  it("crops very tall images to 4:5", () => {
    const crop = aspectCrop(1000, 2000)!;
    expect(crop.width / crop.height).toBeGreaterThanOrEqual(0.8 - 0.001);
  });
});
