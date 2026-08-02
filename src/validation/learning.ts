import { z } from "zod";

export const learningInsightSchema = z.object({
  summary: z.string().trim().min(1),
  topPerformingPatterns: z.array(z.string().trim().min(1)).min(1),
  underperformingPatterns: z.array(z.string().trim().min(1)),
  recommendations: z.array(z.string().trim().min(1)).min(1),
});
export type LearningInsightContent = z.infer<typeof learningInsightSchema>;
