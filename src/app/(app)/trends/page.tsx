import { TrendList } from "@/components/trends/trend-list";
import { listTrends } from "@/features/trends/actions";

export default async function TrendsPage() {
  const trends = await listTrends();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Trending topics
        </h1>
        <p className="text-muted-foreground">
          Collected by your n8n workflow via the trend webhook. Review and
          dismiss here — what you keep feeds the Research Agent next.
        </p>
      </div>

      <TrendList trends={trends} />
    </div>
  );
}
