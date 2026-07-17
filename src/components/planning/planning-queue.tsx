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
import { runContentPlan } from "@/features/planning/actions";
import type { ContentPlan, PlanStatus, ResearchBrief, Trend } from "@/generated/prisma/client";

const STATUS_VARIANT: Record<
  PlanStatus,
  "default" | "secondary" | "destructive"
> = {
  PENDING: "secondary",
  PROCESSING: "secondary",
  COMPLETED: "default",
  FAILED: "destructive",
};

const STATUS_LABEL: Record<PlanStatus, string> = {
  PENDING: "Pending",
  PROCESSING: "Processing",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

const FORMAT_LABEL: Record<string, string> = {
  SINGLE_POST: "Single post",
  CAROUSEL: "Carousel",
  ARTICLE: "Article",
};

export function PlanningQueue({
  items,
}: {
  items: (ResearchBrief & {
    trend: Trend;
    contentPlan: ContentPlan | null;
  })[];
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function handleRun(researchId: string) {
    setPendingId(researchId);
    setErrors((prev) => ({ ...prev, [researchId]: "" }));
    const result = await runContentPlan(researchId);
    setPendingId(null);
    if ("error" in result) {
      setErrors((prev) => ({ ...prev, [researchId]: result.error }));
    }
  }

  if (items.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No completed research yet. Generate research for a reviewed trend on
        the{" "}
        <a href="/research" className="underline underline-offset-4">
          Research
        </a>{" "}
        page first.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {items.map((item) => {
        const plan = item.contentPlan;
        const isRunning = pendingId === item.id;
        const buttonLabel = !plan
          ? "Plan content"
          : plan.status === "FAILED"
            ? "Retry"
            : "Replan";

        return (
          <Card key={item.id}>
            <CardHeader className="flex-row items-start justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2">
                  {item.trend.topic}
                  {plan && (
                    <Badge variant={STATUS_VARIANT[plan.status]}>
                      {STATUS_LABEL[plan.status]}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>Research completed</CardDescription>
              </div>
              <Button
                size="sm"
                variant={plan?.status === "FAILED" ? "outline" : "default"}
                disabled={isRunning || plan?.status === "PROCESSING"}
                onClick={() => handleRun(item.id)}
              >
                {isRunning ? "Planning..." : buttonLabel}
              </Button>
            </CardHeader>
            <CardContent
              className={
                errors[item.id] ||
                plan?.status === "FAILED" ||
                plan?.status === "COMPLETED"
                  ? "flex flex-col gap-3"
                  : "hidden"
              }
            >
              {errors[item.id] && (
                <p className="text-destructive text-sm">{errors[item.id]}</p>
              )}
              {plan?.status === "FAILED" && plan.errorMessage && (
                <p className="text-destructive text-sm">
                  Last attempt failed: {plan.errorMessage}
                </p>
              )}
              {plan?.status === "COMPLETED" && (
                <div className="flex flex-col gap-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    {plan.format && (
                      <Badge variant="secondary">
                        {FORMAT_LABEL[plan.format] ?? plan.format}
                      </Badge>
                    )}
                    {plan.selectedAngle && (
                      <span className="text-muted-foreground">
                        Angle: {plan.selectedAngle}
                      </span>
                    )}
                  </div>
                  {plan.hook && (
                    <div>
                      <p className="font-medium">Hook</p>
                      <p className="text-muted-foreground whitespace-pre-wrap">
                        {plan.hook}
                      </p>
                    </div>
                  )}
                  {plan.keyMessage && (
                    <div>
                      <p className="font-medium">Key message</p>
                      <p className="text-muted-foreground whitespace-pre-wrap">
                        {plan.keyMessage}
                      </p>
                    </div>
                  )}
                  {plan.outline.length > 0 && (
                    <div>
                      <p className="font-medium">Outline</p>
                      <ul className="text-muted-foreground list-inside list-disc">
                        {plan.outline.map((line, i) => (
                          <li key={i}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {plan.toneGuidance && (
                    <div>
                      <p className="font-medium">Tone</p>
                      <p className="text-muted-foreground">
                        {plan.toneGuidance}
                      </p>
                    </div>
                  )}
                  {plan.callToAction && (
                    <div>
                      <p className="font-medium">Call to action</p>
                      <p className="text-muted-foreground">
                        {plan.callToAction}
                      </p>
                    </div>
                  )}
                  <p className="text-muted-foreground text-xs">
                    Generated by {plan.provider} ({plan.model}) ·{" "}
                    {plan.attempts} attempt{plan.attempts === 1 ? "" : "s"}
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
