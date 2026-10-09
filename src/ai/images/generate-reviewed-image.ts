import "server-only";

import type { AIProvider, ImageProvider, ImageResult } from "@/ai/providers";
import type { ImageReview } from "@/validation/images";

import { brandImage } from "./brand-image";
import {
  generateImageScene,
  type ImageSceneInput,
} from "./generate-image-scene";
import { reviewImage } from "./review-image";

/// Up to 3 scene + image + review rounds (~15s each). Good enough images
/// usually pass on the first round; the cap bounds cost and wait time.
export const MAX_IMAGE_ROUNDS = 3;
export const MIN_RELEVANCE = 7;

type ImageData = { mimeType: string; data: string };

export type ReviewedImage = {
  scene: string;
  result: ImageResult;
  review: ImageReview | null;
  rounds: number;
  /// True when the HalfClicks logo and slogan were added to `result.url`.
  branded: boolean;
};

/// Seams for tests; production uses the real download and overlay.
export type ReviewedImageDeps = {
  fetchImage?: (url: string) => Promise<ImageData>;
  brand?: (image: ImageData) => Promise<Uint8Array>;
};

/// Visible text is penalized as heavily as a 3-point relevance drop: garbled
/// pseudo-words look worse on LinkedIn than a loosely related image.
function score(review: ImageReview | null): number {
  if (!review) return 0;
  return review.relevance - (review.hasText ? 3 : 0);
}

function passes(review: ImageReview | null): boolean {
  return !!review && review.relevance >= MIN_RELEVANCE && !review.hasText;
}

/// Generates a scene, renders it, then has the text model look at the
/// result next to the post. A weak image is regenerated with the reviewer's
/// feedback, and the best-scoring round wins. If the review itself fails
/// (e.g. Gemini overloaded) the image is kept rather than failing the run.
/// The winner then gets the HalfClicks brand strip (see brand-image.tsx).
export async function generateReviewedImage(
  ai: AIProvider,
  images: ImageProvider,
  input: ImageSceneInput,
  deps: ReviewedImageDeps = {},
): Promise<ReviewedImage> {
  const fetchImage = deps.fetchImage ?? downloadImage;
  let best: Omit<ReviewedImage, "branded"> | undefined;
  let feedback: string | undefined;

  for (let round = 1; round <= MAX_IMAGE_ROUNDS; round++) {
    const { data } = await generateImageScene(ai, input, feedback);
    const result = await images.getImage(data.scene);

    let review: ImageReview | null = null;
    try {
      review = await reviewImage(ai, input, await fetchImage(result.url));
    } catch {
      review = null;
    }

    const candidate = { scene: data.scene, result, review, rounds: round };
    if (!best || score(review) > score(best.review)) best = candidate;
    best.rounds = round;
    if (passes(review) || !review) break;

    feedback = `${review.reason}${review.hasText ? " It also contained visible text." : ""}`;
  }

  const winner = best!;
  const brandedUrl = await addBrand(images, winner.result.url, deps);
  return brandedUrl
    ? {
        ...winner,
        result: { ...winner.result, url: brandedUrl },
        branded: true,
      }
    : { ...winner, branded: false };
}

/// Branding is a finishing touch, never a reason to lose a good image: any
/// failure (no hosting support, no API key, overlay error) returns null and
/// the unbranded image is used.
async function addBrand(
  images: ImageProvider,
  url: string,
  deps: ReviewedImageDeps,
): Promise<string | null> {
  if (!images.host) return null;
  try {
    const source = await (deps.fetchImage ?? downloadImage)(url);
    const png = await (deps.brand ?? brandImage)(source);
    return await images.host(
      new Blob([new Uint8Array(png)], { type: "image/png" }),
    );
  } catch (error) {
    console.error("Image branding failed, using the unbranded image:", error);
    return null;
  }
}

async function downloadImage(url: string): Promise<ImageData> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(
      `Image download for review failed: HTTP ${response.status}`,
    );
  }
  return {
    mimeType: response.headers.get("content-type") ?? "image/jpeg",
    data: Buffer.from(await response.arrayBuffer()).toString("base64"),
  };
}
