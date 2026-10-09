import { describe, expect, it, vi } from "vitest";

import {
  generateReviewedImage,
  MAX_IMAGE_ROUNDS,
} from "@/ai/images/generate-reviewed-image";
import type { ImageProvider } from "@/ai/providers/image-types";
import type { AIGenerateParams, AIProvider } from "@/ai/providers/types";

type Review = { relevance: number; hasText: boolean; reason: string };

/// Scene calls have no images; review calls carry the image. Each review in
/// `reviews` answers one round (an Error makes that review call fail).
function fakeAI(reviews: (Review | Error)[]) {
  const calls: AIGenerateParams[] = [];
  let sceneCount = 0;
  let reviewCount = 0;
  const provider: AIProvider = {
    name: "fake",
    async generate(params) {
      calls.push(params);
      if (params.images) {
        const review = reviews[reviewCount++];
        if (review instanceof Error) throw review;
        return { text: JSON.stringify(review), model: "fake" };
      }
      sceneCount++;
      return {
        text: JSON.stringify({
          coreMessage: "m",
          visualSubject: "s",
          scene: `Scene number ${sceneCount} with a glowing browser window.`,
        }),
        model: "fake",
      };
    },
  };
  return { provider, calls };
}

function fakeImages(): ImageProvider & { getImage: ReturnType<typeof vi.fn> } {
  let n = 0;
  return {
    name: "fake-images",
    generative: true,
    getImage: vi.fn(async () => ({ url: `https://img/${++n}` })),
  };
}

const input = {
  topic: "Headless browsers",
  angle: null,
  hook: null,
  content: "post",
};
const fetchImage = vi.fn(async () => ({
  mimeType: "image/jpeg",
  data: "AAAA",
}));
const good: Review = { relevance: 8, hasText: false, reason: "Clear." };

describe("generateReviewedImage", () => {
  it("stops after one round when the first image passes", async () => {
    const { provider, calls } = fakeAI([good]);
    const images = fakeImages();

    const result = await generateReviewedImage(provider, images, input, {
      fetchImage,
    });

    expect(images.getImage).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      result: { url: "https://img/1" },
      review: good,
      rounds: 1,
    });
    expect(calls[1].images).toEqual([{ mimeType: "image/jpeg", data: "AAAA" }]);
  });

  it("retries with the reviewer's feedback and keeps the best image", async () => {
    const { provider, calls } = fakeAI([
      { relevance: 4, hasText: false, reason: "Too generic." },
      { relevance: 6, hasText: false, reason: "Closer." },
      { relevance: 5, hasText: false, reason: "Worse." },
    ]);
    const images = fakeImages();

    const result = await generateReviewedImage(provider, images, input, {
      fetchImage,
    });

    expect(images.getImage).toHaveBeenCalledTimes(MAX_IMAGE_ROUNDS);
    expect(result.result.url).toBe("https://img/2");
    expect(result.review?.relevance).toBe(6);
    expect(result.rounds).toBe(MAX_IMAGE_ROUNDS);
    expect(calls[2].prompt).toContain("rejected: Too generic.");
  });

  it("treats visible text as a failure and penalizes it", async () => {
    const { provider, calls } = fakeAI([
      { relevance: 9, hasText: true, reason: "Has letters." },
      { relevance: 7, hasText: false, reason: "Clean." },
    ]);
    const images = fakeImages();

    const result = await generateReviewedImage(provider, images, input, {
      fetchImage,
    });

    expect(result.result.url).toBe("https://img/2");
    expect(result.rounds).toBe(2);
    expect(calls[2].prompt).toContain("It also contained visible text.");
  });

  it("keeps the image when the review call fails", async () => {
    const { provider } = fakeAI([new Error("503 overloaded")]);
    const images = fakeImages();

    const result = await generateReviewedImage(provider, images, input, {
      fetchImage,
    });

    expect(images.getImage).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      result: { url: "https://img/1" },
      review: null,
    });
  });

  it("propagates image generation errors", async () => {
    const { provider } = fakeAI([good]);
    const images = fakeImages();
    images.getImage.mockRejectedValueOnce(new Error("Pollinations down"));

    await expect(
      generateReviewedImage(provider, images, input, { fetchImage }),
    ).rejects.toThrow("Pollinations down");
  });
});

describe("generateReviewedImage branding", () => {
  const png = new Uint8Array([137, 80, 78, 71]);

  function hostedImages(host: (image: Blob) => Promise<string>) {
    const images = fakeImages();
    return Object.assign(images, { host: vi.fn(host) });
  }

  it("brands the winning image and returns the hosted branded URL", async () => {
    const { provider } = fakeAI([good]);
    const images = hostedImages(async () => "https://media/branded");
    const brand = vi.fn(async () => png);

    const result = await generateReviewedImage(provider, images, input, {
      fetchImage,
      brand,
    });

    expect(fetchImage).toHaveBeenLastCalledWith("https://img/1");
    expect(brand).toHaveBeenCalledWith({
      mimeType: "image/jpeg",
      data: "AAAA",
    });
    const hosted = images.host.mock.calls[0][0] as Blob;
    expect(hosted.type).toBe("image/png");
    expect(result.branded).toBe(true);
    expect(result.result.url).toBe("https://media/branded");
  });

  it("keeps the unbranded image when branding or hosting fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { provider } = fakeAI([good]);
    const images = hostedImages(async () => {
      throw new Error("needs API key");
    });

    const result = await generateReviewedImage(provider, images, input, {
      fetchImage,
      brand: async () => png,
    });

    expect(result.branded).toBe(false);
    expect(result.result.url).toBe("https://img/1");
    error.mockRestore();
  });

  it("skips branding for providers that cannot host images", async () => {
    const { provider } = fakeAI([good]);
    const brand = vi.fn(async () => png);

    const result = await generateReviewedImage(provider, fakeImages(), input, {
      fetchImage,
      brand,
    });

    expect(brand).not.toHaveBeenCalled();
    expect(result.branded).toBe(false);
  });
});
