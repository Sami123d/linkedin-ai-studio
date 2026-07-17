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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { approveDraft, rejectDraft } from "@/features/approval/actions";
import type {
  ContentPlan,
  Draft,
  ImageAsset,
  QualityReview,
  ResearchBrief,
  ScheduledPost,
  Trend,
} from "@/generated/prisma/client";

type QueueItem = Draft & {
  contentPlan: ContentPlan & { research: ResearchBrief & { trend: Trend } };
  qualityReview: QualityReview | null;
  imageAsset: ImageAsset | null;
  scheduledPost: ScheduledPost | null;
};

/// Local datetime-local inputs need "YYYY-MM-DDTHH:mm" with no timezone
/// suffix; a plain ISO string default 1 hour from now gives the user a
/// sane starting point instead of an empty picker.
function defaultScheduleValue(): string {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setSeconds(0, 0);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

export function ApprovalQueue({ items }: { items: QueueItem[] }) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [scheduleValues, setScheduleValues] = useState<Record<string, string>>(
    {},
  );
  const [reasonValues, setReasonValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function handleApprove(draftId: string) {
    const scheduledFor = scheduleValues[draftId] ?? defaultScheduleValue();
    setPendingId(draftId);
    setErrors((prev) => ({ ...prev, [draftId]: "" }));
    const result = await approveDraft(draftId, scheduledFor);
    setPendingId(null);
    if ("error" in result) {
      setErrors((prev) => ({ ...prev, [draftId]: result.error }));
    }
  }

  async function handleReject(draftId: string) {
    setPendingId(draftId);
    setErrors((prev) => ({ ...prev, [draftId]: "" }));
    const result = await rejectDraft(draftId, reasonValues[draftId] ?? "");
    setPendingId(null);
    if ("error" in result) {
      setErrors((prev) => ({ ...prev, [draftId]: result.error }));
    }
  }

  if (items.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No completed drafts yet. Write and review a draft first.
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      {items.map((draft) => {
        const scheduled = draft.scheduledPost;
        const isPending = pendingId === draft.id;

        return (
          <Card key={draft.id}>
            <CardHeader className="flex-row items-start justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2">
                  {draft.contentPlan.research.trend.topic}
                  {scheduled?.approvalStatus === "APPROVED" && (
                    <Badge>Scheduled</Badge>
                  )}
                  {scheduled?.approvalStatus === "REJECTED" && (
                    <Badge variant="destructive">Rejected</Badge>
                  )}
                  {draft.qualityReview?.status === "COMPLETED" && (
                    <Badge variant="secondary">
                      Quality {draft.qualityReview.overallScore}/100
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>{draft.contentPlan.format}</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {draft.imageAsset?.status === "COMPLETED" && draft.imageAsset.url && (
                // eslint-disable-next-line @next/next/no-img-element -- external Unsplash URL, same as the Images queue
                <img
                  src={draft.imageAsset.url}
                  alt=""
                  className="aspect-video w-full rounded-lg object-cover"
                />
              )}
              {draft.content && (
                <p className="text-sm whitespace-pre-wrap">{draft.content}</p>
              )}
              {draft.slides.length > 0 && (
                <div className="grid gap-2">
                  {draft.slides.map((slide, i) => (
                    <div key={i} className="rounded-lg border p-3 text-sm">
                      <p className="text-muted-foreground mb-1 text-xs font-medium">
                        Slide {i + 1}
                      </p>
                      <p className="whitespace-pre-wrap">{slide}</p>
                    </div>
                  ))}
                </div>
              )}
              {draft.hashtags.length > 0 && (
                <p className="text-muted-foreground text-sm">
                  {draft.hashtags.map((h) => `#${h}`).join(" ")}
                </p>
              )}

              {draft.qualityReview?.status === "COMPLETED" &&
                draft.qualityReview.feedback.length > 0 && (
                  <div className="bg-muted/50 rounded-lg p-3 text-sm">
                    <p className="mb-1 font-medium">Review feedback</p>
                    <ul className="text-muted-foreground list-inside list-disc">
                      {draft.qualityReview.feedback.map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  </div>
                )}

              {errors[draft.id] && (
                <p className="text-destructive text-sm">
                  {errors[draft.id]}
                </p>
              )}

              {scheduled?.approvalStatus === "APPROVED" && scheduled.scheduledFor ? (
                <p className="text-sm">
                  Scheduled for{" "}
                  {new Date(scheduled.scheduledFor).toLocaleString()}
                </p>
              ) : scheduled?.approvalStatus === "REJECTED" ? (
                <p className="text-muted-foreground text-sm">
                  Rejected
                  {scheduled.rejectionReason
                    ? `: ${scheduled.rejectionReason}`
                    : "."}
                </p>
              ) : (
                <div className="flex flex-wrap items-end gap-3 border-t pt-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`schedule-${draft.id}`}>
                      Publish date &amp; time
                    </Label>
                    <Input
                      id={`schedule-${draft.id}`}
                      type="datetime-local"
                      value={scheduleValues[draft.id] ?? defaultScheduleValue()}
                      onChange={(e) =>
                        setScheduleValues((prev) => ({
                          ...prev,
                          [draft.id]: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <Button
                    size="sm"
                    disabled={isPending}
                    onClick={() => handleApprove(draft.id)}
                  >
                    {isPending ? "Saving..." : "Approve & schedule"}
                  </Button>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`reason-${draft.id}`}>
                      Rejection reason (optional)
                    </Label>
                    <Input
                      id={`reason-${draft.id}`}
                      value={reasonValues[draft.id] ?? ""}
                      onChange={(e) =>
                        setReasonValues((prev) => ({
                          ...prev,
                          [draft.id]: e.target.value,
                        }))
                      }
                      placeholder="Why this isn't ready"
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => handleReject(draft.id)}
                  >
                    Reject
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
