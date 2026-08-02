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
import { runLearningInsight } from "@/features/learning/actions";
import type { LearningInsight, LearningStatus } from "@/generated/prisma/client";

const STATUS_VARIANT: Record<
  LearningStatus,
  "default" | "secondary" | "destructive"
> = {
  PENDING: "secondary",
  PROCESSING: "secondary",
  COMPLETED: "default",
  FAILED: "destructive",
};

const STATUS_LABEL: Record<LearningStatus, string> = {
  PENDING: "Pending",
  PROCESSING: "Processing",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

export function LearningInsights({
  insights,
}: {
  insights: LearningInsight[];
}) {
  const [generating, setGenerating] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    const result = await runLearningInsight();
    setGenerating(false);
    if ("error" in result) {
      setError(result.error);
    }
  }

  async function handleRetry(id: string) {
    setRetryingId(id);
    setError(null);
    const result = await runLearningInsight(id);
    setRetryingId(null);
    if ("error" in result) {
      setError(result.error);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={handleGenerate} disabled={generating}>
          {generating ? "Analyzing..." : "Generate insights"}
        </Button>
        {error && <p className="text-destructive text-sm">{error}</p>}
      </div>

      {insights.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No insight runs yet. Generate your first one once you have at
          least one published post with analytics reported in.
        </p>
      ) : (
        <div className="grid gap-4">
          {insights.map((insight) => (
            <Card key={insight.id}>
              <CardHeader className="flex-row items-start justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {new Date(insight.createdAt).toLocaleDateString()}
                    <Badge variant={STATUS_VARIANT[insight.status]}>
                      {STATUS_LABEL[insight.status]}
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    {insight.postsAnalyzed} post
                    {insight.postsAnalyzed === 1 ? "" : "s"} analyzed
                  </CardDescription>
                </div>
                {insight.status === "FAILED" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={retryingId === insight.id}
                    onClick={() => handleRetry(insight.id)}
                  >
                    {retryingId === insight.id ? "Retrying..." : "Retry"}
                  </Button>
                )}
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {insight.status === "FAILED" && insight.errorMessage && (
                  <p className="text-destructive text-sm">
                    {insight.errorMessage}
                  </p>
                )}
                {insight.status === "COMPLETED" && (
                  <div className="flex flex-col gap-3 text-sm">
                    <p className="whitespace-pre-wrap">{insight.summary}</p>
                    {insight.topPerformingPatterns.length > 0 && (
                      <div>
                        <p className="font-medium">What&apos;s working</p>
                        <ul className="text-muted-foreground list-inside list-disc">
                          {insight.topPerformingPatterns.map((p, i) => (
                            <li key={i}>{p}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {insight.underperformingPatterns.length > 0 && (
                      <div>
                        <p className="font-medium">What&apos;s not working</p>
                        <ul className="text-muted-foreground list-inside list-disc">
                          {insight.underperformingPatterns.map((p, i) => (
                            <li key={i}>{p}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {insight.recommendations.length > 0 && (
                      <div>
                        <p className="font-medium">Recommendations</p>
                        <ul className="text-muted-foreground list-inside list-disc">
                          {insight.recommendations.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <p className="text-muted-foreground text-xs">
                      Generated by {insight.provider} ({insight.model}) ·{" "}
                      {insight.attempts} attempt
                      {insight.attempts === 1 ? "" : "s"}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
