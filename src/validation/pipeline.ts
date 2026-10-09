import { z } from "zod";

/// In execution order. The UI loops over this list, so adding a stage means
/// adding it here and handling it in src/features/pipeline/actions.ts.
export const PIPELINE_STEPS = [
  "research",
  "plan",
  "write",
  "review",
  "image",
] as const;
export type PipelineStep = (typeof PIPELINE_STEPS)[number];

export const pipelineStepInputSchema = z.object({
  trendId: z.string().min(1),
  step: z.enum(PIPELINE_STEPS),
});
