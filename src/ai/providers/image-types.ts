/// A third provider interface alongside AIProvider (text) and
/// AIEmbeddingProvider — image sourcing is a distinct capability again, and
/// this one is search-based (Unsplash) rather than generative, unlike the
/// other two. Same rule applies: nothing outside src/ai/providers/*.ts may
/// import a provider SDK/API client directly.
export type ImageResult = {
  url: string;
  thumbUrl?: string;
  attributionName?: string;
  attributionUrl?: string;
  sourceUrl?: string;
};

export interface ImageProvider {
  readonly name: string;
  getImage(query: string): Promise<ImageResult>;
}
