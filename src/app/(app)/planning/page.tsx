import { PlanningQueue } from "@/components/planning/planning-queue";
import { listPlanningQueue } from "@/features/planning/actions";

export default async function PlanningPage() {
  const items = await listPlanningQueue();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Content planning
        </h1>
        <p className="text-muted-foreground">
          Turn completed research into a concrete plan — format, angle,
          hook, and outline — personalized to your Knowledge Base and goals.
        </p>
      </div>

      <PlanningQueue items={items} />
    </div>
  );
}
