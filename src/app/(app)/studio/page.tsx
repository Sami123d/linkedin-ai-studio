import { ResearchRequestForm } from "@/components/studio/research-request-form";
import { ResearchRequestList } from "@/components/studio/research-request-list";
import {
  getTrendForPrefill,
  listResearchRequests,
} from "@/features/research-studio/actions";

/// Creating a request also runs source discovery (several API calls plus
/// one model call for search terms).
export const maxDuration = 60;

export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<{ trend?: string }>;
}) {
  const { trend } = await searchParams;
  const [requests, prefillTrend] = await Promise.all([
    listResearchRequests(),
    trend ? getTrendForPrefill(trend) : Promise.resolve(null),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Research Studio
        </h1>
        <p className="text-muted-foreground">
          Research a topic from real, dated sources, review the evidence, then
          turn it into LinkedIn, Facebook and Instagram posts.
        </p>
      </div>

      <ResearchRequestForm
        prefill={
          prefillTrend
            ? {
                trendId: prefillTrend.id,
                topic: prefillTrend.topic,
                category: prefillTrend.category,
              }
            : null
        }
      />

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Your research</h2>
        <ResearchRequestList items={requests} />
      </div>
    </div>
  );
}
