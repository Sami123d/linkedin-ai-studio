import { z } from "zod";

/// One engagement snapshot as n8n sends it after checking a published
/// post on LinkedIn. All metric fields are optional — LinkedIn's basic
/// personal-profile API may not expose impressions the way a Marketing
/// API partnership would, so this shouldn't require a field n8n might not
/// be able to fill in.
export const analyticsSnapshotPayloadSchema = z.object({
  scheduledPostId: z.string().min(1),
  capturedAt: z
    .string()
    .optional()
    .transform((value) => (value ? new Date(value) : new Date())),
  impressions: z.number().int().min(0).optional(),
  likes: z.number().int().min(0).optional(),
  comments: z.number().int().min(0).optional(),
  shares: z.number().int().min(0).optional(),
  clicks: z.number().int().min(0).optional(),
});
export type AnalyticsSnapshotPayload = z.infer<
  typeof analyticsSnapshotPayloadSchema
>;

/// n8n may call this once per post or once per batch — same flexibility as
/// the trends webhook (Milestone 5).
export const analyticsWebhookBodySchema = z.union([
  analyticsSnapshotPayloadSchema,
  z.array(analyticsSnapshotPayloadSchema),
]);
