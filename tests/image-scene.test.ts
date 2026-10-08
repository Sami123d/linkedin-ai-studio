import { describe, expect, it } from "vitest";

import {
  generateImageScene,
  ImageSceneGenerationError,
} from "@/ai/images/generate-image-scene";
import type { AIGenerateParams, AIProvider } from "@/ai/providers/types";
import { imageReviewSchema, imageSceneSchema } from "@/validation/images";

function fakeProvider(text: string) {
  const calls: AIGenerateParams[] = [];
  const provider: AIProvider = {
    name: "fake",
    async generate(params) {
      calls.push(params);
      return { text, model: "fake-1" };
    },
  };
  return { provider, calls };
}

const sceneJson = (scene: string) =>
  JSON.stringify({
    coreMessage: "Unique AI videos need a system, not templates.",
    visualSubject: "film strip",
    scene,
  });

const input = {
  topic: "AI video tools",
  angle: "Building a Motion Design System for AI",
  hook: "Every AI video looks the same.",
  content: "x".repeat(3000),
};

describe("generateImageScene", () => {
  it("returns the scene and sends the post context", async () => {
    const scene = "A film strip unspooling from a laptop into abstract shapes.";
    const { provider, calls } = fakeProvider(sceneJson(scene));

    const result = await generateImageScene(provider, input);

    expect(result.data.scene).toBe(scene);
    expect(result.data.visualSubject).toBe("film strip");
    expect(calls[0].json).toBe(true);
    expect(calls[0].systemPrompt).toContain("never include words");
    expect(calls[0].systemPrompt).toContain("recognize at a glance");
    expect(result.prompt).toContain("Topic: AI video tools");
    expect(result.prompt).toContain("Angle: Building a Motion Design System");
    expect(result.prompt).toContain("Hook: Every AI video looks the same.");
    // The post is capped so very long drafts don't blow up the prompt.
    expect(result.prompt).not.toContain("x".repeat(2501));
    expect(result.prompt).not.toContain("rejected");
  });

  it("includes reviewer feedback when retrying", async () => {
    const { provider } = fakeProvider(
      sceneJson("A browser window opening onto a racetrack of web pages."),
    );
    const result = await generateImageScene(provider, input, "Too generic.");
    expect(result.prompt).toContain(
      "A previous image for this post was rejected: Too generic.",
    );
  });

  it("omits missing optional fields", async () => {
    const { provider } = fakeProvider(
      sceneJson("A lighthouse beam cutting through dense fog."),
    );
    const result = await generateImageScene(provider, {
      topic: "Focus",
      angle: null,
      hook: null,
      content: null,
    });
    expect(result.prompt).not.toContain("Angle:");
    expect(result.prompt).not.toContain("Hook:");
    expect(result.prompt).not.toContain("Post:");
  });

  it("wraps invalid output in ImageSceneGenerationError with the prompt", async () => {
    const { provider } = fakeProvider('{"scene":"too short"}');
    const error = await generateImageScene(provider, input).catch((e) => e);
    expect(error).toBeInstanceOf(ImageSceneGenerationError);
    expect(error.prompt).toContain("Topic: AI video tools");
    expect(error.raw?.text).toBe('{"scene":"too short"}');
  });
});

describe("image schemas", () => {
  it("requires the reasoning fields and bounds the scene", () => {
    const base = { coreMessage: "m", visualSubject: "s" };
    expect(
      imageSceneSchema.safeParse({ ...base, scene: "  short  " }).success,
    ).toBe(false);
    expect(
      imageSceneSchema.safeParse({ ...base, scene: "y".repeat(801) }).success,
    ).toBe(false);
    expect(
      imageSceneSchema.safeParse({
        scene: "A paper boat sailing across a circuit board.",
      }).success,
    ).toBe(false);
  });

  it("bounds the review score to 1-10", () => {
    const review = { hasText: false, reason: "ok" };
    expect(
      imageReviewSchema.safeParse({ ...review, relevance: 0 }).success,
    ).toBe(false);
    expect(
      imageReviewSchema.safeParse({ ...review, relevance: 11 }).success,
    ).toBe(false);
    expect(
      imageReviewSchema.safeParse({ ...review, relevance: 8 }).success,
    ).toBe(true);
  });
});
