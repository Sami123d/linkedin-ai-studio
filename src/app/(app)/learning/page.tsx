import { LearningInsights } from "@/components/learning/learning-insights";
import { listLearningInsights } from "@/features/learning/actions";

export default async function LearningPage() {
  const insights = await listLearningInsights();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Learning insights
        </h1>
        <p className="text-muted-foreground">
          What&apos;s actually working across your published posts, and what
          to change in future content plans.
        </p>
      </div>

      <LearningInsights insights={insights} />
    </div>
  );
}
