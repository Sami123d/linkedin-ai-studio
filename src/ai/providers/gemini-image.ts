import "server-only";

import type { ImageProvider, ImageResult } from "./image-types";

/// Scaffold only, same reasoning as the Ollama provider scaffolds — proves
/// ImageProvider is genuinely provider-agnostic, and gives IMAGE_PROVIDER
/// a real upgrade path once it's worth building. NOT a missing-code
/// problem: verified live against the API that gemini-2.5-flash-image (the
/// cheapest Gemini image model) has a free-tier request quota of 0 — it
/// 429s immediately without a billing-enabled Google Cloud project, unlike
/// the text/embedding models used elsewhere in this app. A real
/// implementation would also need to upload the returned image bytes to
/// Supabase Storage (like the Resume file upload in Milestone 4) rather
/// than returning a URL directly, since Gemini returns inline base64 data,
/// not a hosted image.
export class GeminiImageProvider implements ImageProvider {
  readonly name = "gemini";

  async getImage(query: string): Promise<ImageResult> {
    throw new Error(
      `Gemini image generation is not enabled: it requires a billing-enabled Google Cloud project (received a ${query.length}-character query). Set IMAGE_PROVIDER=unsplash until this is built out, or enable billing and implement the Supabase Storage upload step this provider needs.`,
    );
  }
}
