import { z } from "zod";

/// Body n8n's workflow POSTs back after attempting to publish one post.
export const publishCallbackSchema = z.object({
  scheduledPostId: z.string().min(1),
  success: z.boolean(),
  publishedUrl: z.url().optional(),
  error: z.string().trim().max(2000).optional(),
});
export type PublishCallbackInput = z.infer<typeof publishCallbackSchema>;

/// Optional body for POST /api/scheduler/meta-publish.
export const metaPublishRequestSchema = z.object({
  limit: z.number().int().min(1).max(10).optional().default(3),
});
