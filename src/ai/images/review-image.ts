import "server-only";

import { generateStructured } from "@/ai/generate-structured";
import type { AIProvider } from "@/ai/providers";
import { imageReviewSchema } from "@/validation/images";

import type { ImageSceneInput } from "./generate-image-scene";

/// Looks at the generated image next to the post, like a reader would, so
/// an off-topic or text-garbled image is caught before the user sees it.
const SYSTEM_PROMPT = `You review the image attached to a LinkedIn post before it is published.
Look at the image and judge it as a feed reader would:
- relevance (1-10): would someone who sees this image next to the post connect it to the post's
  specific topic? 1-3 unrelated or generic, 4-6 loosely related, 7-8 clearly related,
  9-10 instantly communicates the post's message.
- hasText: true if the image shows any letters, numbers, words or garbled pseudo-text.
- reason: one sentence on what the image shows and what would make it match the post better.
Respond with ONLY a JSON object, no markdown fences, matching exactly this shape:
{ "relevance": number, "hasText": boolean, "reason": string }`;

export async function reviewImage(
  provider: AIProvider,
  input: ImageSceneInput,
  image: { mimeType: string; data: string },
) {
  const prompt = [
    `Topic: ${input.topic}`,
    input.angle ? `Angle: ${input.angle}` : "",
    input.content ? `Post:\n${input.content.slice(0, 2500)}` : "",
    "",
    "Review the attached image for this post.",
  ]
    .filter(Boolean)
    .join("\n");

  const { data } = await generateStructured({
    provider,
    systemPrompt: SYSTEM_PROMPT,
    prompt,
    schema: imageReviewSchema,
    images: [image],
  });
  return data;
}
