import "server-only";

import { serverEnv } from "@/config/env.server";
import { prisma } from "@/db/prisma";
import {
  applyPublishResult,
  contentIssues,
  publishCaption,
  type PublishableVariant,
} from "@/features/platforms/publish-state";
import { cleanupAfterPublish } from "@/features/platforms/media-cleanup";
import { decryptToken } from "@/lib/crypto/token-crypto";
import { MetaApiError, type GraphDeps } from "@/lib/meta/graph";
import {
  publishFacebookPost,
  publishInstagramImage,
  reconcileFacebook,
  reconcileInstagram,
  type PublishResult,
} from "@/lib/meta/publish-api";

/// Server-only publishing orchestration. A variant must already be CLAIMED
/// (publishStatus = PUBLISHING, publishAttempts incremented) by a conditional
/// UPDATE before `executePublish` runs, which is what keeps two concurrent
/// callers (Publish now, scheduler runs) from publishing the same variant.

export function graphDeps(): GraphDeps {
  return { version: serverEnv.META_GRAPH_API_VERSION };
}

/// A claim that never finished (crashed or killed request, a failed status
/// write) may have reached Meta, so it becomes UNCONFIRMED rather than being
/// retried. Runs from the scheduler (all profiles) and when a profile opens
/// /platforms, so it works even without the scheduled job.
export const STALE_CLAIM_MINUTES = 15;

export async function sweepStalePublishing(profileId?: string) {
  return prisma.platformVariant.updateMany({
    where: {
      ...(profileId ? { profileId } : {}),
      publishStatus: "PUBLISHING",
      publishingStartedAt: {
        lt: new Date(Date.now() - STALE_CLAIM_MINUTES * 60 * 1000),
      },
    },
    data: {
      publishStatus: "UNCONFIRMED",
      publishingStartedAt: null,
      publishError:
        "A publish attempt did not finish. It may have gone live: use Check status before retrying.",
    },
  });
}

export type PublishSummary =
  | { outcome: "published"; url?: string }
  | { outcome: "pending"; message: string }
  | { outcome: "failed"; message: string }
  | { outcome: "unconfirmed"; message: string };

type RecordInput = {
  variantId: string;
  profileId: string;
  attemptNumber: number;
  targetAccountId: string | null;
  step: string;
  result: PublishResult;
  startedAt: Date;
  markReauth?: { connectionId: string };
};

async function recordResult(input: RecordInput): Promise<void> {
  const now = new Date();
  const { variant, audit } = applyPublishResult(input.result, now, input.step);

  const writes = [
    prisma.platformVariant.updateMany({
      where: { id: input.variantId, profileId: input.profileId },
      data: { ...variant, targetAccountId: input.targetAccountId },
    }),
    prisma.variantPublishAttempt.create({
      data: {
        variantId: input.variantId,
        attemptNumber: input.attemptNumber,
        targetAccountId: input.targetAccountId,
        startedAt: input.startedAt,
        completedAt: now,
        ...audit,
      },
    }),
    ...(input.markReauth
      ? [
          prisma.metaConnection.updateMany({
            where: {
              id: input.markReauth.connectionId,
              profileId: input.profileId,
            },
            data: {
              status: "NEEDS_REAUTH" as const,
              lastError:
                input.result.kind === "failed"
                  ? input.result.error.safeMessage
                  : null,
            },
          }),
        ]
      : []),
  ];

  // The platform call already happened; if this write fails, retry once
  // before giving up (a stuck PUBLISHING row is turned into UNCONFIRMED by
  // the stale-claim sweep, never retried blindly).
  try {
    await prisma.$transaction(writes);
  } catch {
    await prisma.$transaction(writes);
  }
}

function summarize(result: PublishResult): PublishSummary {
  switch (result.kind) {
    case "published":
      return { outcome: "published", url: result.permalink };
    case "pending":
      return {
        outcome: "pending",
        message:
          "Instagram is still processing the image. Publish again in a minute.",
      };
    case "failed":
      return { outcome: "failed", message: result.error.safeMessage };
    case "unconfirmed":
      return { outcome: "unconfirmed", message: result.message };
  }
}

function failed(message: string): PublishResult {
  return {
    kind: "failed",
    error: new MetaApiError(message, "rejected", { write: false }),
  };
}

export async function executePublish(
  variantId: string,
  profileId: string,
  options: { instagramMaxWaitMs?: number } = {},
): Promise<PublishSummary> {
  const startedAt = new Date();

  const variant = await prisma.platformVariant.findFirst({
    where: { id: variantId, profileId, draft: { contentPlan: { profileId } } },
    include: { draft: { include: { imageAsset: true } } },
  });
  if (!variant) return { outcome: "failed", message: "Variant not found." };

  const connection = await prisma.metaConnection.findUnique({
    where: { profileId },
  });

  const step =
    variant.platform === "FACEBOOK" ? "facebook.publish" : "instagram.publish";
  const target =
    variant.platform === "FACEBOOK"
      ? (connection?.pageId ?? null)
      : (connection?.instagramAccountId ?? null);
  const base = {
    variantId,
    profileId,
    attemptNumber: variant.publishAttempts,
    targetAccountId: target,
    step,
    startedAt,
  };

  // Everything below must end in recordResult so the claim is always released.
  const fail = async (message: string, reauthId?: string) => {
    const result = failed(message);
    await recordResult({
      ...base,
      result,
      markReauth: reauthId ? { connectionId: reauthId } : undefined,
    });
    return summarize(result);
  };

  if (!connection || !connection.pageTokenEnc || !connection.pageId) {
    return fail(
      "No Facebook Page is connected. Connect a Meta account and select a Page.",
    );
  }
  if (connection.status !== "CONNECTED") {
    return fail(
      "The Meta connection needs to be re-authorized. Reconnect your Meta account.",
    );
  }
  if (variant.platform === "INSTAGRAM" && !connection.instagramAccountId) {
    return fail(
      "The selected Page has no linked Instagram professional account.",
    );
  }

  const imageAsset = variant.draft.imageAsset;
  const currentImageUrl =
    imageAsset?.status === "COMPLETED" ? imageAsset.url : null;
  const issues = contentIssues(variant as PublishableVariant, currentImageUrl);
  if (issues.length > 0) return fail(issues.join(" "));

  let token: string;
  try {
    token = decryptToken(connection.pageTokenEnc);
  } catch {
    return fail(
      "The stored Meta token could not be read. Reconnect your Meta account.",
      connection.id,
    );
  }

  const deps = graphDeps();
  const caption = publishCaption(variant as PublishableVariant);
  const usesImage = variant.platform === "INSTAGRAM" || variant.includeImage;

  let result: PublishResult;
  try {
    result =
      variant.platform === "FACEBOOK"
        ? await publishFacebookPost(
            {
              pageId: connection.pageId,
              pageToken: token,
              message: caption || undefined,
              link: variant.linkUrl ?? undefined,
              photoUrl: usesImage ? (variant.mediaUrl ?? undefined) : undefined,
            },
            deps,
          )
        : await publishInstagramImage(
            {
              igId: connection.instagramAccountId as string,
              token,
              imageUrl: variant.mediaUrl as string,
              caption,
              containerId: variant.igContainerId ?? undefined,
            },
            deps,
            { maxWaitMs: options.instagramMaxWaitMs },
          );
  } catch {
    // publish-api turns Meta errors into results; anything thrown here is
    // unexpected and the platform may or may not have been reached.
    result = {
      kind: "unconfirmed",
      error: null,
      message:
        "An unexpected error happened while publishing; it is unclear whether the post went live.",
      containerId: variant.igContainerId ?? undefined,
    };
  }

  await recordResult({
    ...base,
    result,
    markReauth:
      result.kind === "failed" && result.error.needsReconnect
        ? { connectionId: connection.id }
        : undefined,
  });
  if (result.kind === "published") {
    // Temporary media is no longer needed once Meta confirmed the post. This
    // runs for Publish now AND scheduled runs (with the service-role key),
    // never throws, and can't change the recorded PUBLISHED status.
    await cleanupAfterPublish(variantId, profileId).catch(() => undefined);
  }
  return summarize(result);
}

/// Checks the platform for a post matching an UNCONFIRMED variant. Updates
/// the variant to PUBLISHED when found, to FAILED (safe to retry) when the
/// platform shows nothing and the earlier attempt is old enough to have
/// settled, and leaves it UNCONFIRMED otherwise.
export async function reconcileVariant(
  variantId: string,
  profileId: string,
): Promise<{
  outcome: "published" | "not_found" | "unknown";
  message: string;
  url?: string;
}> {
  const variant = await prisma.platformVariant.findFirst({
    where: {
      id: variantId,
      profileId,
      draft: { contentPlan: { profileId } },
      publishStatus: "UNCONFIRMED",
    },
  });
  if (!variant) {
    return {
      outcome: "unknown",
      message: "Nothing to check for this variant.",
    };
  }
  const connection = await prisma.metaConnection.findUnique({
    where: { profileId },
  });
  if (!connection?.pageTokenEnc || !connection.pageId) {
    return {
      outcome: "unknown",
      message: "Reconnect a Meta account to check the platform.",
    };
  }

  let token: string;
  try {
    token = decryptToken(connection.pageTokenEnc);
  } catch {
    return {
      outcome: "unknown",
      message:
        "The stored Meta token could not be read. Reconnect your Meta account.",
    };
  }

  const deps = graphDeps();
  const caption = publishCaption(variant as PublishableVariant);
  const since = variant.updatedAt;
  const result =
    variant.platform === "FACEBOOK"
      ? await reconcileFacebook(
          { pageId: connection.pageId, token, message: caption, since },
          deps,
        )
      : connection.instagramAccountId
        ? await reconcileInstagram(
            {
              igId: connection.instagramAccountId,
              token,
              containerId: variant.igContainerId ?? undefined,
              caption,
              since,
            },
            deps,
          )
        : ({
            kind: "unknown",
            message: "No Instagram account is connected.",
          } as const);

  const now = new Date();
  const base = {
    variantId,
    attemptNumber: variant.publishAttempts,
    targetAccountId:
      variant.platform === "FACEBOOK"
        ? connection.pageId
        : connection.instagramAccountId,
    startedAt: now,
    completedAt: now,
    step: "reconcile",
  };

  if (result.kind === "found") {
    await prisma.$transaction([
      prisma.platformVariant.updateMany({
        where: { id: variantId, profileId, publishStatus: "UNCONFIRMED" },
        data: {
          publishStatus: "PUBLISHED",
          publishedAt: now,
          publishedPostId: result.postId,
          publishedUrl: result.permalink ?? null,
          publishError: null,
          igContainerId: null,
        },
      }),
      prisma.variantPublishAttempt.create({
        data: {
          ...base,
          outcome: "PUBLISHED",
          platformPostId: result.postId,
          message: "Matched an existing post on the platform.",
        },
      }),
    ]);
    return {
      outcome: "published",
      message: "The post is live.",
      url: result.permalink,
    };
  }

  if (result.kind === "not_found") {
    const settled = variant.updatedAt.getTime() < now.getTime() - 2 * 60 * 1000;
    if (!settled) {
      return {
        outcome: "unknown",
        message:
          "Nothing found yet. Meta may still be processing; check again in a couple of minutes.",
      };
    }
    await prisma.$transaction([
      prisma.platformVariant.updateMany({
        where: { id: variantId, profileId, publishStatus: "UNCONFIRMED" },
        data: {
          publishStatus: "FAILED",
          publishError:
            "No matching post was found on the platform, so the earlier attempt did not publish. You can retry.",
        },
      }),
      prisma.variantPublishAttempt.create({
        data: {
          ...base,
          outcome: "FAILED",
          message: "No matching post found on the platform.",
        },
      }),
    ]);
    return {
      outcome: "not_found",
      message: "No matching post was found, so it is safe to retry.",
    };
  }

  return { outcome: "unknown", message: result.message };
}
