import { describe, expect, it, vi } from "vitest";

import { discoverSources, lookbackDays } from "@/lib/sources/discover";
import {
  canonicalizeUrl,
  classifyFreshness,
  cleanText,
  dedupeAndRank,
  keywordsFromText,
  mentionsAny,
  parseDate,
  validateSource,
} from "@/lib/sources/normalize";
import {
  braveFreshness,
  searchBraveNews,
  searchDevTo,
  searchHackerNews,
  type FetchJson,
} from "@/lib/sources/providers";
import {
  researchRequestSchema,
  type DiscoveredSource,
} from "@/validation/research-studio";

// All provider responses are mocked: these tests prove parsing, validation,
// dedupe and failure handling, NOT that the live APIs answer this way today.

const NOW = new Date("2026-10-19T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

function src(over: Partial<DiscoveredSource> = {}): DiscoveredSource {
  return {
    provider: "hackernews",
    title: "AI agents reshape online checkout",
    publisher: "example.com",
    url: "https://example.com/agents",
    discussionUrl: null,
    publishedAt: daysAgo(1),
    snippet: null,
    ...over,
  };
}

describe("research prompt validation", () => {
  const valid = {
    prompt: "Find recent trends about AI agents in e-commerce",
    timeframeDays: 7,
    platforms: ["LINKEDIN", "INSTAGRAM"],
  };

  it("accepts a complete request and blanks optional fields", () => {
    const r = researchRequestSchema.parse({
      ...valid,
      audience: "  ",
      tone: "friendly",
    });
    expect(r.audience).toBeUndefined();
    expect(r.tone).toBe("friendly");
    expect(r.includeLinks).toBe(false);
  });

  it("rejects short prompts, unknown timeframes, no or duplicate platforms and WhatsApp", () => {
    for (const bad of [
      { ...valid, prompt: "AI" },
      { ...valid, timeframeDays: 3 },
      { ...valid, platforms: [] },
      { ...valid, platforms: ["LINKEDIN", "LINKEDIN"] },
      { ...valid, platforms: ["WHATSAPP"] },
      { ...valid, instructions: "x".repeat(1001) },
    ]) {
      expect(researchRequestSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("source validation and metadata", () => {
  it("keeps valid sources exactly as given", () => {
    expect(validateSource(src())).toMatchObject({
      title: "AI agents reshape online checkout",
    });
  });

  it("drops sources with missing title, non-http(s) or malformed URLs", () => {
    expect(validateSource(src({ title: "" }))).toBeNull();
    expect(validateSource(src({ url: "javascript:alert(1)" }))).toBeNull();
    expect(validateSource(src({ url: "ftp://example.com/x" }))).toBeNull();
    expect(validateSource(src({ url: "not a url" }))).toBeNull();
    expect(validateSource({ ...src(), url: null })).toBeNull();
  });

  it("rejects invalid, ancient and far-future dates instead of guessing", () => {
    expect(parseDate("not a date", NOW)).toBeNull();
    expect(parseDate("1970-01-01T00:00:00Z", NOW)).toBeNull();
    expect(parseDate("2030-01-01T00:00:00Z", NOW)).toBeNull();
    expect(parseDate("2026-10-18T09:00:00Z", NOW)?.toISOString()).toBe(
      "2026-10-18T09:00:00.000Z",
    );
  });

  it("strips markup and entities from provider text", () => {
    expect(cleanText("<p>Agents &amp; <b>checkout</b>&#39;s future</p>")).toBe(
      "Agents & checkout's future",
    );
    expect(cleanText("<p>One</p><p>Two</p>line<br>break")).toBe(
      "One Two line break",
    );
    expect(cleanText("   ")).toBeNull();
    expect(cleanText(42)).toBeNull();
  });
});

describe("duplicate handling", () => {
  it("canonicalizes URLs (www, tracking params, fragments, trailing slash, param order)", () => {
    expect(
      canonicalizeUrl("https://WWW.Example.com/a/?utm_source=x&b=2&a=1#top"),
    ).toBe("https://example.com/a?a=1&b=2");
    expect(canonicalizeUrl("https://user:pw@example.com/")).toBeNull();
    expect(canonicalizeUrl("mailto:x@example.com")).toBeNull();
  });

  it("merges the same story found by different providers and keeps the first", () => {
    const ranked = dedupeAndRank(
      [
        src({
          provider: "brave",
          url: "https://example.com/agents?utm_medium=feed",
          publishedAt: null,
        }),
        src({
          provider: "hackernews",
          url: "https://www.example.com/agents/",
          discussionUrl: "https://news.ycombinator.com/item?id=1",
        }),
        src({
          provider: "devto",
          url: "https://mirror.example.org/agents",
          title: "AI Agents Reshape Online Checkout!",
        }),
      ],
      NOW,
      7,
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toMatchObject({
      provider: "brave",
      discussionUrl: "https://news.ycombinator.com/item?id=1",
      freshness: "recent",
    });
    expect(ranked[0]!.publishedAt).not.toBeNull();
  });
});

describe("freshness", () => {
  it("separates recent, background and undated sources", () => {
    expect(classifyFreshness(daysAgo(2), NOW, 7)).toBe("recent");
    expect(classifyFreshness(daysAgo(20), NOW, 7)).toBe("background");
    expect(classifyFreshness(null, NOW, 7)).toBe("undated");
  });

  it("orders recent (newest first), then background, then undated", () => {
    const ranked = dedupeAndRank(
      [
        src({ url: "https://a.com/1", title: "undated", publishedAt: null }),
        src({ url: "https://a.com/2", title: "old", publishedAt: daysAgo(40) }),
        src({ url: "https://a.com/3", title: "new", publishedAt: daysAgo(1) }),
        src({
          url: "https://a.com/4",
          title: "newer",
          publishedAt: daysAgo(0.5),
        }),
      ],
      NOW,
      7,
    );
    expect(ranked.map((r) => r.title)).toEqual([
      "newer",
      "new",
      "old",
      "undated",
    ]);
  });

  it("searches past the timeframe for clearly labelled background material", () => {
    expect(lookbackDays(1)).toBe(30);
    expect(lookbackDays(30)).toBe(90);
    expect(lookbackDays(365)).toBe(365);
  });
});

describe("keywords", () => {
  it("drops instruction and time words from a natural-language prompt", () => {
    expect(
      keywordsFromText(
        "Find recent trends about AI agents in e-commerce, prioritize developments from the last seven days",
      ),
    ).toEqual(["ai", "agents", "e-commerce"]);
  });

  it("filters loosely matched results by keyword", () => {
    expect(
      mentionsAny({ title: "Hall of Fame", snippet: null }, ["agents"]),
    ).toBe(false);
    expect(
      mentionsAny({ title: "AI Agents in retail", snippet: null }, ["agents"]),
    ).toBe(true);
  });
});

function fakeFetch(routes: Record<string, unknown | Error>) {
  const calls: { url: string; headers?: Record<string, string> }[] = [];
  const fetchJson: FetchJson = async (url, init) => {
    calls.push({ url, headers: init?.headers });
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    const value = key ? routes[key] : new Error("HTTP 404");
    if (value instanceof Error) throw value;
    return value;
  };
  return { fetchJson, calls };
}

const HN = "https://hn.algolia.com/api/v1/search";
const DEVTO = "https://dev.to/api/articles/search";
const BRAVE = "https://api.search.brave.com/res/v1/news/search";

describe("providers", () => {
  it("maps Hacker News hits with the real URL and the discussion link", async () => {
    const { fetchJson, calls } = fakeFetch({
      [HN]: {
        hits: [
          {
            objectID: "42",
            title: "AI agents &amp; checkout",
            url: "https://shop.example/blog",
            created_at: "2026-10-18T10:00:00Z",
          },
          {
            objectID: "43",
            title: "Ask HN: agents?",
            url: null,
            created_at: "2026-10-17T10:00:00Z",
            story_text: "<p>What do you use?</p>",
          },
        ],
      },
    });
    const out = await searchHackerNews("ai agents", 30, NOW, fetchJson);
    expect(out[0]).toMatchObject({
      title: "AI agents & checkout",
      url: "https://shop.example/blog",
      publisher: "shop.example",
      discussionUrl: "https://news.ycombinator.com/item?id=42",
    });
    expect(out[1]).toMatchObject({
      url: "https://news.ycombinator.com/item?id=43",
      publisher: "Hacker News",
      discussionUrl: null,
    });
    expect(calls[0]!.url).toContain("numericFilters=created_at_i");
    expect(calls[0]!.url).toContain("tags=story");
  });

  it("maps DEV articles using the canonical URL and publication date", async () => {
    const { fetchJson } = fakeFetch({
      [DEVTO]: [
        {
          title: "Agents in e-commerce",
          url: "https://dev.to/u/post",
          canonical_url: "https://blog.example/post",
          published_at: "2026-10-16T08:00:00Z",
          description: "How agents shop",
          user: { name: "Sam" },
        },
      ],
    });
    const out = await searchDevTo("agents", NOW, fetchJson);
    expect(out[0]).toMatchObject({
      url: "https://blog.example/post",
      discussionUrl: "https://dev.to/u/post",
      publisher: "blog.example",
      snippet: "How agents shop by Sam",
    });
  });

  it("calls Brave with the key header and maps page_age, never the relative age", async () => {
    const { fetchJson, calls } = fakeFetch({
      [BRAVE]: {
        results: [
          {
            title: "Retail agents",
            url: "https://news.example/a",
            description: "x",
            age: "2 days ago",
            page_age: "2026-10-17T06:00:00",
            meta_url: { hostname: "www.news.example" },
          },
        ],
      },
    });
    const out = await searchBraveNews(
      "retail agents",
      7,
      "secret-key",
      NOW,
      fetchJson,
    );
    expect(calls[0]!.headers).toEqual({ "X-Subscription-Token": "secret-key" });
    expect(calls[0]!.url).toContain("freshness=pw");
    expect(out[0]).toMatchObject({
      publisher: "news.example",
      url: "https://news.example/a",
    });
    expect(out[0]!.publishedAt?.toISOString()).toBe(
      new Date("2026-10-17T06:00:00").toISOString(),
    );
    expect(braveFreshness(1)).toBe("pd");
    expect(braveFreshness(90)).toBe("py");
  });

  it("rejects unsupported response shapes", async () => {
    const { fetchJson } = fakeFetch({
      [HN]: { error: "nope" },
      [DEVTO]: { message: "x" },
      [BRAVE]: {},
    });
    await expect(searchHackerNews("x", 7, NOW, fetchJson)).rejects.toThrow(
      /Unexpected/,
    );
    await expect(searchDevTo("x", NOW, fetchJson)).rejects.toThrow(
      /Unexpected/,
    );
    await expect(searchBraveNews("x", 7, "k", NOW, fetchJson)).rejects.toThrow(
      /Unexpected/,
    );
  });
});

describe("discoverSources", () => {
  const base = {
    keywords: ["agents"],
    timeframeDays: 7,
    now: NOW,
    collectedTrends: [],
  };

  it("combines providers, validates, filters loose matches and dedupes", async () => {
    const { fetchJson } = fakeFetch({
      [HN]: {
        hits: [
          {
            objectID: "1",
            title: "Agents go shopping",
            url: "https://a.example/1",
            created_at: "2026-10-18T00:00:00Z",
          },
        ],
      },
      [DEVTO]: [
        {
          title: "Agents go shopping",
          canonical_url: "https://a.example/1/",
          published_at: "2026-10-18T00:00:00Z",
        },
        {
          title: "Hall of Fame",
          canonical_url: "https://dev.to/x",
          published_at: "2026-10-18T00:00:00Z",
        },
        {
          title: "",
          canonical_url: "https://dev.to/empty",
          published_at: "2026-10-18T00:00:00Z",
        },
      ],
    });
    const r = await discoverSources({
      ...base,
      queries: ["ai agents"],
      fetchJson,
    });
    expect(r.sources).toHaveLength(1);
    expect(r.providerResults.hackernews).toMatchObject({ ok: true, count: 1 });
    // "Hall of Fame" (no keyword) and the untitled item are filtered out.
    expect(r.providerResults.devto).toMatchObject({ ok: true, count: 1 });
    expect(r.providerResults.brave).toMatchObject({ skipped: true });
    expect(r.allFailed).toBe(false);
  });

  it("keeps working when one provider fails and reports the failure", async () => {
    const { fetchJson } = fakeFetch({
      [HN]: new Error("HTTP 503"),
      [DEVTO]: [
        {
          title: "Agents in retail",
          canonical_url: "https://b.example/2",
          published_at: "2026-10-18T00:00:00Z",
        },
      ],
    });
    const r = await discoverSources({
      ...base,
      queries: ["agents"],
      fetchJson,
    });
    expect(r.sources).toHaveLength(1);
    expect(r.providerResults.hackernews).toMatchObject({
      ok: false,
      error: "HTTP 503",
    });
    expect(r.allFailed).toBe(false);
  });

  it("reports allFailed when every provider fails and nothing was collected", async () => {
    const { fetchJson } = fakeFetch({
      [HN]: new Error("HTTP 500"),
      [DEVTO]: new Error("Timed out"),
    });
    const r = await discoverSources({
      ...base,
      queries: ["agents"],
      fetchJson,
    });
    expect(r.allFailed).toBe(true);
    expect(r.sources).toEqual([]);
  });

  it("returns an empty, non-failed result when providers answer with nothing", async () => {
    const { fetchJson } = fakeFetch({ [HN]: { hits: [] }, [DEVTO]: [] });
    const r = await discoverSources({
      ...base,
      queries: ["agents"],
      fetchJson,
    });
    expect(r.allFailed).toBe(false);
    expect(r.sources).toEqual([]);
  });

  it("uses collected trends with their real URL and date, never ingestion time", async () => {
    const { fetchJson } = fakeFetch({ [HN]: { hits: [] }, [DEVTO]: [] });
    const r = await discoverSources({
      ...base,
      queries: ["agents"],
      fetchJson,
      collectedTrends: [
        {
          topic: "Agentic checkout",
          summary: "s",
          sourceName: "Vercel Blog",
          sourceUrl: "https://vercel.com/blog/x",
          publishedAt: null,
        },
        {
          topic: "No link",
          summary: null,
          sourceName: null,
          sourceUrl: null,
          publishedAt: daysAgo(1),
        },
      ],
    });
    expect(r.sources).toHaveLength(1);
    expect(r.sources[0]).toMatchObject({
      provider: "collected-trend",
      publishedAt: null,
      freshness: "undated",
    });
  });

  it("queries Brave only when a key is configured", async () => {
    const { fetchJson, calls } = fakeFetch({
      [HN]: { hits: [] },
      [DEVTO]: [],
      [BRAVE]: { results: [] },
    });
    await discoverSources({
      ...base,
      queries: ["a", "b"],
      fetchJson,
      braveApiKey: "k",
    });
    expect(calls.filter((c) => c.url.startsWith(BRAVE))).toHaveLength(2);
    const noKey = fakeFetch({ [HN]: { hits: [] }, [DEVTO]: [] });
    await discoverSources({
      ...base,
      queries: ["a"],
      fetchJson: noKey.fetchJson,
    });
    expect(noKey.calls.some((c) => c.url.startsWith(BRAVE))).toBe(false);
  });

  it("never leaks the API key in provider errors", async () => {
    const leaky = vi.fn<FetchJson>(async (url) => {
      if (url.startsWith(BRAVE)) throw new Error("HTTP 401");
      return url.startsWith(HN) ? { hits: [] } : [];
    });
    const r = await discoverSources({
      ...base,
      queries: ["a"],
      fetchJson: leaky,
      braveApiKey: "super-secret",
    });
    expect(JSON.stringify(r.providerResults)).not.toContain("super-secret");
    expect(r.providerResults.brave).toMatchObject({
      ok: false,
      error: "HTTP 401",
    });
  });
});
