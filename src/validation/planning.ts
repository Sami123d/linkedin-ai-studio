import { z } from "zod";

export const contentPlanSchema = z.object({
  format: z.enum(["SINGLE_POST", "CAROUSEL", "ARTICLE"]),
  selectedAngle: z.string().trim().min(1),
  hook: z.string().trim().min(1),
  keyMessage: z.string().trim().min(1),
  outline: z.array(z.string().trim().min(1)).min(1),
  toneGuidance: z.string().trim().min(1),
  callToAction: z.string().trim().min(1),
});
export type ContentPlanContent = z.infer<typeof contentPlanSchema>;
