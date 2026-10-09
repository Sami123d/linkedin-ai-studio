import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "test-secret-0123456789";

const createMany = vi.fn();
const cleanupStaleData = vi.fn();

vi.mock("@/config/env.server", () => ({
  serverEnv: { TREND_WEBHOOK_SECRET: "test-secret-0123456789" },
}));
vi.mock("@/features/cleanup/cleanup", () => ({
  cleanupStaleData: (...args: unknown[]) => cleanupStaleData(...args),
}));
vi.mock("@/db/prisma", () => ({
  prisma: {
    trend: { createMany: (...args: unknown[]) => createMany(...args) },
  },
}));

const { POST } = await import("@/app/api/webhooks/trends/route");

function post(body: string, secret?: string) {
  return new Request("http://localhost/api/webhooks/trends", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { "x-webhook-secret": secret } : {}),
    },
    body,
  });
}

describe("POST /api/webhooks/trends", () => {
  beforeEach(() => {
    createMany.mockReset();
    createMany.mockResolvedValue({ count: 2 });
    cleanupStaleData.mockReset();
    cleanupStaleData.mockResolvedValue({});
  });

  it("rejects requests without the shared secret", async () => {
    const res = await POST(post(JSON.stringify({ topic: "x" })));
    expect(res.status).toBe(401);
    expect(createMany).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON and invalid payloads", async () => {
    expect((await POST(post("{not json", SECRET))).status).toBe(400);
    expect(
      (await POST(post(JSON.stringify({ topic: "" }), SECRET))).status,
    ).toBe(400);
    expect(createMany).not.toHaveBeenCalled();
  });

  it("inserts a batch of trends", async () => {
    const res = await POST(
      post(
        JSON.stringify([
          { topic: "Agents", sourceName: "HN", sourceUrl: "", score: 3 },
          { topic: "RAG", category: "AI" },
        ]),
        SECRET,
      ),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ inserted: 2 });
    const { data } = createMany.mock.calls[0][0];
    expect(data).toHaveLength(2);
    // An empty sourceUrl is stored as undefined, not "".
    expect(data[0].sourceUrl).toBeUndefined();
    expect(data[1].category).toBe("AI");
  });

  it("returns inserted: 0 for an empty batch without touching the DB", async () => {
    const res = await POST(post("[]", SECRET));
    expect(await res.json()).toEqual({ inserted: 0 });
    expect(createMany).not.toHaveBeenCalled();
  });

  it("runs housekeeping after inserting, and a cleanup failure does not fail ingestion", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    cleanupStaleData.mockRejectedValueOnce(new Error("db down"));

    const res = await POST(post(JSON.stringify({ topic: "Agents" }), SECRET));

    expect(cleanupStaleData).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ inserted: 2 });
    error.mockRestore();
  });
});
