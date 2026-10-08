import "server-only";

import { serverEnv } from "@/config/env.server";

import type { ImageProvider, ImageResult } from "./image-types";

/// LinkedIn's recommended size for a single-image feed post.
export const POLLINATIONS_WIDTH = 1200;
export const POLLINATIONS_HEIGHT = 627;

/// Generation is synchronous on the GET, so a cold request can take a while.
const GENERATION_TIMEOUT_MS = 90_000;
const UPLOAD_TIMEOUT_MS = 60_000;

/// gen.pollinations.ai is the current API but needs a key on every request,
/// including the <img> tag and the LinkedIn publisher's download, so its URL
/// can't be stored without leaking the key. With a key we store the public
/// media.pollinations.ai copy instead. Without one we use the legacy
/// anonymous endpoint, which still serves cached, seed-stable images but is
/// rate limited, watermarked and ignores `model`.
const GEN_IMAGE_URL = "https://gen.pollinations.ai/image/";
const LEGACY_IMAGE_URL = "https://image.pollinations.ai/prompt/";
const MEDIA_HOST = "media.pollinations.ai";
const MEDIA_UPLOAD_URL = `https://${MEDIA_HOST}/upload`;

/// HalfClicks brand palette (halfclicks.com: #0D0D0D, #D4FF3A, #F4F4EF)
/// applied to every image so the feed reads as one consistent brand.
/// Phrased positively ("purely visual, wordless") because image models tend
/// to ignore negations and draw whatever words they see.
export const BRAND_STYLE = [
  "Eye-catching LinkedIn feed image, high-end 3D render",
  "deep matte black background (#0D0D0D)",
  "glowing electric lime-green neon accents (#D4FF3A) as the only accent color",
  "soft off-white highlights (#F4F4EF)",
  "dramatic rim lighting, cinematic depth of field",
  "bold minimal composition with one clear focal point",
  "premium modern tech studio aesthetic, purely visual, wordless",
].join(", ");

/// The query is a visual scene written by the image-scene agent (see
/// src/ai/images/generate-image-scene.ts); this adds the brand style.
export function buildPollinationsPrompt(query: string): string {
  return `${query.trim().replace(/\.$/, "")}. ${BRAND_STYLE}.`;
}

/// FNV-1a over the query: the same query always yields the same seed, so the
/// URL (and the image behind it) stays stable between approval and publish.
export function seedFromQuery(query: string): number {
  let hash = 0x811c9dc5;
  for (const char of query.trim().toLowerCase()) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 2_147_483_647;
}

export function buildPollinationsUrl(params: {
  query: string;
  model: string;
  authenticated: boolean;
}): string {
  const base = params.authenticated ? GEN_IMAGE_URL : LEGACY_IMAGE_URL;
  const url = new URL(
    base + encodeURIComponent(buildPollinationsPrompt(params.query)),
  );
  url.searchParams.set("width", String(POLLINATIONS_WIDTH));
  url.searchParams.set("height", String(POLLINATIONS_HEIGHT));
  url.searchParams.set("seed", String(seedFromQuery(params.query)));
  url.searchParams.set("nologo", "true");
  if (params.authenticated) url.searchParams.set("model", params.model);
  return url.toString();
}

/// Finds a public media.pollinations.ai URL in a `Link` header, if the
/// generation response already persisted the image there.
export function mediaUrlFromLinkHeader(
  header: string | null,
): string | undefined {
  for (const match of header?.matchAll(/<([^>]+)>/g) ?? []) {
    if (match[1].startsWith(`https://${MEDIA_HOST}/`)) return match[1];
  }
  return undefined;
}

export class PollinationsImageProvider implements ImageProvider {
  readonly name = "pollinations";
  readonly generative = true;

  async getImage(query: string): Promise<ImageResult> {
    const apiKey = serverEnv.POLLINATIONS_API_KEY;
    const url = buildPollinationsUrl({
      query,
      model: serverEnv.POLLINATIONS_MODEL,
      authenticated: Boolean(apiKey),
    });

    // Fetching once verifies the image really generates and warms the
    // cache, so the publisher's later download is fast.
    const response = await fetchWithTimeout(
      url,
      { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} },
      GENERATION_TIMEOUT_MS,
      "Pollinations image generation",
    );
    if (!response.ok) {
      throw new Error(
        `Pollinations image generation failed (${response.status}): ${(await response.text()).slice(0, 500)}`,
      );
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      throw new Error(
        `Pollinations returned "${contentType || "no content type"}" instead of an image.`,
      );
    }
    const image = await response.blob();

    if (!apiKey) return { url, sourceUrl: "https://pollinations.ai" };

    const publicUrl =
      mediaUrlFromLinkHeader(response.headers.get("link")) ??
      (await uploadToMedia(image, contentType, apiKey));
    return { url: publicUrl, sourceUrl: "https://pollinations.ai" };
  }
}

async function uploadToMedia(
  image: Blob,
  contentType: string,
  apiKey: string,
): Promise<string> {
  const form = new FormData();
  const extension = contentType.split("/")[1]?.split(";")[0] || "jpg";
  form.append("file", image, `image.${extension}`);

  const response = await fetchWithTimeout(
    MEDIA_UPLOAD_URL,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    },
    UPLOAD_TIMEOUT_MS,
    "Pollinations media upload",
  );
  if (!response.ok) {
    throw new Error(
      `Pollinations media upload failed (${response.status}): ${(await response.text()).slice(0, 500)}`,
    );
  }
  const data = (await response.json()) as { url?: unknown };
  if (typeof data.url !== "string") {
    throw new Error("Pollinations media upload returned no URL.");
  }
  return data.url;
}

/// Turns an AbortSignal timeout into a readable error instead of a bare
/// "The operation was aborted".
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(`${label} timed out after ${timeoutMs / 1000}s.`);
    }
    throw error;
  }
}
