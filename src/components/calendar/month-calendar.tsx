"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ContentPlan, Draft, ResearchBrief, ScheduledPost, Trend } from "@/generated/prisma/client";

type CalendarPost = ScheduledPost & {
  draft: Draft & {
    contentPlan: ContentPlan & { research: ResearchBrief & { trend: Trend } };
  };
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function startOfMonth(year: number, month: number): Date {
  return new Date(year, month, 1);
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function MonthCalendar({ posts }: { posts: CalendarPost[] }) {
  const today = useMemo(() => new Date(), []);
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const postsByDay = useMemo(() => {
    const map = new Map<number, CalendarPost[]>();
    for (const post of posts) {
      if (!post.scheduledFor) continue;
      const date = new Date(post.scheduledFor);
      if (date.getFullYear() !== viewYear || date.getMonth() !== viewMonth) {
        continue;
      }
      const day = date.getDate();
      const existing = map.get(day) ?? [];
      existing.push(post);
      map.set(day, existing);
    }
    return map;
  }, [posts, viewYear, viewMonth]);

  const firstWeekday = startOfMonth(viewYear, viewMonth).getDay();
  const totalDays = daysInMonth(viewYear, viewMonth);
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ];

  function goToPreviousMonth() {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function goToNextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  const monthLabel = startOfMonth(viewYear, viewMonth).toLocaleDateString(
    "en-US",
    { month: "long", year: "numeric" },
  );

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{monthLabel}</CardTitle>
          <div className="flex gap-1">
            <Button size="icon-sm" variant="ghost" onClick={goToPreviousMonth}>
              <ChevronLeft />
              <span className="sr-only">Previous month</span>
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={goToNextMonth}>
              <ChevronRight />
              <span className="sr-only">Next month</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border text-sm">
            {WEEKDAY_LABELS.map((label) => (
              <div
                key={label}
                className="bg-muted text-muted-foreground p-2 text-center text-xs font-medium"
              >
                {label}
              </div>
            ))}
            {cells.map((day, i) => {
              const isToday =
                day !== null &&
                viewYear === today.getFullYear() &&
                viewMonth === today.getMonth() &&
                day === today.getDate();
              const dayPosts = day !== null ? (postsByDay.get(day) ?? []) : [];

              return (
                <div
                  key={i}
                  className="bg-background min-h-24 border-t p-1.5 first:border-t-0"
                >
                  {day !== null && (
                    <>
                      <p
                        className={
                          isToday
                            ? "bg-primary text-primary-foreground mb-1 inline-flex size-5 items-center justify-center rounded-full text-xs"
                            : "text-muted-foreground mb-1 text-xs"
                        }
                      >
                        {day}
                      </p>
                      <div className="flex flex-col gap-1">
                        {dayPosts.map((post) => (
                          <p
                            key={post.id}
                            title={post.draft.contentPlan.research.trend.topic}
                            className="bg-secondary text-secondary-foreground truncate rounded px-1 py-0.5 text-xs"
                          >
                            {post.draft.contentPlan.research.trend.topic}
                          </p>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 text-lg font-medium">Upcoming</h2>
        {posts.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nothing scheduled yet. Approve a draft on the{" "}
            <a href="/approval" className="underline underline-offset-4">
              Approval
            </a>{" "}
            page to put it on the calendar.
          </p>
        ) : (
          <div className="grid gap-2">
            {posts.map((post) => (
              <Card key={post.id}>
                <CardContent className="flex flex-col gap-1 py-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {post.draft.contentPlan.research.trend.topic}
                    </span>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">
                        {post.draft.contentPlan.format}
                      </Badge>
                      {post.publishedAt ? (
                        <Badge>Published</Badge>
                      ) : post.publishError ? (
                        <Badge variant="destructive">Publish failed</Badge>
                      ) : (
                        <Badge variant="secondary">Awaiting publish</Badge>
                      )}
                      <span className="text-muted-foreground text-sm">
                        {post.scheduledFor &&
                          new Date(post.scheduledFor).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  {post.publishedAt && post.publishedUrl && (
                    <a
                      href={post.publishedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground text-xs underline underline-offset-2"
                    >
                      View live post
                    </a>
                  )}
                  {post.publishError && !post.publishedAt && (
                    <p className="text-destructive text-xs">
                      {post.publishError}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
