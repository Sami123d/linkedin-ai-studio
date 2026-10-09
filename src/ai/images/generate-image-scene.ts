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
/// headline produces a text slide. Two opposite failures shaped this prompt:
/// literal figures of speech ("days into minutes" became a clock face) and,
/// when those were banned, abstract scenes ("data streams", "processing
/// cores") that the image model renders as meaningless glowing noise. So the
/// hero must be a tangible object people recognize. Colors and rendering
/// style are left out — the image provider adds them.
const SYSTEM_PROMPT = `You are an art director creating the single image for a LinkedIn post written by
a software studio founder. Someone scrolling the feed must instantly understand what the post is
about, and the image must look polished and premium. An image model will draw your scene, and it
can only draw tangible things.

Steps:
1. coreMessage: the post's main point in one sentence.
2. visualSubject: ONE tangible object that people recognize at a glance and that stands for the
   post's domain, something you could photograph or 3D-model. Use the research summary only to
   understand what the topic really is. Examples: a browser window for a browser tool; a film strip
   or camera for video tools; a friendly robotic arm processing stacks of folders and documents for
   AI agents doing business work like recruiting, operations or support; a robotic arm assembling
   interface panels for AI building software; stacked server racks or database cylinders for
   databases, cloud or infrastructure; a glowing AI chip for a model release; coins or a price tag
   for cost; a shield for security. If the topic is invisible or behind the scenes (a headless
   browser, an API, a backend), show the familiar object it works on, such as a browser window,
   never "the absence of" it. If the post is about a named company or product, show the kind of
   work it does, never its name or logo.
3. scene: 1-2 sentences with the hero object in the center doing something that shows the core
   message (contrast, transformation, before/after). At most three distinct visual elements.

Hard rules:
- Headlines use figures of speech ("days into minutes", "10x faster", "level up", "game changer").
  Never draw them literally: no clocks, watches, calendars, hourglasses, stopwatches,
  speedometers, dials, gauges, rulers, trophies, ladders or rockets.
- Never use abstract concepts as the subject: no "data streams", "networks", "pipelines",
  "ecosystems", "processing cores", "pathways" or "abstract shapes". They render as meaningless
  glowing noise. Name a physical object instead.
- Nothing with writing or numerals: no words, letters, numbers, captions, signs, logos, brand names,
  charts with labels, or screens showing readable code or UI text.
- Screens and windows must stay simple: a dark or softly glowing panel with one simple shape.
  Never dashboards, cards, menus, code or interface content: the image model renders those as
  garbled pseudo-text.
- No generic "hands typing on a keyboard" or "person at a laptop" scenes.
- Do not describe colors, lighting or art style.
Respond with ONLY a JSON object, no markdown fences, matching exactly this shape:
{ "coreMessage": string, "visualSubject": string, "scene": string }`;

export type ImageSceneInput = {
  topic: string;
  angle: string | null;
  hook: string | null;
  content: string | null;
  /// From the research brief, so the scene is grounded in what the topic
  /// really is rather than only the wording of the post.
  summary?: string | null;
  keyInsights?: string[];
};

function buildPrompt(input: ImageSceneInput, feedback?: string): string {
  return [
    `Topic: ${input.topic}`,
    input.angle ? `Angle: ${input.angle}` : "",
    input.hook ? `Hook: ${input.hook}` : "",
    input.summary ? `Research summary: ${input.summary.slice(0, 1200)}` : "",
    input.keyInsights?.length
      ? `Key insights:\n${input.keyInsights
          .slice(0, 3)
          .map((insight) => `- ${insight}`)
          .join("\n")}`
      : "",
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
