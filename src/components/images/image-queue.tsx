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
import { runImageGeneration } from "@/features/images/actions";
import type {
  ContentPlan,
  Draft,
  ImageAsset,
  ImageStatus,
  ResearchBrief,
  Trend,
} from "@/generated/prisma/client";

const STATUS_VARIANT: Record<
  ImageStatus,
  "default" | "secondary" | "destructive"
> = {
  PENDING: "secondary",
  PROCESSING: "secondary",
  COMPLETED: "default",
  FAILED: "destructive",
};

const STATUS_LABEL: Record<ImageStatus, string> = {
  PENDING: "Pending",
  PROCESSING: "Processing",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

export function ImageQueue({
  items,
}: {
  items: (Draft & {
    contentPlan: ContentPlan & { research: ResearchBrief & { trend: Trend } };
    imageAsset: ImageAsset | null;
  })[];
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function handleRun(draftId: string) {
    setPendingId(draftId);
    setErrors((prev) => ({ ...prev, [draftId]: "" }));
    const result = await runImageGeneration(draftId);
    setPendingId(null);
    if ("error" in result) {
      setErrors((prev) => ({ ...prev, [draftId]: result.error }));
    }
  }

  if (items.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No completed drafts yet. Write a draft on the{" "}
        <a href="/writing" className="underline underline-offset-4">
          Writing
        </a>{" "}
        page first.
      </p>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((draft) => {
        const image = draft.imageAsset;
        const isRunning = pendingId === draft.id;
        const buttonLabel = !image
          ? "Find image"
          : image.status === "FAILED"
            ? "Retry"
            : "Find another";

        return (
          <Card key={draft.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                {draft.contentPlan.research.trend.topic}
                {image && (
                  <Badge variant={STATUS_VARIANT[image.status]}>
                    {STATUS_LABEL[image.status]}
                  </Badge>
                )}
              </CardTitle>
              {image?.query && (
                <CardDescription>&ldquo;{image.query}&rdquo;</CardDescription>
              )}
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {image?.status === "COMPLETED" && image.url && (
                <div className="flex flex-col gap-1">
                  {/* eslint-disable-next-line @next/next/no-img-element -- external Unsplash URLs, not worth configuring remotePatterns for a single MVP queue view */}
                  <img
                    src={image.url}
                    alt={image.query ?? "Post image"}
                    className="aspect-video w-full rounded-lg object-cover"
                  />
                  {image.attributionName && (
                    <p className="text-muted-foreground text-xs">
                      Photo by{" "}
                      <a
                        href={image.attributionUrl ?? "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2"
                      >
                        {image.attributionName}
                      </a>{" "}
                      on{" "}
                      <a
                        href={image.sourceUrl ?? "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2"
                      >
                        Unsplash
                      </a>
                    </p>
                  )}
                </div>
              )}
              {image?.status === "FAILED" && image.errorMessage && (
                <p className="text-destructive text-sm">
                  {image.errorMessage}
                </p>
              )}
              {errors[draft.id] && (
                <p className="text-destructive text-sm">
                  {errors[draft.id]}
                </p>
              )}
              <Button
                size="sm"
                variant={image?.status === "FAILED" ? "outline" : "default"}
                disabled={isRunning || image?.status === "PROCESSING"}
                onClick={() => handleRun(draft.id)}
              >
                {isRunning ? "Searching..." : buttonLabel}
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
