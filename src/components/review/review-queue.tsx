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
import { runQualityReview } from "@/features/review/actions";
import type {
  ContentPlan,
  Draft,
  QualityReview,
  ResearchBrief,
  ReviewStatus,
  Trend,
} from "@/generated/prisma/client";

const STATUS_VARIANT: Record<
  ReviewStatus,
  "default" | "secondary" | "destructive"
> = {
  PENDING: "secondary",
  PROCESSING: "secondary",
  COMPLETED: "default",
  FAILED: "destructive",
};

const STATUS_LABEL: Record<ReviewStatus, string> = {
  PENDING: "Pending",
  PROCESSING: "Processing",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

const DIMENSIONS: {
  key: keyof Pick<
    QualityReview,
    "hookScore" | "clarityScore" | "voiceMatchScore" | "valueScore" | "ctaScore"
  >;
  label: string;
}[] = [
  { key: "hookScore", label: "Hook" },
  { key: "clarityScore", label: "Clarity" },
  { key: "voiceMatchScore", label: "Voice match" },
  { key: "valueScore", label: "Value" },
  { key: "ctaScore", label: "CTA" },
];

export function ReviewQueue({
  items,
}: {
  items: (Draft & {
    contentPlan: ContentPlan & { research: ResearchBrief & { trend: Trend } };
    qualityReview: QualityReview | null;
  })[];
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function handleRun(draftId: string) {
    setPendingId(draftId);
    setErrors((prev) => ({ ...prev, [draftId]: "" }));
    const result = await runQualityReview(draftId);
    setPendingId(null);
    if ("error" in result) {
      setErrors((prev) => ({ ...prev, [draftId]: result.error }));
    }
  }

  if (items.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No completed drafts yet. Write a draft for a completed content plan
        on the{" "}
        <a href="/writing" className="underline underline-offset-4">
          Writing
        </a>{" "}
        page first.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {items.map((draft) => {
        const review = draft.qualityReview;
        const isRunning = pendingId === draft.id;
        const buttonLabel = !review
          ? "Review draft"
          : review.status === "FAILED"
            ? "Retry"
            : "Re-review";

        return (
          <Card key={draft.id}>
            <CardHeader className="flex-row items-start justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2">
                  {draft.contentPlan.research.trend.topic}
                  {review && (
                    <Badge variant={STATUS_VARIANT[review.status]}>
                      {STATUS_LABEL[review.status]}
                    </Badge>
                  )}
                  {review?.status === "COMPLETED" && review.verdict && (
                    <Badge
                      variant={
                        review.verdict === "APPROVED"
                          ? "default"
                          : "destructive"
                      }
                    >
                      {review.verdict === "APPROVED"
                        ? "Approved"
                        : "Needs revision"}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>{draft.contentPlan.format}</CardDescription>
              </div>
              <Button
                size="sm"
                variant={review?.status === "FAILED" ? "outline" : "default"}
                disabled={isRunning || review?.status === "PROCESSING"}
                onClick={() => handleRun(draft.id)}
              >
                {isRunning ? "Reviewing..." : buttonLabel}
              </Button>
            </CardHeader>
            <CardContent
              className={
                errors[draft.id] ||
                review?.status === "FAILED" ||
                review?.status === "COMPLETED"
                  ? "flex flex-col gap-3"
                  : "hidden"
              }
            >
              {errors[draft.id] && (
                <p className="text-destructive text-sm">
                  {errors[draft.id]}
                </p>
              )}
              {review?.status === "FAILED" && review.errorMessage && (
                <p className="text-destructive text-sm">
                  Last attempt failed: {review.errorMessage}
                </p>
              )}
              {review?.status === "COMPLETED" && (
                <div className="flex flex-col gap-3 text-sm">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-medium">
                      Overall: {review.overallScore}/100
                    </span>
                    {DIMENSIONS.map(({ key, label }) => (
                      <span key={key} className="text-muted-foreground">
                        {label}: {review[key]}
                      </span>
                    ))}
                  </div>
                  {review.strengths.length > 0 && (
                    <div>
                      <p className="font-medium">Strengths</p>
                      <ul className="text-muted-foreground list-inside list-disc">
                        {review.strengths.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {review.feedback.length > 0 && (
                    <div>
                      <p className="font-medium">Feedback</p>
                      <ul className="text-muted-foreground list-inside list-disc">
                        {review.feedback.map((f, i) => (
                          <li key={i}>{f}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p className="text-muted-foreground text-xs">
                    Generated by {review.provider} ({review.model}) ·{" "}
                    {review.attempts} attempt{review.attempts === 1 ? "" : "s"}
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
