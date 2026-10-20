"use server";

import { revalidatePath } from "next/cache";

import { getAIProvider } from "@/ai/providers";
import {
  VariantGenerationError,
  generateVariant,
} from "@/ai/writing/generate-variant";
import { prisma } from "@/db/prisma";
import { requireProfileId } from "@/features/knowledge-base/session";
import type { ActionResult } from "@/features/knowledge-base/types";
import { validateVariantLimits } from "@/features/platforms/limits";
import {
  MediaPreparationError,
  prepareMetaImage,
} from "@/features/platforms/media";
import {
  deletePublishMedia,
  sweepPublishedMedia,
} from "@/features/platforms/media-cleanup";
import {
  executePublish,
  reconcileVariant,
  sweepStalePublishing,
} from "@/features/platforms/publish";
import {
  MANUAL_CLAIMABLE,
  publishBlocker,
} from "@/features/platforms/publish-state";
import {
  buildVariantFailureUpdate,
  buildVariantSuccessUpdate,
  EDIT_RESETS_PUBLISH,
} from "@/features/platforms/variant-state";
import type { VariantPublishStatus } from "@/generated/prisma/client";
import { retrieveRelevantChunks } from "@/features/rag/retrieve";
import { loadCreativeContext } from "@/features/research-studio/context";
import {
  approveVariantSchema,
  generateVariantSchema,
  platformSelectionSchema,
  publishVariantSchema,
  rejectVariantSchema,
  saveVariantSchema,
  variantIdSchema,
  variantOptionsSchema,
} from "@/validation/platforms";

/// Content can't change while a publish is running, after it succeeded, or
/// while its outcome is unknown (editing then could cause a mismatched or
/// duplicate post).
const LOCKED_PUBLISH_STATES: VariantPublishStatus[] = [
  "PUBLISHING",
  "PUBLISHED",
  "UNCONFIRMED",
];

function lockedMessage(status: VariantPublishStatus): string {
  switch (status) {
    case "PUBLISHED":
      return "This variant is already published and can no longer be changed.";
    case "UNCONFIRMED":
      return "An earlier publish attempt may have gone live. Check its status first.";
    default:
      return "This variant is being published right now.";
  }
}

function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Invalid input.";
}

function revalidateAll() {
  revalidatePath("/platforms");
  revalidatePath("/calendar");
}

/// Completed drafts (the LinkedIn post each campaign starts from) belonging
/// to the current user, with their plan, image and any FB/IG variants.
/// Ownership flows Draft -> ContentPlan -> profileId.
export async function listPlatformCampaigns() {
  const profileId = await requireProfileId();

  // Housekeeping for this profile: stuck claims become UNCONFIRMED (so the
  // page never shows PUBLISHING forever even without the scheduled job) and
  // prepared images of published posts are removed. Best effort.
  try {
    await sweepStalePublishing(profileId);
    await sweepPublishedMedia(profileId);
  } catch {
    // never block the page on housekeeping
  }

  return prisma.draft.findMany({
    where: { status: "COMPLETED", contentPlan: { profileId } },
    include: {
      contentPlan: {
        include: {
          research: {
            include: {
              // Research Studio provenance link (null for shared trends).
              trend: {
                include: {
                  researchRequest: {
                    where: { profileId },
                    select: { id: true },
                  },
                },
              },
            },
          },
        },
      },
      imageAsset: true,
      scheduledPost: true,
      platformVariants: { where: { profileId } },
    },
    orderBy: { completedAt: "desc" },
  });
}

export async function setPlanPlatforms(input: unknown): Promise<ActionResult> {
  const profileId = await requireProfileId();

  const parsed = platformSelectionSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const { count } = await prisma.contentPlan.updateMany({
    where: { id: parsed.data.planId, profileId },
    data: { platforms: parsed.data.platforms },
  });
  if (count === 0) return { error: "Content plan not found." };

  revalidateAll();
  return { success: true, message: "Platforms updated." };
}

/// A variant the current user owns: verified through its own profileId AND
/// its parent Draft -> ContentPlan chain.
async function findOwnedVariant(variantId: string, profileId: string) {
  return prisma.platformVariant.findFirst({
    where: {
      id: variantId,
      profileId,
      draft: { contentPlan: { profileId } },
    },
  });
}

export async function generateVariantAction(
  input: unknown,
): Promise<ActionResult> {
  const profileId = await requireProfileId();

  const parsed = generateVariantSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { draftId, platform } = parsed.data;

  const draft = await prisma.draft.findFirst({
    where: { id: draftId, contentPlan: { profileId } },
    include: { contentPlan: true },
  });
  if (!draft) return { error: "Draft not found." };
  if (draft.status !== "COMPLETED") {
    return { error: "The LinkedIn draft must be completed first." };
  }
  const plan = draft.contentPlan;
  if (!plan.platforms.includes(platform)) {
    return { error: "Select this platform for the campaign first." };
  }
  const sourceContent =
    draft.content?.trim() || draft.slides.join("\n\n").trim();
  if (!sourceContent) return { error: "The draft has no content to adapt." };
  if (!plan.hook || !plan.keyMessage || !plan.toneGuidance) {
    return { error: "Content plan is missing required fields." };
  }

  // Ownership is verified above; only now is it safe to upsert by
  // (draftId, platform).
  const existing = await prisma.platformVariant.findFirst({
    where: { draftId, platform, profileId },
  });
  // A run stuck in PROCESSING (crashed request) is retryable after 10 min.
  const STALE_MS = 10 * 60 * 1000;
  if (
    existing?.status === "PROCESSING" &&
    existing.startedAt &&
    Date.now() - existing.startedAt.getTime() < STALE_MS
  ) {
    return { error: "A generation is already running for this variant." };
  }
  if (existing && LOCKED_PUBLISH_STATES.includes(existing.publishStatus)) {
    return { error: lockedMessage(existing.publishStatus) };
  }
  const attemptNumber = (existing?.attempts ?? 0) + 1;
  const attemptStartedAt = new Date();

  const variant = await prisma.platformVariant.upsert({
    where: { draftId_platform: { draftId, platform } },
    create: {
      profileId,
      draftId,
      platform,
      // Instagram always needs an image; for Facebook it's opt-in.
      includeImage: platform === "INSTAGRAM",
      status: "PROCESSING",
      attempts: attemptNumber,
      startedAt: attemptStartedAt,
    },
    // Retry in place. Content/hashtags are untouched so a failed run keeps
    // the last good version.
    update: {
      status: "PROCESSING",
      attempts: attemptNumber,
      startedAt: attemptStartedAt,
      errorMessage: null,
    },
  });

  try {
    const [writingSamples, knowledgeChunks] = await Promise.all([
      prisma.writingStyleSample.findMany({
        where: { profileId },
        take: 5,
        orderBy: { createdAt: "desc" },
      }),
      retrieveRelevantChunks(
        profileId,
        plan.selectedAngle ?? plan.keyMessage,
        5,
      ).catch(() => []),
    ]);

    const provider = getAIProvider();
    const { data, raw, prompt } = await generateVariant(provider, {
      platform,
      selectedAngle: plan.selectedAngle ?? "",
      hook: plan.hook,
      keyMessage: plan.keyMessage,
      toneGuidance: plan.toneGuidance,
      callToAction: plan.callToAction ?? "",
      sourceContent,
      writingSamples: writingSamples.map((w) => w.content),
      knowledgeContext: knowledgeChunks.map((c) => c.content),
      creative: await loadCreativeContext(profileId, plan.researchId).catch(
        () => null,
      ),
    });

    const now = new Date();
    await prisma.$transaction([
      prisma.platformVariant.updateMany({
        where: { id: variant.id, profileId },
        data: buildVariantSuccessUpdate({
          provider: provider.name,
          model: raw.model,
          content: data.content,
          hashtags: data.hashtags,
          now,
        }),
      }),
      prisma.variantAttempt.create({
        data: {
          variantId: variant.id,
          attemptNumber,
          provider: provider.name,
          model: raw.model,
          prompt,
          response: raw.text,
          promptTokens: raw.usage?.promptTokens,
          completionTokens: raw.usage?.completionTokens,
          totalTokens: raw.usage?.totalTokens,
          succeeded: true,
          startedAt: attemptStartedAt,
          completedAt: now,
        },
      }),
    ]);

    await deletePublishMedia(profileId, [existing?.mediaUrl]);
    revalidateAll();
    return { success: true, message: "Variant generated." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const prompt =
      error instanceof VariantGenerationError
        ? error.prompt
        : "(provider unavailable before a prompt could be built)";
    const raw = error instanceof VariantGenerationError ? error.raw : undefined;
    const now = new Date();

    await prisma.$transaction([
      prisma.platformVariant.updateMany({
        where: { id: variant.id, profileId },
        data: buildVariantFailureUpdate(message, now),
      }),
      prisma.variantAttempt.create({
        data: {
          variantId: variant.id,
          attemptNumber,
          provider: getAiProviderNameSafely(),
          model: raw?.model ?? "unknown",
          prompt,
          response: raw?.text,
          promptTokens: raw?.usage?.promptTokens,
          completionTokens: raw?.usage?.completionTokens,
          totalTokens: raw?.usage?.totalTokens,
          succeeded: false,
          errorMessage: message,
          startedAt: attemptStartedAt,
          completedAt: now,
        },
      }),
    ]);

    revalidateAll();
    return { error: message };
  }
}

/// Saves a hand edit. Editing invalidates a previous approval, and saving
/// valid text on a FAILED variant marks it usable again (the failure was
/// about generation, not about this text).
export async function saveVariant(input: unknown): Promise<ActionResult> {
  const profileId = await requireProfileId();

  const parsed = saveVariantSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { variantId, content, hashtags } = parsed.data;

  const variant = await findOwnedVariant(variantId, profileId);
  if (!variant) return { error: "Variant not found." };
  if (variant.status === "PROCESSING") {
    return { error: "Wait for the running generation to finish." };
  }

  if (LOCKED_PUBLISH_STATES.includes(variant.publishStatus)) {
    return { error: lockedMessage(variant.publishStatus) };
  }

  const issues = validateVariantLimits(variant.platform, content, hashtags);
  if (issues.length > 0) return { error: issues.join(" ") };

  // The publish-state condition closes the window between the check above
  // and a publish starting in parallel.
  const { count } = await prisma.platformVariant.updateMany({
    where: {
      id: variantId,
      profileId,
      publishStatus: { notIn: LOCKED_PUBLISH_STATES },
    },
    data: {
      content,
      hashtags,
      edited: true,
      status: "COMPLETED",
      errorMessage: null,
      approvalStatus: "PENDING",
      scheduledFor: null,
      approvedAt: null,
      rejectionReason: null,
      ...EDIT_RESETS_PUBLISH,
    },
  });
  if (count === 0)
    return { error: "This variant is being published; try again shortly." };

  await deletePublishMedia(profileId, [variant.mediaUrl]);
  revalidateAll();
  return { success: true, message: "Saved." };
}

/// Facebook-only options: attach the campaign image, or share a link
/// (a link post and an image post are mutually exclusive on Facebook).
/// Changing what gets published clears any earlier approval, like an edit.
export async function saveVariantOptions(
  input: unknown,
): Promise<ActionResult> {
  const profileId = await requireProfileId();

  const parsed = variantOptionsSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { variantId, includeImage, linkUrl } = parsed.data;

  const variant = await findOwnedVariant(variantId, profileId);
  if (!variant) return { error: "Variant not found." };
  if (variant.platform !== "FACEBOOK") {
    return { error: "These options only apply to Facebook posts." };
  }
  if (LOCKED_PUBLISH_STATES.includes(variant.publishStatus)) {
    return { error: lockedMessage(variant.publishStatus) };
  }

  const { count } = await prisma.platformVariant.updateMany({
    where: {
      id: variantId,
      profileId,
      publishStatus: { notIn: LOCKED_PUBLISH_STATES },
    },
    data: {
      includeImage: linkUrl ? false : includeImage,
      linkUrl: linkUrl ?? null,
      approvalStatus: "PENDING",
      scheduledFor: null,
      approvedAt: null,
      ...EDIT_RESETS_PUBLISH,
    },
  });
  if (count === 0)
    return { error: "This variant is being published; try again shortly." };

  await deletePublishMedia(profileId, [variant.mediaUrl]);
  revalidateAll();
  return { success: true, message: "Saved." };
}

/// Approval fixes the date and prepares the image: the campaign image is
/// converted to a JPEG and re-hosted at a stable public URL so Meta can fetch
/// it later (including from the scheduler, which has no user session).
/// Approving never publishes anything.
export async function approveVariant(input: unknown): Promise<ActionResult> {
  const profileId = await requireProfileId();

  const parsed = approveVariantSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { variantId, scheduledFor } = parsed.data;

  const variant = await prisma.platformVariant.findFirst({
    where: {
      id: variantId,
      profileId,
      draft: { contentPlan: { profileId } },
    },
    include: { draft: { include: { imageAsset: true } } },
  });
  if (!variant) return { error: "Variant not found." };
  if (variant.status !== "COMPLETED" || !variant.content) {
    return { error: "Only completed variants can be approved." };
  }
  if (LOCKED_PUBLISH_STATES.includes(variant.publishStatus)) {
    return { error: lockedMessage(variant.publishStatus) };
  }
  const issues = validateVariantLimits(
    variant.platform,
    variant.content,
    variant.hashtags,
  );
  if (issues.length > 0) return { error: issues.join(" ") };

  const usesImage = variant.platform === "INSTAGRAM" || variant.includeImage;
  if (
    variant.platform === "FACEBOOK" &&
    variant.linkUrl &&
    variant.includeImage
  ) {
    return { error: "Choose either a link or an image for a Facebook post." };
  }

  let mediaUrl: string | null = null;
  let mediaSourceUrl: string | null = null;
  if (usesImage) {
    const image = variant.draft.imageAsset;
    if (image?.status !== "COMPLETED" || !image.url) {
      return {
        error:
          variant.platform === "INSTAGRAM"
            ? "Instagram posts need an image. Generate one on the Images page first."
            : "Turn off “Include image” or generate an image on the Images page first.",
      };
    }
    try {
      mediaUrl = await prepareMetaImage(profileId, image.url);
      mediaSourceUrl = image.url;
    } catch (error) {
      return {
        error:
          error instanceof MediaPreparationError
            ? error.message
            : "The image could not be prepared for publishing.",
      };
    }
  }

  const { count } = await prisma.platformVariant.updateMany({
    where: {
      id: variantId,
      profileId,
      publishStatus: { notIn: LOCKED_PUBLISH_STATES },
    },
    data: {
      approvalStatus: "APPROVED",
      scheduledFor,
      approvedAt: new Date(),
      rejectionReason: null,
      mediaUrl,
      mediaSourceUrl,
      // Re-approving a FAILED variant gives it a clean slate.
      publishStatus: "NOT_PUBLISHED",
      publishError: null,
      igContainerId: null,
    },
  });
  if (count === 0) {
    await deletePublishMedia(profileId, [mediaUrl]);
    return { error: "This variant is being published; try again shortly." };
  }
  await deletePublishMedia(profileId, [variant.mediaUrl]);

  revalidateAll();
  return {
    success: true,
    message:
      "Approved. It will be published at the planned time only if the Meta publisher job is running; use Publish now to post immediately.",
  };
}

/// Explicit "Publish now" (also the retry path for FAILED variants). The
/// claim is one conditional UPDATE: only one caller can move a variant to
/// PUBLISHING, so double clicks and concurrent scheduler runs can't publish
/// it twice. Reports success only when Meta returned a post id.
export async function publishVariantNow(input: unknown): Promise<ActionResult> {
  const profileId = await requireProfileId();

  const parsed = publishVariantSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { variantId, acknowledgeUnconfirmed } = parsed.data;

  const variant = await findOwnedVariant(variantId, profileId);
  if (!variant) return { error: "Variant not found." };

  const blocker = publishBlocker(variant, { acknowledgeUnconfirmed });
  if (blocker) return { error: blocker };

  const connection = await prisma.metaConnection.findUnique({
    where: { profileId },
    select: { id: true, status: true, pageId: true },
  });
  if (!connection?.pageId) {
    return {
      error: "Connect a Meta account and select a Page before publishing.",
    };
  }
  if (connection.status !== "CONNECTED") {
    return { error: "Reconnect your Meta account before publishing." };
  }

  const claimable: VariantPublishStatus[] = acknowledgeUnconfirmed
    ? [...MANUAL_CLAIMABLE, "UNCONFIRMED"]
    : MANUAL_CLAIMABLE;
  const { count } = await prisma.platformVariant.updateMany({
    where: {
      id: variantId,
      profileId,
      draft: { contentPlan: { profileId } },
      approvalStatus: "APPROVED",
      status: "COMPLETED",
      publishStatus: { in: claimable },
    },
    data: {
      publishStatus: "PUBLISHING",
      publishingStartedAt: new Date(),
      publishAttempts: { increment: 1 },
      publishError: null,
      connectionId: connection.id,
    },
  });
  if (count === 0) {
    revalidateAll();
    return {
      error: "This variant is already being published or was published.",
    };
  }

  let summary;
  try {
    summary = await executePublish(variantId, profileId);
  } catch {
    // The outcome could not be recorded. The claim stays PUBLISHING and turns
    // into UNCONFIRMED shortly; it is never retried automatically.
    revalidateAll();
    return {
      error:
        "The result could not be recorded. Do not publish again: the status will change to Unconfirmed shortly, then use Check status.",
    };
  }
  revalidateAll();

  switch (summary.outcome) {
    case "published":
      return { success: true, message: "Published." };
    case "pending":
      return { error: summary.message };
    case "unconfirmed":
      return {
        error: `${summary.message} Do not retry until you've checked: use “Check status”.`,
      };
    case "failed":
      return { error: summary.message };
  }
}

/// Looks for the post on the platform after an UNCONFIRMED attempt.
export async function checkVariantStatus(
  input: unknown,
): Promise<ActionResult> {
  const profileId = await requireProfileId();

  const parsed = variantIdSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const result = await reconcileVariant(parsed.data.variantId, profileId);
  revalidateAll();
  if (result.outcome === "published" || result.outcome === "not_found") {
    return { success: true, message: result.message };
  }
  return { error: result.message };
}

export async function rejectVariant(input: unknown): Promise<ActionResult> {
  const profileId = await requireProfileId();

  const parsed = rejectVariantSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { variantId, reason } = parsed.data;

  const variant = await findOwnedVariant(variantId, profileId);
  if (!variant) return { error: "Variant not found." };
  if (LOCKED_PUBLISH_STATES.includes(variant.publishStatus)) {
    return { error: lockedMessage(variant.publishStatus) };
  }

  const { count } = await prisma.platformVariant.updateMany({
    where: {
      id: variantId,
      profileId,
      publishStatus: { notIn: LOCKED_PUBLISH_STATES },
    },
    data: {
      approvalStatus: "REJECTED",
      rejectionReason: reason || null,
      scheduledFor: null,
      approvedAt: null,
      mediaUrl: null,
      mediaSourceUrl: null,
      igContainerId: null,
    },
  });
  if (count > 0) await deletePublishMedia(profileId, [variant.mediaUrl]);

  revalidateAll();
  return { success: true, message: "Rejected." };
}

function getAiProviderNameSafely(): string {
  try {
    return getAIProvider().name;
  } catch {
    return "unknown";
  }
}
