import { ResearchQueue } from "@/components/research/research-queue";
import { listResearchQueue } from "@/features/research/actions";

export default async function ResearchPage() {
  const trends = await listResearchQueue();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Research queue
        </h1>
        <p className="text-muted-foreground">
          Reviewed trends land here. Generate a structured research brief for
          each one before it moves on to the writing pipeline.
        </p>
      </div>

      <ResearchQueue trends={trends} />
    </div>
  );
}
