"use client";

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
import { runResearch } from "@/features/research/actions";
import type { ResearchBrief, ResearchStatus, Trend } from "@/generated/prisma/client";

const STATUS_VARIANT: Record<
  ResearchStatus,
  "default" | "secondary" | "destructive"
> = {
  PENDING: "secondary",
  PROCESSING: "secondary",
  COMPLETED: "default",
  FAILED: "destructive",
};

const STATUS_LABEL: Record<ResearchStatus, string> = {
  PENDING: "Pending",
  PROCESSING: "Processing",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

const SECTIONS: {
  key: keyof Pick<
    ResearchBrief,
    | "keyInsights"
    | "marketOpportunities"
    | "risks"
    | "statistics"
    | "contentAngles"
  >;
  label: string;
}[] = [
  { key: "keyInsights", label: "Key insights" },
  { key: "marketOpportunities", label: "Market opportunities" },
  { key: "risks", label: "Risks / challenges" },
  { key: "statistics", label: "Statistics & facts" },
  { key: "contentAngles", label: "Suggested content angles" },
];

export function ResearchQueue({
  trends,
}: {
  trends: (Trend & { researchBrief: ResearchBrief | null })[];
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function handleRun(trendId: string) {
    setPendingId(trendId);
    setErrors((prev) => ({ ...prev, [trendId]: "" }));
    const result = await runResearch(trendId);
    setPendingId(null);
    if ("error" in result) {
      setErrors((prev) => ({ ...prev, [trendId]: result.error }));
    }
  }

  if (trends.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No reviewed trends yet. Mark a trend as reviewed on the{" "}
        <a href="/trends" className="underline underline-offset-4">
          Trends
        </a>{" "}
        page to send it to the research queue.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {trends.map((trend) => {
        const brief = trend.researchBrief;
        const isRunning = pendingId === trend.id;
        const buttonLabel = !brief
          ? "Generate research"
          : brief.status === "FAILED"
            ? "Retry"
            : "Regenerate";

        return (
          <Card key={trend.id}>
            <CardHeader className="flex-row items-start justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2">
                  {trend.topic}
                  {brief && (
                    <Badge variant={STATUS_VARIANT[brief.status]}>
                      {STATUS_LABEL[brief.status]}
                    </Badge>
                  )}
                </CardTitle>
                {trend.sourceName && (
                  <CardDescription>{trend.sourceName}</CardDescription>
                )}
              </div>
              <Button
                size="sm"
                variant={brief?.status === "FAILED" ? "outline" : "default"}
                disabled={isRunning || brief?.status === "PROCESSING"}
                onClick={() => handleRun(trend.id)}
              >
                {isRunning ? "Generating..." : buttonLabel}
              </Button>
            </CardHeader>
            <CardContent
              className={
                errors[trend.id] || brief?.status === "FAILED" || brief?.status === "COMPLETED"
                  ? "flex flex-col gap-3"
                  : "hidden"
              }
            >
              {errors[trend.id] && (
                <p className="text-destructive text-sm">
                  {errors[trend.id]}
                </p>
              )}
              {brief?.status === "FAILED" && brief.errorMessage && (
                <p className="text-destructive text-sm">
                  Last attempt failed: {brief.errorMessage}
                </p>
              )}
              {brief?.status === "COMPLETED" && (
                <div className="flex flex-col gap-3 text-sm">
                  <p className="whitespace-pre-wrap">
                    {brief.executiveSummary}
                  </p>
                  {SECTIONS.map(({ key, label }) => {
                    const items = brief[key];
                    if (!items || items.length === 0) return null;
                    return (
                      <div key={key}>
                        <p className="font-medium">{label}</p>
                        <ul className="text-muted-foreground list-inside list-disc">
                          {items.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                  <p className="text-muted-foreground text-xs">
                    Generated by {brief.provider} ({brief.model}) ·{" "}
                    {brief.attempts} attempt{brief.attempts === 1 ? "" : "s"}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
