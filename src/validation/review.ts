import { z } from "zod";

const score = z.number().int().min(0).max(100);

/// Deliberately doesn't ask for an overall score — that's computed in
/// application code as the average of these five, so it can never
/// contradict them (see review.ts's schema.prisma comment).
export const qualityReviewSchema = z.object({
  verdict: z.enum(["APPROVED", "NEEDS_REVISION"]),
  hookScore: score,
  clarityScore: score,
  voiceMatchScore: score,
  valueScore: score,
  ctaScore: score,
  strengths: z.array(z.string().trim().min(1)).min(1),
  feedback: z.array(z.string().trim().min(1)).min(1),
});
export type QualityReviewContent = z.infer<typeof qualityReviewSchema>;
