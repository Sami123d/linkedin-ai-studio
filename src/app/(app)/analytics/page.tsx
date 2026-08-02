import { AnalyticsList } from "@/components/analytics/analytics-list";
import { listAnalytics } from "@/features/analytics/actions";

export default async function AnalyticsPage() {
  const items = await listAnalytics();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-muted-foreground">
          Engagement on what you&apos;ve published, reported in by your n8n
          analytics workflow.
        </p>
      </div>

      <AnalyticsList items={items} />
    </div>
  );
}
