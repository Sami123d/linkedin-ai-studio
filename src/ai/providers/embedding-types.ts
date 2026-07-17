/// A separate interface from AIProvider (src/ai/providers/types.ts) —
/// embedding and text generation are different capabilities, and not every
/// provider needs to support both the same way. Same rule applies: nothing
/// outside src/ai/providers/*.ts may import a provider SDK directly.
export type AIEmbeddingResult = {
  embedding: number[];
  model: string;
};

export interface AIEmbeddingProvider {
  readonly name: string;
  embed(text: string): Promise<AIEmbeddingResult>;
}
