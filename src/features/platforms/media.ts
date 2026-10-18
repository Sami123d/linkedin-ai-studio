import { randomUUID } from "node:crypto";

import "server-only";

import { aspectCrop } from "@/features/platforms/media-geometry";
import {
  PUBLISH_IMAGE_HOSTS,
  PUBLISH_MEDIA_BUCKET,
} from "@/features/platforms/media-path";
import {
  PinnedFetchError,
  pinnedFetch,
  type PinnedFetchOptions,
} from "@/lib/net/pinned-fetch";
import { createClient } from "@/lib/supabase/server";

/// Instagram feed images must be JPEG, up to 8 MB, with an aspect ratio between
/// 4:5 and 1.91:1, fetchable by Meta from a public HTTPS URL. Generated
/// images are PNG (branded) or live on provider URLs that may not stay valid,
/// so at approval time the image is downloaded, converted and re-hosted in
/// the public `publish-media` bucket. Facebook photo posts reuse the same
/// file so there is one code path.
///
/// Only these prepared JPEGs ever become public. They live under
/// `<profileId>/<random uuid>.jpg`; resumes and every other bucket stay
/// private. Cleanup is in media-cleanup.ts.
const MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024;
const MAX_JPEG_BYTES = 8 * 1024 * 1024;
const MAX_WIDTH = 1440;

export class MediaPreparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaPreparationError";
  }
}

/// Downloads the campaign image only from an allowlisted provider host,
/// over a DNS-pinned connection (see src/lib/net/pinned-fetch.ts). Every
/// redirect is re-checked against the same allowlist and pinning.
export async function downloadCampaignImage(
  url: string,
  overrides: Pick<PinnedFetchOptions, "resolver" | "transport"> = {},
): Promise<Buffer> {
  let response;
  try {
    response = await pinnedFetch(url, {
      allowedHosts: PUBLISH_IMAGE_HOSTS,
      maxBytes: MAX_DOWNLOAD_BYTES,
      timeoutMs: 20_000,
      maxRedirects: 3,
      ...overrides,
    });
  } catch (error) {
    if (error instanceof PinnedFetchError) {
      switch (error.code) {
        case "BLOCKED_URL":
        case "BLOCKED_HOST":
        case "BLOCKED_ADDRESS":
          throw new MediaPreparationError(
            `The image can't be downloaded from this address: ${error.message}`,
          );
        case "TOO_LARGE":
          throw new MediaPreparationError("The image is too large to process.");
        case "TOO_MANY_REDIRECTS":
          throw new MediaPreparationError(
            "The image URL redirected too many times.",
          );
        default:
          break;
      }
    }
    throw new MediaPreparationError(
      "Could not download the image (it may have expired). Generate it again on the Images page.",
    );
  }

  if (response.status !== 200) {
    throw new MediaPreparationError(
      `Could not download the image (HTTP ${response.status}). Generate it again on the Images page.`,
    );
  }
  const type = String(response.headers["content-type"] ?? "");
  if (!type.startsWith("image/")) {
    throw new MediaPreparationError("The image URL did not return an image.");
  }
  return response.body;
}

/// `sharp` is a declared dependency (it is also what Next.js uses for image
/// optimization). If its native binary is missing on the host, the error says
/// so instead of publishing an unconverted image.
async function toJpeg(input: Buffer): Promise<Buffer> {
  let sharp: typeof import("sharp");
  try {
    sharp = (await import("sharp"))
      .default as unknown as typeof import("sharp");
  } catch {
    throw new MediaPreparationError(
      "Image conversion is unavailable on this server (the sharp library failed to load).",
    );
  }

  try {
    const meta = await sharp(input).metadata();
    if (!meta.width || !meta.height) {
      throw new MediaPreparationError("Could not read the image size.");
    }
    const crop = aspectCrop(meta.width, meta.height);
    for (const quality of [90, 78, 65]) {
      let pipeline = sharp(input);
      if (crop) pipeline = pipeline.extract(crop);
      const out = await pipeline
        .resize({ width: MAX_WIDTH, withoutEnlargement: true })
        .flatten({ background: "#ffffff" })
        .toColourspace("srgb")
        .jpeg({ quality })
        .toBuffer();
      if (out.length <= MAX_JPEG_BYTES) return out;
    }
    throw new MediaPreparationError(
      "The converted image is still larger than 8 MB.",
    );
  } catch (error) {
    if (error instanceof MediaPreparationError) throw error;
    throw new MediaPreparationError(
      "The image could not be converted to JPEG.",
    );
  }
}

/// Downloads `sourceUrl`, converts it to an Instagram-compatible JPEG and
/// uploads it to the public bucket under the caller's profile folder.
/// Runs as the signed-in user (Supabase session), so call it from a server
/// action, not from the scheduler.
export async function prepareMetaImage(
  profileId: string,
  sourceUrl: string,
): Promise<string> {
  const jpeg = await toJpeg(await downloadCampaignImage(sourceUrl));

  const supabase = await createClient();
  const path = `${profileId}/${randomUUID()}.jpg`;
  const { error } = await supabase.storage
    .from(PUBLISH_MEDIA_BUCKET)
    .upload(path, jpeg, { contentType: "image/jpeg", upsert: false });
  if (error) {
    throw new MediaPreparationError(
      "Could not store the image for publishing. Check that the publish-media storage bucket exists (apply the latest migration).",
    );
  }

  const { data } = supabase.storage
    .from(PUBLISH_MEDIA_BUCKET)
    .getPublicUrl(path);
  if (!data.publicUrl.startsWith("https://")) {
    throw new MediaPreparationError(
      "The stored image does not have a public HTTPS URL.",
    );
  }
  return data.publicUrl;
}
