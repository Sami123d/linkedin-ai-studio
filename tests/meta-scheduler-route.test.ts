import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  serverEnv: {
    META_PUBLISH_WEBHOOK_SECRET: "meta-secret-0123456789" as string | undefined,
  },
}));
const db = vi.hoisted(() => ({
  platformVariant: { updateMany: vi.fn() },
  $queryRaw: vi.fn(),
}));
const publish = vi.hoisted(() => ({
  executePublish: vi.fn(),
  sweepStalePublishing: vi.fn(async () => ({ count: 0 })),
}));

vi.mock("@/config/env.server", () => env);
vi.mock("@/db/prisma", () => ({ prisma: db }));
vi.mock("@/features/platforms/publish", () => publish);
const cleanup = vi.hoisted(() => ({
  runBackgroundMediaCleanup: vi.fn(async () => undefined),
}));
vi.mock("@/features/platforms/media-cleanup", () => cleanup);

import { POST } from "@/app/api/scheduler/meta-publish/route";

function request(opts: { secret?: string; body?: string } = {}) {
  return new Request("https://app.example.com/api/scheduler/meta-publish", {
    method: "POST",
    headers: opts.secret ? { "x-webhook-secret": opts.secret } : {},
    body: opts.body,
  });
}

const SECRET = "meta-secret-0123456789";

beforeEach(() => {
  vi.clearAllMocks();
  env.serverEnv.META_PUBLISH_WEBHOOK_SECRET = SECRET;
  db.platformVariant.updateMany.mockResolvedValue({ count: 0 });
  db.$queryRaw.mockResolvedValue([]);
});

describe("POST /api/scheduler/meta-publish", () => {
  it("is disabled (503) when no secret is configured, and does nothing", async () => {
    env.serverEnv.META_PUBLISH_WEBHOOK_SECRET = undefined;
    const res = await POST(request({ secret: "anything" }));
    expect(res.status).toBe(503);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it("rejects a missing or wrong secret before touching the database", async () => {
    expect((await POST(request())).status).toBe(401);
    expect(
      (await POST(request({ secret: "wrong-secret-0123456789" }))).status,
    ).toBe(401);
    expect((await POST(request({ secret: "short" }))).status).toBe(401);
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.platformVariant.updateMany).not.toHaveBeenCalled();
    expect(publish.executePublish).not.toHaveBeenCalled();
  });

  it("validates the request body", async () => {
    expect(
      (await POST(request({ secret: SECRET, body: "not json" }))).status,
    ).toBe(400);
    expect(
      (await POST(request({ secret: SECRET, body: '{"limit":0}' }))).status,
    ).toBe(400);
    expect(
      (await POST(request({ secret: SECRET, body: '{"limit":99}' }))).status,
    ).toBe(400);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it("accepts an empty body and returns an empty result when nothing is due", async () => {
    const res = await POST(request({ secret: SECRET }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ claimed: 0, results: [] });
  });

  it("turns stale in-flight claims into UNCONFIRMED instead of retrying them", async () => {
    await POST(request({ secret: SECRET }));
    // Global sweep (no profile filter), run before claiming new work.
    expect(publish.sweepStalePublishing).toHaveBeenCalledWith();
  });

  it("publishes each claimed variant for its own profile and reports outcomes", async () => {
    db.$queryRaw.mockResolvedValue([
      { id: "v1", profile_id: "p1" },
      { id: "v2", profile_id: "p2" },
    ]);
    publish.executePublish
      .mockResolvedValueOnce({ outcome: "published" })
      .mockResolvedValueOnce({
        outcome: "failed",
        message: "Meta denied the request.",
      });

    const res = await POST(request({ secret: SECRET, body: '{"limit":2}' }));
    expect(await res.json()).toEqual({
      claimed: 2,
      results: [
        { variantId: "v1", outcome: "published" },
        {
          variantId: "v2",
          outcome: "failed",
          message: "Meta denied the request.",
        },
      ],
    });
    expect(publish.executePublish).toHaveBeenNthCalledWith(
      1,
      "v1",
      "p1",
      expect.any(Object),
    );
    expect(publish.executePublish).toHaveBeenNthCalledWith(
      2,
      "v2",
      "p2",
      expect.any(Object),
    );
  });

  it("keeps going when one variant's result can't be recorded, without retrying it", async () => {
    db.$queryRaw.mockResolvedValue([
      { id: "v1", profile_id: "p1" },
      { id: "v2", profile_id: "p2" },
    ]);
    publish.executePublish
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce({ outcome: "published" });
    const res = await POST(request({ secret: SECRET }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      variantId: "v1",
      outcome: "unconfirmed",
    });
    expect(body.results[1]).toMatchObject({
      variantId: "v2",
      outcome: "published",
    });
    expect(publish.executePublish).toHaveBeenCalledTimes(2);
  });

  it("caps Instagram polling during scheduled runs", async () => {
    db.$queryRaw.mockResolvedValue([{ id: "v1", profile_id: "p1" }]);
    publish.executePublish.mockResolvedValue({
      outcome: "pending",
      message: "later",
    });
    await POST(request({ secret: SECRET }));
    expect(publish.executePublish).toHaveBeenCalledWith("v1", "p1", {
      instagramMaxWaitMs: 10_000,
    });
  });

  it("only claims NOT_PUBLISHED approved variants (FAILED and UNCONFIRMED wait for a human)", async () => {
    await POST(request({ secret: SECRET }));
    const strings = db.$queryRaw.mock.calls[0]![0] as TemplateStringsArray;
    const sql = strings.join("?");
    expect(sql).toContain("publish_status = 'NOT_PUBLISHED'");
    expect(sql).toContain("approval_status = 'APPROVED'");
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(sql).not.toMatch(/'FAILED'|'UNCONFIRMED'/);
  });

  it("retries media cleanup on every authorized run, but not for rejected requests", async () => {
    await POST(request({ secret: SECRET }));
    expect(cleanup.runBackgroundMediaCleanup).toHaveBeenCalledTimes(1);
    await POST(request({ secret: "wrong-secret-0123456789" }));
    expect(cleanup.runBackgroundMediaCleanup).toHaveBeenCalledTimes(1);
  });
});
