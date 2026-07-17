import { z } from "zod";

/// Deliberately doesn't ask the model to re-decide `format` — the Planning
/// Agent already fixed that. Which of `content`/`slides` must be non-empty
/// is a business-logic check in generate-draft.ts, not part of this schema,
/// since it depends on the plan's format rather than being a fixed shape.
export const draftContentSchema = z.object({
  content: z.string().trim().optional(),
  slides: z.array(z.string().trim().min(1)).optional().default([]),
  hashtags: z.array(z.string().trim().min(1)).optional().default([]),
});
export type DraftContent = z.infer<typeof draftContentSchema>;
