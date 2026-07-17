import { MonthCalendar } from "@/components/calendar/month-calendar";
import { listScheduledPosts } from "@/features/calendar/actions";

export default async function CalendarPage() {
  const posts = await listScheduledPosts();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Content calendar
        </h1>
        <p className="text-muted-foreground">
          Everything you&apos;ve approved, by publish date.
        </p>
      </div>

      <MonthCalendar posts={posts} />
    </div>
  );
}
