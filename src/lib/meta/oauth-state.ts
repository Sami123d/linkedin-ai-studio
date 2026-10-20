import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import "server-only";

/// CSRF protection for the Meta OAuth round trip. The state sent to Meta is
/// `<nonce>.<hmac>`: the nonce is also kept in an httpOnly cookie, and the
/// HMAC binds it to the signed-in profile and an issue time, so a callback is
/// only accepted in the same browser, for the same user, within the TTL.
/// Cookie holding the nonce for the in-flight authorization (scoped to the
/// callback path).
export const META_STATE_COOKIE = "meta_oauth_nonce";
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function sign(nonce: string, profileId: string, key: Buffer): string {
  return createHmac("sha256", key)
    .update(`meta-oauth-state:${profileId}:${nonce}`)
    .digest("base64url");
}

export function createOAuthState(
  profileId: string,
  key: Buffer,
  now = Date.now(),
): { state: string; nonce: string } {
  const nonce = `${now.toString(36)}-${randomBytes(18).toString("base64url")}`;
  return { state: `${nonce}.${sign(nonce, profileId, key)}`, nonce };
}

export type OAuthStateCheck =
  | { valid: true }
  | { valid: false; reason: "missing" | "mismatch" | "expired" | "invalid" };

export function verifyOAuthState(
  state: string | null,
  cookieNonce: string | undefined,
  profileId: string,
  key: Buffer,
  now = Date.now(),
): OAuthStateCheck {
  if (!state || !cookieNonce) return { valid: false, reason: "missing" };

  const dot = state.lastIndexOf(".");
  if (dot < 1) return { valid: false, reason: "invalid" };
  const nonce = state.slice(0, dot);
  const mac = state.slice(dot + 1);

  // The state returned by Meta must match the one this browser started;
  // this is what blocks a login-CSRF callback forged from another browser.
  const a = Buffer.from(nonce);
  const b = Buffer.from(cookieNonce);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, reason: "mismatch" };
  }

  const expected = Buffer.from(sign(nonce, profileId, key));
  const provided = Buffer.from(mac);
  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    return { valid: false, reason: "invalid" };
  }

  const issuedAt = parseInt(nonce.split("-")[0] ?? "", 36);
  if (!Number.isFinite(issuedAt) || now - issuedAt > OAUTH_STATE_TTL_MS) {
    return { valid: false, reason: "expired" };
  }
  return { valid: true };
}
