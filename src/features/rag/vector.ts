import "server-only";

/// pgvector accepts this bracketed literal format cast with `::vector`.
/// Always built from embedding API output (plain floats), never from raw
/// user input, and passed as a bound parameter in every query that uses
/// it — not string-concatenated into SQL — so this isn't an injection
/// vector despite building a string.
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
