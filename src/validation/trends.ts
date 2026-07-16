import { z } from "zod";

/// One trending topic as n8n sends it. Deliberately loose on `score` (no
/// fixed scale) and `sourceName`/`sourceUrl` (optional) since the workflow
/// producing these is external and its shape isn't fixed by this app.
export const trendPayloadSchema = z.object({
  topic: z.string().trim().min(1, "topic is required").max(300),
  summary: z.string().trim().max(5000).optional(),
  sourceName: z.string().trim().max(200).optional(),
  sourceUrl: z.union([z.url(), z.literal("")]).optional(),
  score: z.number().optional(),
  /// ISO 8601 string; transformed to a `Date` for Prisma's
  /// `@db.Timestamptz` column.
  publishedAt: z
    .string()
    .optional()
    .transform((value) => (value ? new Date(value) : undefined)),
});
export type TrendPayload = z.infer<typeof trendPayloadSchema>;

/// n8n may call this once per trend or once per batch — accept both shapes
/// rather than forcing a specific HTTP-node configuration on the workflow.
export const trendWebhookBodySchema = z.union([
  trendPayloadSchema,
  z.array(trendPayloadSchema),
]);
