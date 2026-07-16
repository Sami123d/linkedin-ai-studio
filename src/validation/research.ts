import { z } from "zod";

/// The structured shape every provider's response must match. Kept as a
/// flat list-of-strings per section (not richer nested objects) so the
/// prompt can stay simple and the UI can render each section as a bullet
/// list without per-section custom rendering.
export const researchBriefSchema = z.object({
  executiveSummary: z.string().trim().min(1),
  keyInsights: z.array(z.string().trim().min(1)).min(1),
  marketOpportunities: z.array(z.string().trim().min(1)).min(1),
  risks: z.array(z.string().trim().min(1)).min(1),
  statistics: z.array(z.string().trim().min(1)),
  contentAngles: z.array(z.string().trim().min(1)).min(1),
});
export type ResearchBriefContent = z.infer<typeof researchBriefSchema>;
