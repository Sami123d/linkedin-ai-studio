import { describe, expect, it } from "vitest";

import { trendWebhookBodySchema } from "@/validation/trends";

import {
  buildPayload,
  categorize,
  computeScore,
  dedupe,
  parseFeed,
  type NormalizedTrend,
} from "../scripts/collect-trends";

const NOW = Date.parse("2026-10-01T12:00:00Z");

function trend(overrides: Partial<NormalizedTrend> = {}): NormalizedTrend {
  return {
    topic: "A new open-source agent framework",
    summary: "",
    sourceName: "Hacker News",
    sourceUrl: "https://example.com/a",
    rawScore: 120,
    rawScoreType: "log",
    publishedAt: "2026-09-30T10:00:00Z",
    hintCategory: null,
    ...overrides,
  };
}

describe("parseFeed", () => {
  it("reads RSS items with CDATA, entities and HTML descriptions", () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>
      <item><title><![CDATA[OpenAI &amp; friends ship GPT tools]]></title>
        <link>https://openai.com/news/one</link><pubDate>Tue, 30 Sep 2026 09:00:00 GMT</pubDate>
        <description>&lt;p&gt;Hello &lt;b&gt;world&lt;/b&gt;&lt;/p&gt;</description></item>
      <item><title>No link here</title></item>
    </channel></rss>`;
    expect(parseFeed(xml)).toEqual([
      {
        title: "OpenAI & friends ship GPT tools",
        link: "https://openai.com/news/one",
        isoDate: "2026-09-30T09:00:00.000Z",
        contentSnippet: "Hello world",
      },
    ]);
  });

  it("reads Atom entries and prefers the alternate link", () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Blog</title>
      <entry><title>Next.js 17</title><link rel="self" href="https://x.dev/self"/>
        <link rel="alternate" href="https://nextjs.org/blog/next-17"/>
        <updated>2026-09-29T08:00:00Z</updated><summary>Faster builds</summary></entry></feed>`;
    const [entry] = parseFeed(xml);
    expect(entry.link).toBe("https://nextjs.org/blog/next-17");
    expect(entry.isoDate).toBe("2026-09-29T08:00:00.000Z");
    expect(entry.contentSnippet).toBe("Faster builds");
  });
});

describe("pipeline rules (same as the n8n Code nodes)", () => {
  it("scores popularity on a log scale and gives editorial/unranked flat scores", () => {
    expect(computeScore({ rawScore: 0, rawScoreType: "log" })).toBe(0);
    expect(computeScore({ rawScore: 99, rawScoreType: "log" })).toBe(60);
    expect(computeScore({ rawScore: 1_000_000, rawScoreType: "log" })).toBe(
      100,
    );
    expect(computeScore({ rawScore: null, rawScoreType: "editorial" })).toBe(
      70,
    );
    expect(computeScore({ rawScore: null, rawScoreType: "unranked" })).toBe(50);
  });

  it("uses the hint category first, then keyword rules, then Other", () => {
    expect(
      categorize({ topic: "anything", summary: "", hintCategory: "SaaS" }),
    ).toBe("SaaS");
    expect(
      categorize({
        topic: "Building a multi-agent system",
        summary: "",
        hintCategory: null,
      }),
    ).toBe("AI Agents");
    expect(
      categorize({
        topic: "Our seed round",
        summary: "",
        hintCategory: "not-a-category",
      }),
    ).toBe("Startup");
    expect(
      categorize({ topic: "Gardening tips", summary: "", hintCategory: null }),
    ).toBe("Other");
  });

  it("dedupes by URL keeping the higher raw score", () => {
    const kept = dedupe([
      trend({ sourceUrl: "https://EXAMPLE.com/a", rawScore: 5 }),
      trend({
        sourceUrl: "https://example.com/a",
        rawScore: 50,
        sourceName: "GitHub Trending",
      }),
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0].sourceName).toBe("GitHub Trending");
  });

  it("drops stale and invalid items, ranks, caps at 30 and matches the webhook schema", () => {
    const items = [
      trend({
        sourceUrl: "https://example.com/old",
        publishedAt: "2026-08-01T00:00:00Z",
        rawScore: 10_000,
      }),
      trend({ sourceUrl: "not a url" }),
      trend({
        sourceUrl: "https://example.com/bad-date",
        publishedAt: "yesterday-ish",
        rawScoreType: "editorial",
      }),
      ...Array.from({ length: 40 }, (_, i) =>
        trend({ sourceUrl: `https://example.com/${i}`, rawScore: i }),
      ),
    ];
    const payload = buildPayload(items, NOW);

    expect(payload).toHaveLength(30);
    expect(payload.some((t) => t.sourceUrl.endsWith("/old"))).toBe(false);
    expect(payload[0].sourceUrl).toBe("https://example.com/bad-date"); // editorial 70 beats log(39+1)*30 = 48
    expect(payload[0].publishedAt).toBeUndefined();
    expect(payload.map((t) => t.score)).toEqual(
      [...payload.map((t) => t.score)].sort((a, b) => b - a),
    );
    expect(trendWebhookBodySchema.safeParse(payload).success).toBe(true);
  });
});
