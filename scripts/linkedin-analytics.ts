/**
 * LinkedIn Analytics Collector (a port of n8n/workflows/03-analytics-collector.json).
 *
 * Lists the published posts (GET /api/analytics/published-posts), reads
 * likes and comments for each from LinkedIn's Social Actions API and sends
 * the snapshots to POST /api/webhooks/analytics. Posts LinkedIn won't
 * report on are left out instead of being sent as zeros.
 *
 *   APP_BASE_URL=... ANALYTICS_WEBHOOK_SECRET=... LINKEDIN_ACCESS_TOKEN=... \
 *     node --experimental-strip-types scripts/linkedin-analytics.ts
 */
import { pathToFileURL } from "node:url";

export type PublishedPost = {
  scheduledPostId: string;
  publishedUrl?: string | null;
};

export type SocialActions = {
  likesSummary?: { totalLikes?: number };
  commentsSummary?: {
    aggregatedTotalComments?: number;
    totalFirstLevelComments?: number;
  };
};

export type Snapshot = {
  scheduledPostId: string;
  capturedAt: string;
  likes?: number;
  comments?: number;
};

/** publishedUrl looks like https://www.linkedin.com/feed/update/urn:li:share:123 */
export function extractUrn(
  publishedUrl: string | null | undefined,
): string | null {
  const match = (publishedUrl || "").match(/urn:li:[a-zA-Z]+:[a-zA-Z0-9]+/);
  return match ? match[0] : null;
}

/** Only metrics LinkedIn actually returned are included (the app treats every metric as optional). */
export function toSnapshot(
  scheduledPostId: string,
  actions: SocialActions,
  capturedAt = new Date(),
): Snapshot {
  const likes = actions.likesSummary?.totalLikes;
  const comments =
    actions.commentsSummary?.aggregatedTotalComments ??
    actions.commentsSummary?.totalFirstLevelComments;
  return {
    scheduledPostId,
    capturedAt: capturedAt.toISOString(),
    ...(typeof likes === "number" ? { likes } : {}),
    ...(typeof comments === "number" ? { comments } : {}),
  };
}

async function app(
  path: string,
  secret: string,
  init: RequestInit = {},
): Promise<Response> {
  const base = (process.env.APP_BASE_URL || "").replace(/\/+$/, "");
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "x-webhook-secret": secret,
      "Content-Type": "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok)
    throw new Error(
      `App ${init.method || "GET"} ${path} -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`,
    );
  return res;
}

async function main() {
  const secret = process.env.ANALYTICS_WEBHOOK_SECRET || "";
  const token = process.env.LINKEDIN_ACCESS_TOKEN || "";
  if (!process.env.APP_BASE_URL || !secret || !token) {
    // Not set up yet: skip quietly instead of failing every scheduled run.
    console.log(
      "Skipping: set APP_BASE_URL, ANALYTICS_WEBHOOK_SECRET and LINKEDIN_ACCESS_TOKEN to enable this workflow.",
    );
    return;
  }

  const { posts = [] } = (await (
    await app("/api/analytics/published-posts", secret)
  ).json()) as { posts?: PublishedPost[] };
  console.log(`${posts.length} published post(s).`);

  const snapshots: Snapshot[] = [];
  for (const post of posts) {
    const urn = extractUrn(post.publishedUrl);
    if (!urn) continue;
    const res = await fetch(
      `https://api.linkedin.com/v2/socialActions/${encodeURIComponent(urn)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Restli-Protocol-Version": "2.0.0",
        },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!res.ok) {
      console.warn(
        `  ${post.scheduledPostId}: skipped (LinkedIn HTTP ${res.status})`,
      );
      continue;
    }
    const snapshot = toSnapshot(
      post.scheduledPostId,
      (await res.json()) as SocialActions,
    );
    if (snapshot.likes !== undefined || snapshot.comments !== undefined)
      snapshots.push(snapshot);
  }

  if (snapshots.length === 0) return console.log("No new analytics.");
  const res = await app("/api/webhooks/analytics", secret, {
    method: "POST",
    body: JSON.stringify(snapshots),
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
