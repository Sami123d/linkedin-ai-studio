import "server-only";

import {
  dedupeAndRank,
  mentionsAny,
  validateSource,
  type RankedSource,
} from "@/lib/sources/normalize";
import {
  defaultFetchJson,
  searchBraveNews,
  searchDevTo,
  searchHackerNews,
  type FetchJson,
  type RawCandidate,
} from "@/lib/sources/providers";
import type { SourceProvider } from "@/validation/research-studio";

export type CollectedTrendInput = {
  topic: string;
  summary: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  publishedAt: Date | null;
};

export type ProviderResult = {
  ok: boolean;
  count: number;
  skipped?: boolean;
  error?: string;
};

export type DiscoveryResult = {
  sources: RankedSource[];
  providerResults: Partial<Record<SourceProvider, ProviderResult>>;
  /// True when every provider that actually ran failed.
  allFailed: boolean;
};

const MAX_SOURCES = 40;

/// How far back to search: the requested timeframe (recent) plus older
/// background material, which the UI labels separately. Three times the
/// timeframe, clamped to 30-365 days.
export function lookbackDays(timeframeDays: number): number {
  return Math.min(365, Math.max(30, timeframeDays * 3));
}

function safeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return "Timed out";
    }
    return error.message.slice(0, 200);
  }
  return "Request failed";
}

/// Runs every available provider for every query, then validates,
/// de-duplicates and ranks. A failing provider never fails the others.
export async function discoverSources(input: {
  queries: string[];
  keywords: string[];
  timeframeDays: number;
  now: Date;
  braveApiKey?: string;
  collectedTrends: CollectedTrendInput[];
  fetchJson?: FetchJson;
}): Promise<DiscoveryResult> {
  const fetchJson = input.fetchJson ?? defaultFetchJson;
  const lookback = lookbackDays(input.timeframeDays);
  const providerResults: DiscoveryResult["providerResults"] = {};
  const candidates: RawCandidate[] = [];

  type Job = {
    provider: SourceProvider;
    run: (query: string) => Promise<RawCandidate[]>;
    looseMatching: boolean;
  };
  const jobs: Job[] = [
    {
      provider: "hackernews",
      run: (q) => searchHackerNews(q, lookback, input.now, fetchJson),
      looseMatching: true,
    },
    {
      provider: "devto",
      run: (q) => searchDevTo(q, input.now, fetchJson),
      looseMatching: true,
    },
  ];
  if (input.braveApiKey) {
    const key = input.braveApiKey;
    jobs.push({
      provider: "brave",
      run: (q) => searchBraveNews(q, lookback, key, input.now, fetchJson),
      looseMatching: false,
    });
  } else {
    providerResults.brave = {
      ok: false,
      count: 0,
      skipped: true,
      error: "Not configured (BRAVE_SEARCH_API_KEY)",
    };
  }

  await Promise.all(
    jobs.map(async (job) => {
      const settled = await Promise.allSettled(
        input.queries.map((q) => job.run(q)),
      );
      const ok = settled.filter((s) => s.status === "fulfilled");
      const failed = settled.find((s) => s.status === "rejected");
      let count = 0;
      for (const s of ok) {
        for (const c of s.value) {
          if (
            job.looseMatching &&
            !mentionsAny(
              { title: c.title ?? "", snippet: c.snippet },
              input.keywords,
            )
          ) {
            continue;
          }
          candidates.push(c);
          count++;
        }
      }
      providerResults[job.provider] = {
        ok: ok.length > 0,
        count,
        ...(ok.length === 0 && failed && failed.status === "rejected"
          ? { error: safeError(failed.reason) }
          : {}),
      };
    }),
  );

  // Trends already collected by the scheduled collector (real source URLs
  // and dates as the collector stored them; ingestion time is NOT used as
  // a publication date).
  let collectedCount = 0;
  for (const t of input.collectedTrends) {
    if (!t.sourceUrl) continue;
    candidates.push({
      provider: "collected-trend",
      title: t.topic,
      publisher: t.sourceName,
      url: t.sourceUrl,
      discussionUrl: null,
      publishedAt: t.publishedAt,
      snippet: t.summary ? t.summary.slice(0, 600) : null,
    });
    collectedCount++;
  }
  providerResults["collected-trend"] = { ok: true, count: collectedCount };

  const valid = candidates
    .map((c) => validateSource(c))
    .filter((s): s is NonNullable<typeof s> => s !== null);

  const ran = Object.values(providerResults).filter((r) => r && !r.skipped);
  const externalRan = jobs.length;
  const externalFailed = jobs.filter(
    (j) => !providerResults[j.provider]?.ok,
  ).length;

  return {
    sources: dedupeAndRank(valid, input.now, input.timeframeDays).slice(
      0,
      MAX_SOURCES,
    ),
    providerResults,
    allFailed:
      externalRan > 0 &&
      externalFailed === externalRan &&
      collectedCount === 0 &&
      ran.length > 0,
  };
}
