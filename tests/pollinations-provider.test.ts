import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  POLLINATIONS_API_KEY: undefined as string | undefined,
  POLLINATIONS_MODEL: "test-model",
}));
vi.mock("@/config/env.server", () => ({ serverEnv: env }));

const {
  BRAND_STYLE,
  PollinationsImageProvider,
  buildPollinationsPrompt,
  buildPollinationsUrl,
  mediaUrlFromLinkHeader,
  seedFromQuery,
} = await import("@/ai/providers/pollinations");

const fetchMock = vi.fn();
const imageResponse = (headers: Record<string, string> = {}) =>
  new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { "content-type": "image/jpeg", ...headers },
  });

describe("buildPollinationsPrompt", () => {
  it("appends the brand style to the scene", () => {
    const prompt = buildPollinationsPrompt(
      "  A robot hand sketching a bridge. ",
    );
    expect(prompt).toBe(`A robot hand sketching a bridge. ${BRAND_STYLE}.`);
  });

  it("uses the HalfClicks palette and asks for a wordless image", () => {
    expect(BRAND_STYLE).toContain("#0D0D0D");
    expect(BRAND_STYLE).toContain("#D4FF3A");
    expect(BRAND_STYLE).toContain("#F4F4EF");
    expect(BRAND_STYLE).toContain("wordless");
  });
});

describe("seedFromQuery", () => {
  it("is deterministic and ignores case and surrounding whitespace", () => {
    expect(seedFromQuery("AI agents")).toBe(seedFromQuery(" ai agents "));
  });

  it("differs between queries and stays a positive 31-bit integer", () => {
    const a = seedFromQuery("AI agents");
    const b = seedFromQuery("Remote work");
    expect(a).not.toBe(b);
    for (const seed of [a, b]) {
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(2 ** 31);
    }
  });
});

describe("buildPollinationsUrl", () => {
  it("uses the legacy anonymous endpoint without a key and omits the model", () => {
    const url = new URL(
      buildPollinationsUrl({
        query: "AI agents",
        model: "m",
        authenticated: false,
      }),
    );
    expect(url.host).toBe("image.pollinations.ai");
    expect(decodeURIComponent(url.pathname)).toBe(
      `/prompt/${buildPollinationsPrompt("AI agents")}`,
    );
    expect(url.searchParams.get("width")).toBe("1200");
    expect(url.searchParams.get("height")).toBe("627");
    expect(url.searchParams.get("seed")).toBe(
      String(seedFromQuery("AI agents")),
    );
    expect(url.searchParams.get("nologo")).toBe("true");
    expect(url.searchParams.has("model")).toBe(false);
  });

  it("uses gen.pollinations.ai with the model when authenticated", () => {
    const url = new URL(
      buildPollinationsUrl({
        query: "AI agents",
        model: "m",
        authenticated: true,
      }),
    );
    expect(url.host).toBe("gen.pollinations.ai");
    expect(url.pathname.startsWith("/image/")).toBe(true);
    expect(url.searchParams.get("model")).toBe("m");
  });

  it("returns the same URL for the same query", () => {
    const params = { query: "AI agents", model: "m", authenticated: false };
    expect(buildPollinationsUrl(params)).toBe(buildPollinationsUrl(params));
  });
});

describe("mediaUrlFromLinkHeader", () => {
  it("picks the media.pollinations.ai URL and ignores other links", () => {
    expect(
      mediaUrlFromLinkHeader(
        '<https://pollinations.ai>; rel="service", <https://media.pollinations.ai/abc123>; rel="item"',
      ),
    ).toBe("https://media.pollinations.ai/abc123");
    expect(
      mediaUrlFromLinkHeader('<https://pollinations.ai>; rel="service"'),
    ).toBeUndefined();
    expect(mediaUrlFromLinkHeader(null)).toBeUndefined();
  });
});

describe("PollinationsImageProvider", () => {
  beforeEach(() => {
    env.POLLINATIONS_API_KEY = undefined;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("without a key, verifies the image and returns the anonymous URL", async () => {
    fetchMock.mockResolvedValueOnce(imageResponse());
    const result = await new PollinationsImageProvider().getImage("AI agents");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      buildPollinationsUrl({
        query: "AI agents",
        model: "test-model",
        authenticated: false,
      }),
    );
    expect(init.headers).toEqual({});
    expect(result).toEqual({ url, sourceUrl: "https://pollinations.ai" });
  });

  it("with a key, sends a bearer token and uses the media URL from the Link header", async () => {
    env.POLLINATIONS_API_KEY = "sk_test";
    fetchMock.mockResolvedValueOnce(
      imageResponse({
        link: '<https://media.pollinations.ai/xyz>; rel="item"',
      }),
    );
    const result = await new PollinationsImageProvider().getImage("AI agents");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      Authorization: "Bearer sk_test",
    });
    expect(result.url).toBe("https://media.pollinations.ai/xyz");
    expect(result.url).not.toContain("sk_test");
  });

  it("with a key and no media link, uploads the image and returns its public URL", async () => {
    env.POLLINATIONS_API_KEY = "sk_test";
    fetchMock
      .mockResolvedValueOnce(imageResponse())
      .mockResolvedValueOnce(
        Response.json({ id: "u1", url: "https://media.pollinations.ai/u1" }),
      );
    const result = await new PollinationsImageProvider().getImage("AI agents");

    const [uploadUrl, uploadInit] = fetchMock.mock.calls[1];
    expect(uploadUrl).toBe("https://media.pollinations.ai/upload");
    expect(uploadInit.method).toBe("POST");
    expect(uploadInit.body).toBeInstanceOf(FormData);
    expect(result.url).toBe("https://media.pollinations.ai/u1");
  });

  it("throws on a non-200 response", async () => {
    fetchMock.mockResolvedValueOnce(new Response("busy", { status: 503 }));
    await expect(new PollinationsImageProvider().getImage("q")).rejects.toThrow(
      "Pollinations image generation failed (503): busy",
    );
  });

  it("throws when the response is not an image", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(new PollinationsImageProvider().getImage("q")).rejects.toThrow(
      'Pollinations returned "application/json" instead of an image.',
    );
  });

  it("turns a timeout into a readable error", async () => {
    fetchMock.mockRejectedValueOnce(
      Object.assign(new Error("aborted"), { name: "TimeoutError" }),
    );
    await expect(new PollinationsImageProvider().getImage("q")).rejects.toThrow(
      "Pollinations image generation timed out after 90s.",
    );
  });

  it("throws when the media upload fails", async () => {
    env.POLLINATIONS_API_KEY = "sk_test";
    fetchMock
      .mockResolvedValueOnce(imageResponse())
      .mockResolvedValueOnce(new Response("nope", { status: 401 }));
    await expect(new PollinationsImageProvider().getImage("q")).rejects.toThrow(
      "Pollinations media upload failed (401): nope",
    );
  });
});
