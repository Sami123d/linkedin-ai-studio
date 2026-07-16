/// The one interface every AI-dependent feature (Research Agent now,
/// Planning/Writing/Review agents later) is allowed to depend on. Nothing
/// outside src/ai/providers/*.ts may import a provider SDK (`@google/genai`,
/// an Ollama client, etc.) directly — swapping AI_PROVIDER must never
/// require touching business logic.
export type AIUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type AIGenerateParams = {
  systemPrompt?: string;
  prompt: string;
  /// Ask the provider to return valid JSON. Providers that support a native
  /// JSON response mode (Gemini) should use it; providers that don't
  /// (a local Ollama model) fall back to prompt instructions and best
  /// effort — callers must still validate/parse the result themselves
  /// (see src/ai/generate-structured.ts), this flag is a hint, not a
  /// guarantee.
  json?: boolean;
};

export type AIGenerateResult = {
  text: string;
  model: string;
  usage?: AIUsage;
};

export interface AIProvider {
  readonly name: string;
  generate(params: AIGenerateParams): Promise<AIGenerateResult>;
}
