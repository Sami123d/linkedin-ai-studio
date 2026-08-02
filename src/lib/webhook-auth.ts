import { timingSafeEqual } from "node:crypto";

import "server-only";

/// Constant-time secret comparison for external webhook endpoints (n8n
/// callers) — a naive `===` leaks timing information proportional to how
/// many leading characters match, which is exactly the kind of oracle an
/// unauthenticated public endpoint shouldn't offer.
export function secretsMatch(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

export function checkWebhookSecret(
  request: Request,
  expected: string,
): boolean {
  const provided = request.headers.get("x-webhook-secret") ?? "";
  return secretsMatch(provided, expected);
}
