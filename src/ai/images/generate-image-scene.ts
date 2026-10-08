import "server-only";

import {
  generateStructured,
  StructuredGenerationError,
} from "@/ai/generate-structured";
import type { AIGenerateResult, AIProvider } from "@/ai/providers";
import { imageSceneSchema } from "@/validation/images";

/// Same reasoning as every other agent's *GenerationError class: always
/// carries the prompt so the caller can record what was asked.
export class ImageSceneGenerationError extends Error {
  constructor(
    message: string,
    readonly prompt: string,
    readonly raw?: AIGenerateResult,
  ) {
    super(message);
    this.name = "ImageSceneGenerationError";
  }
}

/// Image models draw whatever words they're given, so passing the post's
/// headline produces a text slide. This turns the post into a wordless
/// scene instead. Early versions picked clever but indirect metaphors (a
/// drill for "cheaper AI model") that nobody could connect to the post, so
/// the prompt now demands a subject recognizable from the post's own domain.
/// Colors and rendering style are left out — the image provider adds them.
const SYSTEM_PROMPT = `You are an art director creating the single image for a LinkedIn post.
The image must make someone scrolling the feed instantly understand what the post is about.

Steps:
1. coreMessage: the post's main point in one sentence.
2. visualSubject: the hero object that represents the post's specific domain and that people
   recognize at a glance, e.g. a browser window for a browser tool, a film strip or camera for
   video, a price tag or coins for cost, a glowing AI chip or neural core for an AI model, a
   rocket for speed/launch. Prefer the post's actual subject over abstract symbolism.
3. scene: 1-2 sentences describing a striking scene built around that hero object that shows the
   core message (contrast, transformation, before/after, scale), with one clear focal point.

Rules: never include words, letters, numbers, captions, signs, logos, brand names, charts with
labels or screens showing readable code or UI text. No generic "hands typing on a keyboard" or
"person at a laptop" scenes. Do not describe colors, lighting or art style.
Respond with ONLY a JSON object, no markdown fences, matching exactly this shape:
{ "coreMessage": string, "visualSubject": string, "scene": string }`;

export type ImageSceneInput = {
  topic: string;
  angle: string | null;
  hook: string | null;
  content: string | null;
};

function buildPrompt(input: ImageSceneInput, feedback?: string): string {
  return [
    `Topic: ${input.topic}`,
    input.angle ? `Angle: ${input.angle}` : "",
    input.hook ? `Hook: ${input.hook}` : "",
    input.content ? `Post:\n${input.content.slice(0, 2500)}` : "",
    feedback
      ? `\nA previous image for this post was rejected: ${feedback}\nDesign a different, clearer scene.`
      : "",
    "",
    "Design the image for this post now.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateImageScene(
  provider: AIProvider,
  input: ImageSceneInput,
  feedback?: string,
) {
  const prompt = buildPrompt(input, feedback);
  try {
    const { data, raw } = await generateStructured({
      provider,
      systemPrompt: SYSTEM_PROMPT,
      prompt,
      schema: imageSceneSchema,
    });
    return { data, raw, prompt };
  } catch (error) {
    const raw =
      error instanceof StructuredGenerationError ? error.raw : undefined;
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new ImageSceneGenerationError(message, prompt, raw);
  }
}
