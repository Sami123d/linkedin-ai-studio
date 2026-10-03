import { beforeEach, describe, expect, it, vi } from "vitest";

const generateContent = vi.fn();

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = {
      generateContent: (...args: unknown[]) => generateContent(...args),
    };
  },
}));
vi.mock("@/config/env.server", () => ({
  serverEnv: {
    GEMINI_API_KEY: "test-key",
    GEMINI_MODEL: "primary-model",
    GEMINI_FALLBACK_MODEL: "fallback-model",
  },
}));

const { GeminiProvider, isTransientGeminiError } =
  await import("@/ai/providers/gemini");

const busy = Object.assign(
  new Error('{"error":{"code":503,"status":"UNAVAILABLE"}}'),
  {
    status: 503,
  },
);
const ok = (text: string) => ({ text, usageMetadata: { totalTokenCount: 7 } });

describe("GeminiProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1000 });
    generateContent.mockReset();
  });

  it("uses the primary model when it answers", async () => {
    generateContent.mockResolvedValueOnce(ok("hi"));
    const result = await new GeminiProvider().generate({ prompt: "p" });
    expect(result).toMatchObject({ text: "hi", model: "primary-model" });
  });

  it("falls back to the lighter model when the primary stays overloaded", async () => {
    generateContent
      .mockRejectedValueOnce(busy)
      .mockRejectedValueOnce(busy)
      .mockResolvedValueOnce(ok("from fallback"));
    const result = await new GeminiProvider().generate({ prompt: "p" });
    expect(result).toMatchObject({
      text: "from fallback",
      model: "fallback-model",
    });
    expect(generateContent.mock.calls.map((c) => c[0].model)).toEqual([
      "primary-model",
      "primary-model",
      "fallback-model",
    ]);
  });

  it("does not retry non-transient errors", async () => {
    generateContent.mockRejectedValueOnce(
      Object.assign(new Error("API key not valid"), { status: 400 }),
    );
    await expect(
      new GeminiProvider().generate({ prompt: "p" }),
    ).rejects.toThrow("API key not valid");
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("recognises transient errors by status or message", () => {
    expect(isTransientGeminiError(busy)).toBe(true);
    expect(isTransientGeminiError(new Error("RESOURCE_EXHAUSTED"))).toBe(true);
    expect(isTransientGeminiError(new Error("invalid argument"))).toBe(false);
  });
});
