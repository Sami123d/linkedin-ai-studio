import { describe, expect, it } from "vitest";

import {
  generateVariant,
  VariantGenerationError,
  type VariantInput,
} from "@/ai/writing/generate-variant";
import type { AIProvider } from "@/ai/providers/types";

function provider(text: string): AIProvider {
  return {
    name: "fake",
    async generate() {
      return { text, model: "fake-1" };
    },
  };
}

const input: VariantInput = {
  platform: "INSTAGRAM",
  selectedAngle: "angle",
  hook: "hook",
  keyMessage: "message",
  toneGuidance: "warm",
  callToAction: "reply",
  sourceContent: "LinkedIn source text",
  writingSamples: [],
  knowledgeContext: [],
};

describe("generateVariant", () => {
  it("returns validated content with prompt and raw response", async () => {
    const result = await generateVariant(
      provider('{"content":"Caption","hashtags":["#a","b"]}'),
      input,
    );
    expect(result.data).toEqual({ content: "Caption", hashtags: ["a", "b"] });
    expect(result.prompt).toContain("LinkedIn source text");
    expect(result.raw.model).toBe("fake-1");
  });

  it("wraps invalid JSON in a VariantGenerationError carrying prompt and raw", async () => {
    const error = await generateVariant(provider("not json"), input).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(VariantGenerationError);
    expect(error.prompt).toContain("LinkedIn source text");
    expect(error.raw?.text).toBe("not json");
  });

  it("fails (with raw) when output exceeds platform limits", async () => {
    const tooLong = JSON.stringify({ content: "x".repeat(2300), hashtags: [] });
    const error = await generateVariant(provider(tooLong), input).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(VariantGenerationError);
    expect(error.message).toMatch(/limits/);
    expect(error.raw?.text).toBe(tooLong);
  });

  it("wraps provider errors without raw", async () => {
    const failing: AIProvider = {
      name: "fake",
      async generate() {
        throw new Error("network down");
      },
    };
    const error = await generateVariant(failing, input).catch((e) => e);
    expect(error).toBeInstanceOf(VariantGenerationError);
    expect(error.message).toMatch(/network down/);
    expect(error.raw).toBeUndefined();
  });
});
