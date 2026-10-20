import { z } from "zod";

/// Campaign targets. LINKEDIN is handled by the existing Draft/ScheduledPost
/// flow and is selectable here only as a campaign target.
export const campaignPlatformSchema = z.enum([
  "LINKEDIN",
  "FACEBOOK",
  "INSTAGRAM",
]);
export type CampaignPlatform = z.infer<typeof campaignPlatformSchema>;

/// Platforms that get a PlatformVariant. Rejects LINKEDIN on purpose — it
/// must never be duplicated as a variant.
export const variantPlatformSchema = z.enum(["FACEBOOK", "INSTAGRAM"]);
export type VariantPlatformValue = z.infer<typeof variantPlatformSchema>;

export const platformSelectionSchema = z.object({
  planId: z.string().min(1),
  platforms: z
    .array(campaignPlatformSchema)
    .min(1, "Select at least one platform.")
    .refine((p) => new Set(p).size === p.length, "Duplicate platforms."),
});

export const generateVariantSchema = z.object({
  draftId: z.string().min(1),
  platform: variantPlatformSchema,
});

/// Accepts "#tag" or "tag", trims, removes inner whitespace, drops blanks and
/// duplicates (first occurrence wins, order preserved).
export const hashtagListSchema = z.array(z.string()).transform((tags) => {
  const seen = new Set<string>();
  for (const tag of tags) {
    const clean = tag.trim().replace(/^#+/, "").replace(/\s+/g, "");
    if (clean) seen.add(clean);
  }
  return [...seen];
});

/// What the model must return for a variant. Length limits are a
/// platform-specific business check (limits.ts), not part of this shape.
export const variantContentSchema = z.object({
  content: z.string().trim().min(1, "Variant content is empty."),
  hashtags: hashtagListSchema.optional().default([]),
});
export type VariantContent = z.infer<typeof variantContentSchema>;

export const saveVariantSchema = z.object({
  variantId: z.string().min(1),
  content: z.string().trim().min(1, "Content can't be empty."),
  hashtags: hashtagListSchema.default([]),
});

export const approveVariantSchema = z.object({
  variantId: z.string().min(1),
  scheduledFor: z
    .string()
    .transform((v) => new Date(v))
    .refine((d) => !Number.isNaN(d.getTime()), "Pick a valid date and time.")
    .refine(
      (d) => d.getTime() > Date.now(),
      "Planned time must be in the future.",
    ),
});

export const rejectVariantSchema = z.object({
  variantId: z.string().min(1),
  reason: z.string().trim().max(500).optional().default(""),
});

export const variantIdSchema = z.object({ variantId: z.string().min(1) });

export const publishVariantSchema = z.object({
  variantId: z.string().min(1),
  /// The user confirms they checked the platform after an UNCONFIRMED attempt.
  acknowledgeUnconfirmed: z.boolean().optional().default(false),
});

/// Facebook-only. A blank link means "no link".
export const variantOptionsSchema = z.object({
  variantId: z.string().min(1),
  includeImage: z.boolean(),
  linkUrl: z
    .string()
    .trim()
    .max(2000)
    .transform((v) => (v === "" ? undefined : v))
    .pipe(
      z
        .url({
          protocol: /^https$/,
          message: "Link must be a valid https:// URL.",
        })
        .optional(),
    )
    .optional(),
});
