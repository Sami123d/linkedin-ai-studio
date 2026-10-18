import { MonthCalendar } from "@/components/calendar/month-calendar";
import {
  listPlannedVariants,
  listScheduledPosts,
} from "@/features/calendar/actions";

export default async function CalendarPage() {
  const [posts, plannedVariants] = await Promise.all([
    listScheduledPosts(),
    listPlannedVariants(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Content calendar
        </h1>
        <p className="text-muted-foreground">
          Everything you&apos;ve approved, by date. LinkedIn posts go to the
          publisher; Facebook and Instagram entries are planned only.
        </p>
      </div>

      <MonthCalendar posts={posts} plannedVariants={plannedVariants} />
    </div>
  );
}
