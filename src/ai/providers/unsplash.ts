import "server-only";

import { serverEnv } from "@/config/env.server";

import type { ImageProvider, ImageResult } from "./image-types";

/// Required by Unsplash's API Guidelines (not just courtesy): every image
/// actually used by the app must link back to the photographer's profile
/// and to Unsplash, both tagged with utm_source/utm_medium, and must ping
/// the photo's `download_location` endpoint at point of use so Unsplash can
/// credit the photographer's download count.
const UTM_PARAMS = "utm_source=linkedin_ai_studio&utm_medium=referral";

type UnsplashPhoto = {
  urls: { regular: string; thumb: string };
  user: { name: string; links: { html: string } };
  links: { html: string; download_location: string };
};

type UnsplashSearchResponse = {
  results: UnsplashPhoto[];
};

export class UnsplashImageProvider implements ImageProvider {
  readonly name = "unsplash";
  readonly generative = false;

  constructor() {
    if (!serverEnv.UNSPLASH_ACCESS_KEY) {
      throw new Error(
        "UNSPLASH_ACCESS_KEY is not set. Add it to .env to use IMAGE_PROVIDER=unsplash.",
      );
    }
  }

  async getImage(query: string): Promise<ImageResult> {
    const searchUrl = new URL("https://api.unsplash.com/search/photos");
    searchUrl.searchParams.set("query", query);
    searchUrl.searchParams.set("per_page", "1");
    searchUrl.searchParams.set("orientation", "landscape");

    const response = await fetch(searchUrl, {
      headers: {
        Authorization: `Client-ID ${serverEnv.UNSPLASH_ACCESS_KEY}`,
        "Accept-Version": "v1",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Unsplash search failed (${response.status}): ${await response.text()}`,
      );
    }

    const data = (await response.json()) as UnsplashSearchResponse;
    const photo = data.results[0];
    if (!photo) {
      throw new Error(`No Unsplash results for query "${query}".`);
    }

    // Fire the required download-tracking ping — best effort, doesn't
    // block returning the image if it fails (a tracking miss isn't a
    // reason to fail the whole generation).
    fetch(photo.links.download_location, {
      headers: { Authorization: `Client-ID ${serverEnv.UNSPLASH_ACCESS_KEY}` },
    }).catch(() => {});

    return {
      url: photo.urls.regular,
      thumbUrl: photo.urls.thumb,
      attributionName: photo.user.name,
      attributionUrl: `${photo.user.links.html}?${UTM_PARAMS}`,
      sourceUrl: `${photo.links.html}?${UTM_PARAMS}`,
    };
  }
}
