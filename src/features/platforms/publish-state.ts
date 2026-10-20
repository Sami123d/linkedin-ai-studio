import type {
  ApprovalStatus,
  DraftStatus,
  VariantPlatform,
  VariantPublishStatus,
} from "@/generated/prisma/client";
import {
  composeCaption,
  validateVariantLimits,
} from "@/features/platforms/limits";
import type { PublishResult } from "@/lib/meta/publish-api";

/// Pure publishing rules, shared by the server actions, the scheduler route
/// and the UI, so they can be unit-tested without a database or Meta.

export type PublishableVariant = {
  platform: VariantPlatform;
  status: DraftStatus;
  approvalStatus: ApprovalStatus;
  publishStatus: VariantPublishStatus;
  content: string | null;
  hashtags: string[];
  includeImage: boolean;
  linkUrl: string | null;
  mediaUrl: string | null;
  mediaSourceUrl: string | null;
};

/// Why this variant can't be published right now, or null when it can.
/// `acknowledgeUnconfirmed` is the user confirming they checked the
/// platform after an ambiguous earlier attempt.
export function publishBlocker(
  variant: Pick<
    PublishableVariant,
    "status" | "approvalStatus" | "publishStatus" | "content"
  >,
  options: { acknowledgeUnconfirmed?: boolean } = {},
): string | null {
  if (variant.approvalStatus !== "APPROVED") {
    return "Only approved variants can be published.";
  }
  if (variant.status !== "COMPLETED" || !variant.content?.trim()) {
    return "The variant has no completed content to publish.";
  }
  switch (variant.publishStatus) {
    case "PUBLISHING":
      return "A publish is already in progress for this variant.";
    case "PUBLISHED":
      return "This variant is already published.";
    case "UNCONFIRMED":
      return options.acknowledgeUnconfirmed
        ? null
        : "An earlier attempt may have gone live. Check status first, or confirm you checked the platform before publishing again.";
    default:
      return null;
  }
}

/// Content/media problems that make a publish pointless; returns messages.
export function contentIssues(
  variant: PublishableVariant,
  currentImageUrl: string | null,
): string[] {
  const issues: string[] = [];
  const content = variant.content ?? "";
  issues.push(
    ...validateVariantLimits(variant.platform, content, variant.hashtags),
  );

  if (variant.platform === "INSTAGRAM") {
    if (!variant.mediaUrl) {
      issues.push("Instagram feed posts need an image; none is prepared.");
    }
  } else {
    if (variant.linkUrl && variant.includeImage) {
      issues.push("Choose either a link or an image for a Facebook post.");
    }
    if (!content.trim() && !variant.linkUrl && !variant.includeImage) {
      issues.push("The post has no text, link or image.");
    }
    if (variant.includeImage && !variant.mediaUrl) {
      issues.push("The image is not prepared for publishing.");
    }
  }

  const usesImage = variant.platform === "INSTAGRAM" || variant.includeImage;
  if (usesImage && variant.mediaUrl) {
    if (!currentImageUrl || variant.mediaSourceUrl !== currentImageUrl) {
      issues.push(
        "The campaign image changed after approval. Re-approve to prepare the new image.",
      );
    }
  }
  return issues;
}

export function publishCaption(variant: PublishableVariant): string {
  return composeCaption(variant.content ?? "", variant.hashtags);
}

// ── Display state ───────────────────────────────────────────────────────

export type VariantDisplayState =
  | "NOT_APPROVED"
  | "ACCOUNT_NOT_CONNECTED"
  | "APPROVED"
  | "SCHEDULED"
  | "PUBLISHING"
  | "PUBLISHED"
  | "FAILED"
  | "UNCONFIRMED";

export function deriveDisplayState(
  variant: {
    approvalStatus: ApprovalStatus;
    publishStatus: VariantPublishStatus;
    scheduledFor: Date | null;
  },
  accountReady: boolean,
  now = new Date(),
): VariantDisplayState {
  switch (variant.publishStatus) {
    case "PUBLISHED":
      return "PUBLISHED";
    case "PUBLISHING":
      return "PUBLISHING";
    case "UNCONFIRMED":
      return "UNCONFIRMED";
    case "FAILED":
      return "FAILED";
    default:
      break;
  }
  if (variant.approvalStatus !== "APPROVED") return "NOT_APPROVED";
  if (!accountReady) return "ACCOUNT_NOT_CONNECTED";
  if (variant.scheduledFor && variant.scheduledFor.getTime() > now.getTime()) {
    return "SCHEDULED";
  }
  return "APPROVED";
}

// ── Applying a platform result ──────────────────────────────────────────

/// DB fields + audit row for a finished attempt. A variant is only marked
/// PUBLISHED from a `published` result, i.e. after Meta returned an id.
export function applyPublishResult(
  result: PublishResult,
  now: Date,
  step: string,
) {
  const common = { publishingStartedAt: null };

  switch (result.kind) {
    case "published":
      return {
        variant: {
          ...common,
          publishStatus: "PUBLISHED" as const,
          publishedAt: now,
          publishedPostId: result.postId,
          publishedUrl: result.permalink ?? null,
          publishError: null,
          igContainerId: null,
        },
        audit: {
          step,
          outcome: "PUBLISHED" as const,
          platformPostId: result.postId,
          message: null as string | null,
        },
      };
    case "failed":
      return {
        variant: {
          ...common,
          publishStatus: "FAILED" as const,
          publishError: result.error.safeMessage,
          ...(result.resetContainer ? { igContainerId: null } : {}),
        },
        audit: {
          step,
          outcome: "FAILED" as const,
          platformPostId: null as string | null,
          message: result.error.safeMessage,
          errorCategory: result.error.category,
          errorCode: result.error.details.code ?? null,
          errorSubcode: result.error.details.subcode ?? null,
          httpStatus: result.error.details.httpStatus ?? null,
          traceId: result.error.details.traceId ?? null,
        },
      };
    case "unconfirmed":
      return {
        variant: {
          ...common,
          publishStatus: "UNCONFIRMED" as const,
          publishError: result.message,
          ...(result.containerId ? { igContainerId: result.containerId } : {}),
        },
        audit: {
          step,
          outcome: "UNCONFIRMED" as const,
          platformPostId: null as string | null,
          message: result.message,
          errorCategory: result.error?.category ?? "ambiguous",
          errorCode: result.error?.details.code ?? null,
          errorSubcode: result.error?.details.subcode ?? null,
          httpStatus: result.error?.details.httpStatus ?? null,
          traceId: result.error?.details.traceId ?? null,
        },
      };
    case "pending":
      return {
        variant: {
          ...common,
          publishStatus: "NOT_PUBLISHED" as const,
          publishError:
            "Instagram is still processing the image. Publish again in a minute; the same upload will be reused.",
          igContainerId: result.containerId,
        },
        audit: {
          step,
          outcome: "PENDING" as const,
          platformPostId: null as string | null,
          message: "Container still processing.",
        },
      };
  }
}

/// Where a scheduler-claimed or manual claim may start from.
export const MANUAL_CLAIMABLE: VariantPublishStatus[] = [
  "NOT_PUBLISHED",
  "FAILED",
];
/// The scheduler stops auto-claiming a variant after this many attempts; a
/// manual publish from the UI is still allowed.
export const MAX_AUTOMATIC_ATTEMPTS = 5;
