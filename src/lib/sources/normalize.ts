import {
  discoveredSourceSchema,
  type DiscoveredSource,
} from "@/validation/research-studio";

/// Pure helpers for search results: cleaning, validation, URL
/// canonicalization, de-duplication and freshness. No I/O.

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
};

export function cleanText(value: unknown, max = 1000): string | null {
  if (typeof value !== "string") return null;
  const text = value
    // Block-level tags separate words; inline tags (b, a, em…) do not.
    .replace(/<\/?(?:br|p|div|li|ul|ol|h[1-6]|tr|td|blockquote)\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
      if (code[0] === "#") {
        const n =
          code[1]?.toLowerCase() === "x"
            ? parseInt(code.slice(2), 16)
            : parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n < 0x110000
          ? String.fromCodePoint(n)
          : " ";
      }
      return ENTITIES[code.toLowerCase()] ?? match;
    })
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const TRACKING_PARAMS =
  /^(utm_[a-z_]+|fbclid|gclid|dclid|mc_cid|mc_eid|ref|ref_src|igshid|si)$/i;

/// A comparable form of a URL: http(s) only, lowercase host without
/// "www.", no fragment, no tracking parameters, sorted query, no trailing
/// slash. Returns null for anything that isn't a valid http(s) URL.
export function canonicalizeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const params = [...url.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAMS.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = params.length
    ? `?${new URLSearchParams(params).toString()}`
    : "";
  let path = url.pathname.replace(/\/+$/, "");
  if (!path) path = "";
  const port = url.port ? `:${url.port}` : "";
  return `${url.protocol}//${host}${port}${path}${query}`;
}

/// Normalized title used to catch the same story under different URLs.
export function titleKey(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .slice(0, 160);
}

/// Parses a provider date; rejects invalid dates, dates more than a day in
/// the future (clock skew is fine, a wrong year is not) and dates before 1990
/// (usually an epoch-zero or missing-field default, not a real date).
export function parseDate(value: unknown, now: Date): Date | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getTime() > now.getTime() + 24 * 3_600_000) return null;
  if (date.getFullYear() < 1990) return null;
  return date;
}

export type Freshness = "recent" | "background" | "undated";

export function classifyFreshness(
  publishedAt: Date | null,
  now: Date,
  timeframeDays: number,
): Freshness {
  if (!publishedAt) return "undated";
  const cutoff = now.getTime() - timeframeDays * 24 * 3_600_000;
  return publishedAt.getTime() >= cutoff ? "recent" : "background";
}

export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/// Validates a candidate; returns null (dropped) when required data is
/// missing or malformed instead of guessing.
export function validateSource(candidate: unknown): DiscoveredSource | null {
  const parsed = discoveredSourceSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export type RankedSource = DiscoveredSource & {
  dedupeKey: string;
  freshness: Freshness;
};

/// Removes equivalent results (same canonical URL, or same normalized
/// title), keeping the first by provider priority and merging a discussion
/// link or date the kept copy lacks. Then orders: recent (newest first),
/// background (newest first), undated.
export function dedupeAndRank(
  sources: DiscoveredSource[],
  now: Date,
  timeframeDays: number,
): RankedSource[] {
  const byKey = new Map<string, RankedSource>();
  const titleToKey = new Map<string, string>();

  for (const source of sources) {
    const urlKey = canonicalizeUrl(source.url);
    if (!urlKey) continue;
    const tKey = titleKey(source.title);
    const existingKey = byKey.has(urlKey)
      ? urlKey
      : tKey
        ? titleToKey.get(tKey)
        : undefined;

    if (existingKey) {
      const kept = byKey.get(existingKey)!;
      if (!kept.discussionUrl && source.discussionUrl) {
        kept.discussionUrl = source.discussionUrl;
      }
      if (!kept.publishedAt && source.publishedAt) {
        kept.publishedAt = source.publishedAt;
        kept.freshness = classifyFreshness(
          source.publishedAt,
          now,
          timeframeDays,
        );
      }
      if (!kept.snippet && source.snippet) kept.snippet = source.snippet;
      continue;
    }

    byKey.set(urlKey, {
      ...source,
      dedupeKey: urlKey,
      freshness: classifyFreshness(source.publishedAt, now, timeframeDays),
    });
    if (tKey) titleToKey.set(tKey, urlKey);
  }

  const order: Record<Freshness, number> = {
    recent: 0,
    background: 1,
    undated: 2,
  };
  return [...byKey.values()].sort(
    (a, b) =>
      order[a.freshness] - order[b.freshness] ||
      (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
  );
}

const STOPWORDS = new Set(
  (
    "a an and are as at be by for from has have how in into is it its of on or " +
    "that the their this to was were what when where which who why will with " +
    "about after before over under between find search look recent latest new " +
    "trend trends trending news create write make post posts prioritize focus " +
    "developments development last past days day week weeks month months year " +
    "years seven thirty ninety educational business owners audience please " +
    "linkedin facebook instagram content article tone angle"
  ).split(" "),
);

/// Deterministic fallback when query extraction by the model fails.
export function keywordsFromText(text: string, max = 6): string[] {
  const seen = new Set<string>();
  for (const word of text
    .toLowerCase()
    .match(/[\p{L}\p{N}][\p{L}\p{N}+#.-]*/gu) ?? []) {
    const w = word.replace(/[.-]+$/, "");
    if (w.length < 2 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
    seen.add(w);
    if (seen.size >= max) break;
  }
  return [...seen];
}

/// Relevance guard for providers with loose matching: at least one keyword
/// must appear in the title or snippet.
export function mentionsAny(
  source: Pick<DiscoveredSource, "title" | "snippet">,
  keywords: string[],
): boolean {
  if (keywords.length === 0) return true;
  const haystack = `${source.title} ${source.snippet ?? ""}`.toLowerCase();
  return keywords.some((k) => haystack.includes(k.toLowerCase()));
}
