/**
 * Meta Publisher trigger. Unlike scripts/linkedin-publisher.ts this script
 * never sees a Facebook/Instagram token: the app keeps those encrypted and
 * publishes due variants itself. This job only calls
 * POST /api/scheduler/meta-publish and reports what happened.
 *
 * Runs on GitHub Actions (.github/workflows/meta-publisher.yml):
 *
 *   APP_BASE_URL=... META_PUBLISH_WEBHOOK_SECRET=... \
 *     node --experimental-strip-types scripts/meta-publisher.ts
 */
import { pathToFileURL } from "node:url";

export type MetaPublishResponse = {
  claimed: number;
  results: { variantId: string; outcome: string; message?: string }[];
};

/**
 * Meta publishing is optional. A repository that never set it up should not
 * get a failing run (and an email) every 15 minutes, so a blank secret or a
 * 503 from the app ("not configured") is a skip, not an error.
 */
export function skipReason(input: {
  secret: string | undefined;
  status?: number;
}): string | null {
  if (!input.secret) {
    return "META_PUBLISH_WEBHOOK_SECRET is not set; Meta publishing is not enabled. Skipping.";
  }
  if (input.status === 503) {
    return "The app reports Meta publishing is not configured (no META_PUBLISH_WEBHOOK_SECRET on the server). Skipping.";
  }
  return null;
}

/** One log line per variant; "failed"/"unconfirmed" make the run exit 1. */
export function summarize(response: MetaPublishResponse): {
  lines: string[];
  hasProblems: boolean;
} {
  const lines = response.results.map(
    (r) => `${r.variantId}: ${r.outcome}${r.message ? ` (${r.message})` : ""}`,
  );
  const hasProblems = response.results.some(
    (r) => r.outcome === "failed" || r.outcome === "unconfirmed",
  );
  return { lines, hasProblems };
}

async function main(): Promise<void> {
  const base = process.env.APP_BASE_URL?.replace(/\/$/, "");
  const secret = process.env.META_PUBLISH_WEBHOOK_SECRET;
  const notConfigured = skipReason({ secret });
  if (notConfigured) {
    console.log(notConfigured);
    return;
  }
  if (!base || !secret) {
    throw new Error("APP_BASE_URL is required.");
  }

  const res = await fetch(`${base}/api/scheduler/meta-publish`, {
    method: "POST",
    headers: { "x-webhook-secret": secret, "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(120_000),
  });
  const skipped = skipReason({ secret, status: res.status });
  if (skipped) {
    console.log(skipped);
    return;
  }
  if (!res.ok) {
    throw new Error(`meta-publish returned HTTP ${res.status}`);
  }

  const response = (await res.json()) as MetaPublishResponse;
  const { lines, hasProblems } = summarize(response);
  console.log(`Claimed ${response.claimed} due variant(s).`);
  for (const line of lines) console.log(line);
  if (hasProblems) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
