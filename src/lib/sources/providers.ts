import "server-only";

import { cleanText, hostnameOf, parseDate } from "@/lib/sources/normalize";
import type { SourceProvider } from "@/validation/research-studio";

/// On-demand search through official, documented APIs only:
///  - Hacker News Search (Algolia): https://hn.algolia.com/api, no key.
///  - DEV (Forem API v1) GET /api/articles/search?q=, no key.
///  - Brave Search News API, optional BRAVE_SEARCH_API_KEY.
/// Google News RSS (used by the scheduled collector) is deliberately NOT
/// used here: news.google.com/robots.txt disallows automated access.
///
/// Each provider returns raw candidates exactly as returned (mapped to our
/// field names). Validation, dedupe and ranking happen in normalize.ts.
/// `fetchJson` is injectable so tests never hit the network.

export type FetchJson = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<unknown>;

export type RawCandidate = {
  provider: SourceProvider;
  title: string | null;
  publisher: string | null;
  url: string | null;
  discussionUrl: string | null;
  publishedAt: Date | null;
  snippet: string | null;
};

export class SourceProviderError extends Error {
  constructor(
    readonly provider: SourceProvider,
    message: string,
  ) {
    super(message);
    this.name = "SourceProviderError";
  }
}

const USER_AGENT = "linkedin-ai-studio-research/1.0";
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/// Default fetcher: GET, JSON, 10 s timeout, 2 MB cap, never logs headers.
/// The cap is checked on the decoded text length, a cheap approximation of
/// bytes that is good enough to reject runaway responses.
export const defaultFetchJson: FetchJson = async (url, init) => {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": USER_AGENT,
      ...init?.headers,
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const text = await response.text();
  if (text.length > MAX_BODY_BYTES) throw new Error("Response too large");
  return JSON.parse(text) as unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function searchHackerNews(
  query: string,
  sinceDays: number,
  now: Date,
  fetchJson: FetchJson,
): Promise<RawCandidate[]> {
  const since = Math.floor(now.getTime() / 1000) - sinceDays * 86_400;
  const params = new URLSearchParams({
    query,
    tags: "story",
    numericFilters: `created_at_i>${since}`,
    hitsPerPage: "20",
  });
  const body = asRecord(
    await fetchJson(`https://hn.algolia.com/api/v1/search?${params}`),
  );
  if (!Array.isArray(body.hits)) {
    throw new SourceProviderError("hackernews", "Unexpected response shape.");
  }
  return body.hits.map((hit): RawCandidate => {
    const h = asRecord(hit);
    const id = asString(String(h.objectID ?? ""));
    const discussion = id ? `https://news.ycombinator.com/item?id=${id}` : null;
    const url = asString(h.url) ?? discussion; // Ask/Show HN have no link
    return {
      provider: "hackernews",
      title: cleanText(h.title, 500),
      publisher: url
        ? url === discussion
          ? "Hacker News"
          : hostnameOf(url)
        : null,
      url,
      discussionUrl: url === discussion ? null : discussion,
      publishedAt: parseDate(h.created_at, now),
      snippet: cleanText(h.story_text, 600),
    };
  });
}

export async function searchDevTo(
  query: string,
  now: Date,
  fetchJson: FetchJson,
): Promise<RawCandidate[]> {
  const params = new URLSearchParams({ q: query, per_page: "20" });
  const body = await fetchJson(`https://dev.to/api/articles/search?${params}`);
  if (!Array.isArray(body)) {
    throw new SourceProviderError("devto", "Unexpected response shape.");
  }
  return body.map((item): RawCandidate => {
    const a = asRecord(item);
    const url = asString(a.canonical_url) ?? asString(a.url);
    const user = asRecord(a.user);
    return {
      provider: "devto",
      title: cleanText(a.title, 500),
      publisher: url ? hostnameOf(url) : null,
      url,
      discussionUrl:
        asString(a.url) && asString(a.url) !== url ? asString(a.url) : null,
      publishedAt: parseDate(a.published_at ?? a.published_timestamp, now),
      snippet: cleanText(
        [
          asString(a.description),
          asString(user.name) ? `by ${user.name}` : null,
        ]
          .filter(Boolean)
          .join(" "),
        600,
      ),
    };
  });
}

/// Brave "freshness": pd = 24 h, pw = 7 days, pm = 31 days, py = 1 year.
export function braveFreshness(days: number): string {
  if (days <= 1) return "pd";
  if (days <= 7) return "pw";
  if (days <= 31) return "pm";
  return "py";
}

export async function searchBraveNews(
  query: string,
  sinceDays: number,
  apiKey: string,
  now: Date,
  fetchJson: FetchJson,
): Promise<RawCandidate[]> {
  const params = new URLSearchParams({
    q: query,
    count: "20",
    freshness: braveFreshness(sinceDays),
  });
  const body = asRecord(
    await fetchJson(
      `https://api.search.brave.com/res/v1/news/search?${params}`,
      {
        headers: { "X-Subscription-Token": apiKey },
      },
    ),
  );
  if (!Array.isArray(body.results)) {
    throw new SourceProviderError("brave", "Unexpected response shape.");
  }
  return body.results.map((item): RawCandidate => {
    const r = asRecord(item);
    const url = asString(r.url);
    const meta = asRecord(r.meta_url);
    return {
      provider: "brave",
      title: cleanText(r.title, 500),
      publisher:
        asString(meta.hostname)?.replace(/^www\./, "") ??
        (url ? hostnameOf(url) : null),
      url,
      discussionUrl: null,
      // page_age is an ISO timestamp; the relative `age` text is not parsed.
      publishedAt: parseDate(r.page_age, now),
      snippet: cleanText(r.description, 600),
    };
  });
}
