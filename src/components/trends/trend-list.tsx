"use client";

import { CheckIcon, ExternalLinkIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { updateTrendStatus } from "@/features/trends/actions";
import type { Trend, TrendStatus } from "@/generated/prisma/client";

const STATUS_LABEL: Record<TrendStatus, string> = {
  NEW: "New",
  REVIEWED: "Reviewed",
  DISMISSED: "Dismissed",
};

export function TrendList({ trends }: { trends: Trend[] }) {
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function setStatus(id: string, status: TrendStatus) {
    setPendingId(id);
    await updateTrendStatus(id, status);
    setPendingId(null);
  }

  if (trends.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No trends collected yet. Point your n8n workflow at{" "}
        <code className="bg-muted rounded px-1 py-0.5">
          POST /api/webhooks/trends
        </code>{" "}
        to start feeding this list.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {trends.map((trend) => (
        <Card key={trend.id}>
          <CardHeader className="flex-row items-start justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                {trend.topic}
                <Badge
                  variant={trend.status === "NEW" ? "default" : "secondary"}
                >
                  {STATUS_LABEL[trend.status]}
                </Badge>
              </CardTitle>
              {(trend.sourceName || trend.score !== null) && (
                <CardDescription>
                  {[
                    trend.sourceName,
                    trend.score !== null ? `score ${trend.score}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </CardDescription>
              )}
            </div>
            <div className="flex shrink-0 gap-1">
              {trend.sourceUrl && (
                <Button size="icon-sm" variant="ghost" render={<a
                  href={trend.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                />}>
                  <ExternalLinkIcon />
                  <span className="sr-only">Open source</span>
                </Button>
              )}
              {trend.status !== "REVIEWED" && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={pendingId === trend.id}
                  onClick={() => setStatus(trend.id, "REVIEWED")}
                >
                  <CheckIcon />
                  <span className="sr-only">Mark reviewed</span>
                </Button>
              )}
              {trend.status !== "DISMISSED" && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={pendingId === trend.id}
                  onClick={() => setStatus(trend.id, "DISMISSED")}
                >
                  <XIcon />
                  <span className="sr-only">Dismiss</span>
                </Button>
              )}
            </div>
          </CardHeader>
          {trend.summary && (
            <CardContent>
              <p className="text-muted-foreground text-sm whitespace-pre-wrap">
                {trend.summary}
              </p>
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  );
}
