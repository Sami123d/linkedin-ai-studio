/**
 * Trend Collector (a port of n8n/workflows/01-trend-collector.json).
 *
 * Fetches 10 sources, normalizes them into one shape, deduplicates, scores,
 * categorizes, keeps the 30 best from the last 14 days and POSTs them to
 * `/api/webhooks/trends`. Same sources, keyword lists, scoring and category
 * rules as the n8n workflow, so either one can feed the app.
 *
 * Runs on GitHub Actions (.github/workflows/trend-collector.yml) with no
 * npm dependencies:
 *
 *   APP_BASE_URL=https://your-app.vercel.app TREND_WEBHOOK_SECRET=... \
 *     node --experimental-strip-types scripts/collect-trends.ts [--dry-run]
 *
 * Optional: PRODUCT_HUNT_TOKEN (Product Hunt developer token) and
 * GITHUB_TOKEN (raises the GitHub Search rate limit).
 */
import { pathToFileURL } from "node:url";

export type RawScoreType = "log" | "editorial" | "unranked";

export type NormalizedTrend = {
  topic: string;
  summary: string;
  sourceName: string;
  sourceUrl: string;
  rawScore: number | null;
  rawScoreType: RawScoreType;
  publishedAt: string | null;
  hintCategory: string | null;
};

export type TrendPayload = {
  topic: string;
  summary: string;
  sourceName: string;
  sourceUrl: string;
  category: string;
  score: number;
  publishedAt?: string;
};

export type FeedEntry = {
  title: string;
  link: string;
  isoDate: string | null;
  contentSnippet: string;
};

export const CATEGORIES = [
  "AI",
  "Web Development",
  "SaaS",
  "AI Agents",
  "Automation",
  "Startup",
];
const MAX_AGE_DAYS = 14;
const MAX_TRENDS = 30;
const USER_AGENT = "linkedin-ai-studio-trend-collector/1.0";

// ------------------------------------------------------------------ helpers

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (match, code: string) => {
      if (code[0] === "#") {
        const n =
          code[1].toLowerCase() === "x"
            ? parseInt(code.slice(2), 16)
            : parseInt(code.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : match;
      }
      return ENTITIES[code.toLowerCase()] ?? match;
    },
  );
}

export function stripTags(html: string): string {
  // Feeds often entity-encode their HTML, so decode first, strip, then decode what's left.
  return decodeEntities(decodeEntities(html).replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function unwrap(value: string): string {
  const cdata = value.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return cdata ? cdata[1] : value;
}

function tag(chunk: string, name: string): string | null {
  const m = chunk.match(
    new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"),
  );
  return m ? unwrap(m[1]) : null;
}

export function toIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function isHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Minimal RSS 2.0 + Atom parser: title, link, date and a plain-text snippet per entry. */
export function parseFeed(xml: string): FeedEntry[] {
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const chunks = xml.split(isAtom ? /<entry[\s>]/i : /<item[\s>]/i).slice(1);

  return chunks
    .map((chunk) => {
      const title = stripTags(tag(chunk, "title") ?? "");
      let link = "";
      if (isAtom) {
        const alternate =
          chunk.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/i) ??
          chunk.match(/<link[^>]*href="([^"]+)"/i);
        link = alternate ? decodeEntities(alternate[1]) : "";
      } else {
        link = decodeEntities((tag(chunk, "link") ?? "").trim());
      }
      const date = isAtom
        ? (tag(chunk, "published") ?? tag(chunk, "updated"))
        : (tag(chunk, "pubDate") ?? tag(chunk, "dc:date"));
      const body = isAtom
        ? (tag(chunk, "summary") ?? tag(chunk, "content"))
        : (tag(chunk, "description") ?? tag(chunk, "content:encoded"));
      return {
        title,
        link,
        isoDate: toIsoDate(date),
        contentSnippet: stripTags(body ?? ""),
      };
    })
    .filter((e) => e.title && e.link);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** fetch with the n8n workflow's retry policy: 3 tries, 5 s apart. */
async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  tries = 3,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) return res;
      lastError = new Error(`HTTP ${res.status} from ${url}`);
      if (res.status < 500 && res.status !== 429) break; // 4xx won't fix itself
    } catch (error) {
      lastError = error;
    }
    if (attempt < tries) await sleep(5_000);
  }
  throw lastError;
}

async function getJson<T>(
  url: string,
  headers: Record<string, string> = {},
): Promise<T> {
  const res = await fetchWithRetry(url, {
    headers: { "User-Agent": USER_AGENT, ...headers },
  });
  return (await res.json()) as T;
}

async function getFeed(url: string): Promise<FeedEntry[]> {
  const res = await fetchWithRetry(url, {
    headers: { "User-Agent": USER_AGENT },
  });
  return parseFeed(await res.text());
}

// ------------------------------------------------------------------ sources

const KEYWORD_CATEGORY: Record<string, string | null> = {
  AI: "AI",
  "Web Development": "Web Development",
  SaaS: "SaaS",
  Startup: "Startup",
  "Next.js": "Web Development",
  React: "Web Development",
  "AI Agents": "AI Agents",
  Automation: "Automation",
  LinkedIn: null,
};
const KEYWORDS = Object.keys(KEYWORD_CATEGORY);

type HnHit = {
  title?: string;
  url?: string;
  objectID: string;
  points?: number;
  num_comments?: number;
  created_at?: string;
};

async function hackerNews(): Promise<NormalizedTrend[]> {
  const out: NormalizedTrend[] = [];
  for (const keyword of KEYWORDS) {
    const q = new URLSearchParams({
      query: keyword,
      tags: "story",
      hitsPerPage: "5",
    });
    const data = await getJson<{ hits?: HnHit[] }>(
      `https://hn.algolia.com/api/v1/search_by_date?${q}`,
    );
    for (const hit of data.hits ?? []) {
      if (!hit.title) continue;
      out.push({
        topic: hit.title.slice(0, 300),
        summary: `${hit.points || 0} points, ${hit.num_comments || 0} comments on Hacker News.`,
        sourceName: "Hacker News",
        sourceUrl:
          hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
        rawScore: hit.points || 0,
        rawScoreType: "log",
        publishedAt: hit.created_at || null,
        hintCategory: KEYWORD_CATEGORY[keyword],
      });
    }
  }
  return out;
}

const DEVTO_TAGS: Record<string, string> = {
  ai: "AI",
  webdev: "Web Development",
  saas: "SaaS",
  startup: "Startup",
  nextjs: "Web Development",
  react: "Web Development",
  llm: "AI Agents",
  automation: "Automation",
};

type DevToArticle = {
  title?: string;
  description?: string;
  url: string;
  public_reactions_count?: number;
  comments_count?: number;
  published_timestamp?: string;
};

async function devTo(): Promise<NormalizedTrend[]> {
  const out: NormalizedTrend[] = [];
  for (const [tagName, category] of Object.entries(DEVTO_TAGS)) {
    const q = new URLSearchParams({ tag: tagName, top: "3", per_page: "5" });
    const articles = await getJson<DevToArticle[]>(
      `https://dev.to/api/articles?${q}`,
    );
    for (const a of articles ?? []) {
      if (!a.title) continue;
      out.push({
        topic: a.title.slice(0, 300),
        summary: (a.description || "").slice(0, 500),
        sourceName: "dev.to",
        sourceUrl: a.url,
        rawScore: (a.public_reactions_count || 0) + (a.comments_count || 0),
        rawScoreType: "log",
        publishedAt: a.published_timestamp || null,
        hintCategory: category,
      });
    }
  }
  return out;
}

const GITHUB_TOPICS: Record<string, string> = {
  "artificial-intelligence": "AI",
  web: "Web Development",
  saas: "SaaS",
  "ai-agents": "AI Agents",
  automation: "Automation",
  startup: "Startup",
};

type GhRepo = {
  full_name?: string;
  description?: string | null;
  html_url: string;
  stargazers_count?: number;
  pushed_at?: string;
  created_at?: string;
};

async function githubTrending(): Promise<NormalizedTrend[]> {
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  if (process.env.GITHUB_TOKEN)
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const out: NormalizedTrend[] = [];
  for (const [topic, category] of Object.entries(GITHUB_TOPICS)) {
    const q = new URLSearchParams({
      q: `topic:${topic} created:>${since}`,
      sort: "stars",
      order: "desc",
      per_page: "5",
    });
    const data = await getJson<{ items?: GhRepo[] }>(
      `https://api.github.com/search/repositories?${q}`,
      headers,
    );
    for (const repo of data.items ?? []) {
      if (!repo.full_name) continue;
      out.push({
        topic:
          `${repo.full_name}${repo.description ? ": " + repo.description : ""}`.slice(
            0,
            300,
          ),
        summary: (repo.description || "No description provided.").slice(0, 500),
        sourceName: "GitHub Trending",
        sourceUrl: repo.html_url,
        rawScore: repo.stargazers_count || 0,
        rawScoreType: "log",
        publishedAt: repo.pushed_at || repo.created_at || null,
        hintCategory: category,
      });
    }
  }
  return out;
}

type PhNode = {
  name?: string;
  tagline?: string;
  url: string;
  votesCount?: number;
  createdAt?: string;
  topics?: { edges?: { node: { name?: string } }[] };
};

async function productHunt(): Promise<NormalizedTrend[]> {
  const token = process.env.PRODUCT_HUNT_TOKEN;
  if (!token) return []; // optional source, same as disconnecting it in n8n
  const query =
    "query TodayPosts { posts(first: 20, order: RANKING) { edges { node { name tagline url votesCount commentsCount createdAt topics(first: 3) { edges { node { name } } } } } } }";
  const res = await fetchWithRetry(
    "https://api.producthunt.com/v2/api/graphql",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({ query }),
    },
  );
  const json = (await res.json()) as {
    data?: { posts?: { edges?: { node: PhNode }[] } };
  };
  const out: NormalizedTrend[] = [];
  for (const { node } of json.data?.posts?.edges ?? []) {
    if (!node?.name) continue;
    const topics = (node.topics?.edges ?? []).map((e) =>
      (e.node.name || "").toLowerCase(),
    );
    let hintCategory: string | null = null;
    if (topics.some((t) => t.includes("artificial") || t === "ai"))
      hintCategory = "AI";
    else if (topics.some((t) => t.includes("saas"))) hintCategory = "SaaS";
    else if (topics.some((t) => t.includes("developer") || t.includes("web")))
      hintCategory = "Web Development";
    else if (
      topics.some((t) => t.includes("productivity") || t.includes("automation"))
    )
      hintCategory = "Automation";
    else if (topics.some((t) => t.includes("startup")))
      hintCategory = "Startup";
    out.push({
      topic: `${node.name}${node.tagline ? " - " + node.tagline : ""}`.slice(
        0,
        300,
      ),
      summary: (node.tagline || "").slice(0, 500),
      sourceName: "Product Hunt",
      sourceUrl: node.url,
      rawScore: node.votesCount || 0,
      rawScoreType: "log",
      publishedAt: node.createdAt || null,
      hintCategory,
    });
  }
  return out;
}

function fromFeed(
  entries: FeedEntry[],
  sourceName: string,
  rawScoreType: RawScoreType,
  hintCategory: string | null,
  summary?: string,
): NormalizedTrend[] {
  return entries.map((e) => ({
    topic: e.title.slice(0, 300),
    summary: summary ?? e.contentSnippet.slice(0, 500),
    sourceName,
    sourceUrl: e.link,
    rawScore: null,
    rawScoreType,
    publishedAt: e.isoDate,
    hintCategory,
  }));
}

async function googleNews(): Promise<NormalizedTrend[]> {
  const out: NormalizedTrend[] = [];
  for (const keyword of KEYWORDS) {
    const entries = await getFeed(
      `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=en-US&gl=US&ceid=US:en`,
    );
    out.push(
      ...fromFeed(
        entries,
        "Google News",
        "unranked",
        KEYWORD_CATEGORY[keyword],
      ),
    );
  }
  return out;
}

const SUBREDDITS: [string, string][] = [
  ["artificial", "AI"],
  ["ChatGPT", "AI Agents"],
  ["webdev", "Web Development"],
  ["programming", "Web Development"],
  ["Entrepreneur", "Startup"],
];

async function reddit(): Promise<NormalizedTrend[]> {
  const out: NormalizedTrend[] = [];
  for (const [sub, category] of SUBREDDITS) {
    const entries = await getFeed(
      `https://www.reddit.com/r/${sub}/top/.rss?t=day&limit=10`,
    );
    out.push(
      ...fromFeed(
        entries,
        `Reddit (r/${sub})`,
        "unranked",
        category,
        `Trending on r/${sub}.`,
      ),
    );
  }
  return out;
}

const EDITORIAL_FEEDS: [string, string, string][] = [
  ["OpenAI News", "https://openai.com/news/rss.xml", "AI"],
  // Anthropic has no RSS feed; a Google News site filter stands in for it.
  [
    "Anthropic News",
    "https://news.google.com/rss/search?q=site:anthropic.com/news&hl=en-US&gl=US&ceid=US:en",
    "AI",
  ],
  ["Vercel Blog", "https://vercel.com/atom", "Web Development"],
  ["Next.js Blog", "https://nextjs.org/feed.xml", "Web Development"],
];

export const SOURCES: Record<string, () => Promise<NormalizedTrend[]>> = {
  "Hacker News": hackerNews,
  "dev.to": devTo,
  "GitHub Trending": githubTrending,
  "Product Hunt": productHunt,
  "Google News": googleNews,
  Reddit: reddit,
  ...Object.fromEntries(
    EDITORIAL_FEEDS.map(([name, url, category]) => [
      name,
      async () => fromFeed(await getFeed(url), name, "editorial", category),
    ]),
  ),
};

// ------------------------------------------------------------------ shared pipeline (identical rules to the n8n Code nodes)

/** Keeps one item per sourceUrl, preferring the copy with the higher rawScore. */
export function dedupe(items: NormalizedTrend[]): NormalizedTrend[] {
  const seen = new Map<string, NormalizedTrend>();
  for (const t of items) {
    if (!t.sourceUrl || !t.topic) continue;
    const key = t.sourceUrl.toLowerCase().trim();
    const existing = seen.get(key);
    const score = typeof t.rawScore === "number" ? t.rawScore : -1;
    const existingScore =
      existing && typeof existing.rawScore === "number"
        ? existing.rawScore
        : -1;
    if (!existing || score > existingScore) seen.set(key, t);
  }
  return [...seen.values()];
}

export function computeScore(
  t: Pick<NormalizedTrend, "rawScore" | "rawScoreType">,
): number {
  if (t.rawScoreType === "editorial") return 70;
  if (t.rawScoreType === "unranked") return 50;
  const raw = typeof t.rawScore === "number" && t.rawScore > 0 ? t.rawScore : 0;
  return Math.max(0, Math.min(100, Math.round(Math.log10(raw + 1) * 30)));
}

const KEYWORD_RULES: { category: string; pattern: RegExp }[] = [
  {
    category: "AI Agents",
    pattern: /\b(ai agent|autonomous agent|agentic|multi-agent)\b/i,
  },
  {
    category: "AI",
    pattern:
      /\b(artificial intelligence|machine learning|\bllm\b|\bgpt\b|gemini|claude|openai|anthropic|deep learning|neural network)\b/i,
  },
  {
    category: "Automation",
    pattern: /\b(automation|automate|workflow|no-code|low-code|n8n|zapier)\b/i,
  },
  {
    category: "SaaS",
    pattern: /\b(saas|subscription|b2b software|software as a service)\b/i,
  },
  {
    category: "Startup",
    pattern:
      /\b(startup|funding|venture capital|\bvc\b|seed round|series [abc]|founder)\b/i,
  },
  {
    category: "Web Development",
    pattern:
      /\b(react|next\.?js|javascript|typescript|frontend|front-end|web development|css|html|node\.js)\b/i,
  },
];

export function categorize(
  t: Pick<NormalizedTrend, "topic" | "summary" | "hintCategory">,
): string {
  if (t.hintCategory && CATEGORIES.includes(t.hintCategory))
    return t.hintCategory;
  const text = `${t.topic} ${t.summary || ""}`;
  return (
    KEYWORD_RULES.find((rule) => rule.pattern.test(text))?.category ?? "Other"
  );
}

/** Dedupe -> score -> categorize -> drop stale -> top 30, shaped for POST /api/webhooks/trends. */
export function buildPayload(
  items: NormalizedTrend[],
  now = Date.now(),
): TrendPayload[] {
  return dedupe(items)
    .filter((t) => isHttpUrl(t.sourceUrl))
    .map((t) => ({
      ...t,
      publishedAt: toIsoDate(t.publishedAt),
      score: computeScore(t),
      category: categorize(t),
    }))
    .filter(
      (t) =>
        !t.publishedAt ||
        (now - new Date(t.publishedAt).getTime()) / 86_400_000 <= MAX_AGE_DAYS,
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_TRENDS)
    .map((t) => ({
      topic: t.topic,
      summary: t.summary,
      sourceName: t.sourceName,
      sourceUrl: t.sourceUrl,
      category: t.category,
      score: t.score,
      ...(t.publishedAt ? { publishedAt: t.publishedAt } : {}),
    }));
}

// ------------------------------------------------------------------ entry point

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const baseUrl = (process.env.APP_BASE_URL || "").replace(/\/+$/, "");
  const secret = process.env.TREND_WEBHOOK_SECRET || "";
  if (!dryRun && (!baseUrl || !secret)) {
    console.error(
      "APP_BASE_URL and TREND_WEBHOOK_SECRET must be set (or pass --dry-run).",
    );
    process.exit(1);
  }

  // A failing source contributes zero items instead of stopping the run.
  const results = await Promise.all(
    Object.entries(SOURCES).map(async ([name, fetchSource]) => {
      try {
        const items = await fetchSource();
        console.log(`  ${name}: ${items.length} items`);
        return items;
      } catch (error) {
        console.warn(
          `  ${name}: failed (${error instanceof Error ? error.message : String(error)})`,
        );
        return [];
      }
    }),
  );

  const merged = results.flat();
  const trends = buildPayload(merged);
  console.log(
    `Collected ${merged.length} items, sending the top ${trends.length}.`,
  );

  if (trends.length === 0) return console.log("No new trends.");
  if (dryRun) return console.log(JSON.stringify(trends.slice(0, 5), null, 2));

  const res = await fetchWithRetry(`${baseUrl}/api/webhooks/trends`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-webhook-secret": secret },
    body: JSON.stringify(trends),
  });
  console.log(`App responded ${res.status}: ${await res.text()}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
