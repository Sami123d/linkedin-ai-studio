import { z } from "zod";

/// coreMessage and visualSubject come first so the model commits to what
/// the post is about, and to a recognizable subject for it, before
/// describing the scene. That ordering is what keeps scenes on-topic.
export const imageSceneSchema = z.object({
  coreMessage: z.string().trim().min(1),
  visualSubject: z.string().trim().min(1),
  scene: z.string().trim().min(20).max(800),
});
export type ImageScene = z.infer<typeof imageSceneSchema>;

export const imageReviewSchema = z.object({
  relevance: z.number().int().min(1).max(10),
  hasText: z.boolean(),
  reason: z.string().trim().min(1),
});
export type ImageReview = z.infer<typeof imageReviewSchema>;
