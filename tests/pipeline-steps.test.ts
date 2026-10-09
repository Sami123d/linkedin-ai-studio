import { describe, expect, it } from "vitest";

import { PIPELINE_STEPS, pipelineStepInputSchema } from "@/validation/pipeline";

describe("pipeline steps", () => {
  it("run in the order the stages depend on each other", () => {
    expect(PIPELINE_STEPS).toEqual([
      "research",
      "plan",
      "write",
      "review",
      "image",
    ]);
  });

  it("accepts a known step and rejects unknown ones or a missing trend", () => {
    expect(
      pipelineStepInputSchema.safeParse({ trendId: "t1", step: "write" })
        .success,
    ).toBe(true);
    expect(
      pipelineStepInputSchema.safeParse({ trendId: "t1", step: "publish" })
        .success,
    ).toBe(false);
    expect(
      pipelineStepInputSchema.safeParse({ trendId: "", step: "write" }).success,
    ).toBe(false);
    expect(pipelineStepInputSchema.safeParse(null).success).toBe(false);
  });
});
