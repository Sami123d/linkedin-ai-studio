import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  generateStructured,
  StructuredGenerationError,
} from "@/ai/generate-structured";
import type { AIGenerateParams, AIProvider } from "@/ai/providers/types";

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

const schema = z.object({
  title: z.string().min(1),
  tags: z.array(z.string()),
});

describe("generateStructured", () => {
  it("requests JSON mode and returns schema-validated data", async () => {
    const { provider, calls } = fakeProvider('{"title":"Hello","tags":["a"]}');
    const result = await generateStructured({
      provider,
      systemPrompt: "sys",
      prompt: "p",
      schema,
    });
    expect(result.data).toEqual({ title: "Hello", tags: ["a"] });
    expect(result.raw.model).toBe("fake-1");
    expect(calls[0]).toEqual({ systemPrompt: "sys", prompt: "p", json: true });
  });

  it("throws StructuredGenerationError on non-JSON output", async () => {
    const { provider } = fakeProvider("Sure! Here is your JSON:");
    await expect(
      generateStructured({ provider, prompt: "p", schema }),
    ).rejects.toBeInstanceOf(StructuredGenerationError);
  });

  it("throws on JSON that fails the schema, keeping the raw response", async () => {
    const { provider } = fakeProvider('{"title":""}');
    const error = await generateStructured({
      provider,
      prompt: "p",
      schema,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StructuredGenerationError);
    expect((error as StructuredGenerationError).raw.text).toBe('{"title":""}');
  });
});
