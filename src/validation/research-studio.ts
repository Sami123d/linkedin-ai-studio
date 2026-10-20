import { z } from "zod";

import { campaignPlatformSchema } from "@/validation/platforms";

/// Research Studio: custom research requests, the sources real search
/// providers return, and the LLM output shapes for query extraction and the
/// sourced research brief.

export const TIMEFRAME_OPTIONS = [1, 7, 30, 90] as const;

/// Blank form fields become undefined.
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const researchRequestSchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(10, "Describe the topic in a sentence (at least 10 characters).")
    .max(2000),
  timeframeDays: z.coerce
    .number()
    .int()
    .refine(
      (v) => (TIMEFRAME_OPTIONS as readonly number[]).includes(v),
      "Pick a timeframe.",
    ),
  audience: optionalText(300),
  industry: optionalText(120),
  angle: optionalText(300),
  purpose: optionalText(300),
  tone: optionalText(120),
  instructions: optionalText(1000),
  callToAction: optionalText(300),
  includeLinks: z.boolean().default(false),
  platforms: z
    .array(campaignPlatformSchema)
    .min(1, "Select at least one platform.")
    .refine((p) => new Set(p).size === p.length, "Duplicate platforms."),
  baseTrendId: z.string().min(1).optional(),
});
export type ResearchRequestInput = z.infer<typeof researchRequestSchema>;

export const requestIdSchema = z.object({ requestId: z.string().min(1) });

export const sourceSelectionSchema = z.object({
  requestId: z.string().min(1),
  sourceIds: z.array(z.string().min(1)).max(30, "Select at most 30 sources."),
  focusTitle: optionalText(300),
});

export const STUDIO_STEPS = [
  "plan",
  "write",
  "review",
  "image",
  "variants",
] as const;
export type StudioStep = (typeof STUDIO_STEPS)[number];

export const studioStepSchema = z.object({
  requestId: z.string().min(1),
  step: z.enum(STUDIO_STEPS),
});

// ── Sources ─────────────────────────────────────────────────────────────

export const SOURCE_PROVIDERS = [
  "hackernews",
  "devto",
  "brave",
  "collected-trend",
] as const;
export type SourceProvider = (typeof SOURCE_PROVIDERS)[number];

const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .pipe(z.url({ protocol: /^https?$/ }));

/// A source after normalization. Every field comes from the provider
/// response (cleaned of markup); nothing is generated.
export const discoveredSourceSchema = z.object({
  provider: z.enum(SOURCE_PROVIDERS),
  title: z.string().trim().min(1).max(500),
  publisher: z.string().trim().max(200).nullable(),
  url: httpUrl,
  discussionUrl: httpUrl.nullable(),
  publishedAt: z.date().nullable(),
  snippet: z.string().trim().max(1000).nullable(),
});
export type DiscoveredSource = z.infer<typeof discoveredSourceSchema>;

// ── LLM outputs ─────────────────────────────────────────────────────────

/// Search queries only. The model never produces results or URLs.
export const searchQueriesSchema = z.object({
  queries: z.array(z.string().trim().min(2).max(100)).min(1).max(3),
});

export const findingConfidenceSchema = z.enum([
  "supported",
  "partially_supported",
  "unverified",
]);
export type FindingConfidence = z.infer<typeof findingConfidenceSchema>;

export const sourcedBriefSchema = z.object({
  trendSummary: z.string().trim().min(1).max(2000),
  whyItMattersNow: z.string().trim().min(1).max(1500),
  findings: z
    .array(
      z.object({
        statement: z.string().trim().min(1).max(600),
        sourceIds: z.array(z.string().trim()).optional().default([]),
        confidence: findingConfidenceSchema,
      }),
    )
    .min(1)
    .max(12),
  counterpoints: z
    .array(z.string().trim().min(1).max(600))
    .optional()
    .default([]),
  contentAngles: z.array(z.string().trim().min(1).max(400)).min(1).max(8),
  audienceFit: z.string().trim().min(1).max(1000),
  platformFit: z
    .array(
      z.object({
        platform: campaignPlatformSchema,
        note: z.string().trim().min(1).max(500),
      }),
    )
    .optional()
    .default([]),
});
export type SourcedBrief = z.infer<typeof sourcedBriefSchema>;

/// What is stored in ResearchBrief.evidence: grounded findings with
/// snapshots of the sources they cite (so provenance survives re-discovery).
export const sourceSnapshotSchema = z.object({
  ref: z.string(),
  provider: z.string(),
  title: z.string(),
  publisher: z.string().nullable(),
  url: z.string(),
  publishedAt: z.string().nullable(),
  isRecent: z.boolean(),
});
export type SourceSnapshot = z.infer<typeof sourceSnapshotSchema>;

export const researchEvidenceSchema = z.object({
  version: z.literal(1),
  requestId: z.string(),
  timeframeDays: z.number(),
  findings: z.array(
    z.object({
      statement: z.string(),
      confidence: findingConfidenceSchema,
      sources: z.array(sourceSnapshotSchema),
    }),
  ),
  sources: z.array(sourceSnapshotSchema),
  /// Source refs the model cited that did not exist (dropped).
  droppedRefs: z.array(z.string()),
});
export type ResearchEvidence = z.infer<typeof researchEvidenceSchema>;
