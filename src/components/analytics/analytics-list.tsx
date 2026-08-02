import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { computeEngagementRate } from "@/features/analytics/utils";
import type {
  AnalyticsSnapshot,
  ContentPlan,
  Draft,
  ResearchBrief,
  ScheduledPost,
  Trend,
} from "@/generated/prisma/client";

type Item = ScheduledPost & {
  draft: Draft & {
    contentPlan: ContentPlan & { research: ResearchBrief & { trend: Trend } };
  };
  analyticsSnapshots: AnalyticsSnapshot[];
};

const METRICS: {
  key: keyof Pick<
    AnalyticsSnapshot,
    "impressions" | "likes" | "comments" | "shares" | "clicks"
  >;
  label: string;
}[] = [
  { key: "impressions", label: "Impressions" },
  { key: "likes", label: "Likes" },
  { key: "comments", label: "Comments" },
  { key: "shares", label: "Shares" },
  { key: "clicks", label: "Clicks" },
];

export function AnalyticsList({ items }: { items: Item[] }) {
  if (items.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No published posts yet. Once n8n publishes something from your{" "}
        <a href="/calendar" className="underline underline-offset-4">
          calendar
        </a>
        , its engagement will show up here.
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      {items.map((post) => {
        const [latest, ...history] = post.analyticsSnapshots;
        const engagementRate = latest ? computeEngagementRate(latest) : null;

        return (
          <Card key={post.id}>
            <CardHeader>
              <CardTitle>{post.draft.contentPlan.research.trend.topic}</CardTitle>
              <CardDescription>
                Published{" "}
                {post.publishedAt &&
                  new Date(post.publishedAt).toLocaleDateString()}
                {post.publishedUrl && (
                  <>
                    {" · "}
                    <a
                      href={post.publishedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2"
                    >
                      View live post
                    </a>
                  </>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {!latest ? (
                <p className="text-muted-foreground text-sm">
                  No analytics reported yet.
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-4 text-sm">
                    {METRICS.map(({ key, label }) => (
                      <div key={key}>
                        <p className="text-muted-foreground text-xs">
                          {label}
                        </p>
                        <p className="font-medium">{latest[key] ?? "—"}</p>
                      </div>
                    ))}
                    <div>
                      <p className="text-muted-foreground text-xs">
                        Engagement rate
                      </p>
                      <p className="font-medium">
                        {engagementRate !== null
                          ? `${(engagementRate * 100).toFixed(1)}%`
                          : "—"}
                      </p>
                    </div>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    Last checked{" "}
                    {new Date(latest.capturedAt).toLocaleString()}
                  </p>
                  {history.length > 0 && (
                    <details className="text-sm">
                      <summary className="text-muted-foreground cursor-pointer">
                        {history.length} earlier snapshot
                        {history.length === 1 ? "" : "s"}
                      </summary>
                      <div className="mt-2 grid gap-1">
                        {history.map((snap) => (
                          <p
                            key={snap.id}
                            className="text-muted-foreground text-xs"
                          >
                            {new Date(snap.capturedAt).toLocaleString()} —{" "}
                            {snap.likes ?? 0} likes, {snap.comments ?? 0}{" "}
                            comments, {snap.shares ?? 0} shares
                            {snap.impressions !== null &&
                              `, ${snap.impressions} impressions`}
                          </p>
                        ))}
                      </div>
                    </details>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
