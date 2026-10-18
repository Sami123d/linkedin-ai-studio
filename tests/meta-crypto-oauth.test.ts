import { describe, expect, it } from "vitest";

import {
  decryptWithKey,
  encryptWithKey,
  parseEncryptionKey,
} from "@/lib/crypto/aes-gcm";
import { buildAuthUrl, META_SCOPES } from "@/lib/meta/oauth";
import {
  createOAuthState,
  OAUTH_STATE_TTL_MS,
  verifyOAuthState,
} from "@/lib/meta/oauth-state";

const key = parseEncryptionKey("a".repeat(64));
const otherKey = parseEncryptionKey("b".repeat(64));

describe("token encryption", () => {
  it("round-trips and does not contain the plaintext", () => {
    const encrypted = encryptWithKey("EAAB-secret-token", key);
    expect(encrypted).not.toContain("EAAB-secret-token");
    expect(encrypted.startsWith("v1.")).toBe(true);
    expect(decryptWithKey(encrypted, key)).toBe("EAAB-secret-token");
  });

  it("uses a fresh IV each time", () => {
    expect(encryptWithKey("x", key)).not.toBe(encryptWithKey("x", key));
  });

  it("fails with the wrong key or tampered data", () => {
    const encrypted = encryptWithKey("token", key);
    expect(() => decryptWithKey(encrypted, otherKey)).toThrow(
      /could not be decrypted/,
    );
    const parts = encrypted.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptWithKey(parts.join("."), key)).toThrow();
    expect(() => decryptWithKey("garbage", key)).toThrow(/format/);
  });

  it("accepts hex or base64 keys of 32 bytes only", () => {
    expect(
      parseEncryptionKey(Buffer.alloc(32, 1).toString("base64")),
    ).toHaveLength(32);
    expect(() => parseEncryptionKey("short")).toThrow(/32 bytes/);
  });
});

describe("OAuth state", () => {
  const profile = "11111111-1111-1111-1111-111111111111";

  it("accepts the state the same browser and user started", () => {
    const { state, nonce } = createOAuthState(profile, key);
    expect(verifyOAuthState(state, nonce, profile, key)).toEqual({
      valid: true,
    });
  });

  it("rejects a missing state or cookie", () => {
    const { state, nonce } = createOAuthState(profile, key);
    expect(verifyOAuthState(null, nonce, profile, key)).toMatchObject({
      valid: false,
      reason: "missing",
    });
    expect(verifyOAuthState(state, undefined, profile, key)).toMatchObject({
      valid: false,
      reason: "missing",
    });
  });

  it("rejects a state that does not match this browser's cookie (CSRF)", () => {
    const a = createOAuthState(profile, key);
    const b = createOAuthState(profile, key);
    expect(verifyOAuthState(a.state, b.nonce, profile, key)).toMatchObject({
      valid: false,
      reason: "mismatch",
    });
  });

  it("rejects a state signed for another profile or with another key", () => {
    const { state, nonce } = createOAuthState(profile, key);
    expect(
      verifyOAuthState(
        state,
        nonce,
        "22222222-2222-2222-2222-222222222222",
        key,
      ),
    ).toMatchObject({ valid: false, reason: "invalid" });
    expect(verifyOAuthState(state, nonce, profile, otherKey)).toMatchObject({
      valid: false,
      reason: "invalid",
    });
  });

  it("rejects a forged signature", () => {
    const { state, nonce } = createOAuthState(profile, key);
    const forged = `${state.slice(0, state.lastIndexOf("."))}.AAAA`;
    expect(verifyOAuthState(forged, nonce, profile, key)).toMatchObject({
      valid: false,
      reason: "invalid",
    });
  });

  it("rejects an expired state", () => {
    const issued = Date.now() - OAUTH_STATE_TTL_MS - 1000;
    const { state, nonce } = createOAuthState(profile, key, issued);
    expect(verifyOAuthState(state, nonce, profile, key)).toMatchObject({
      valid: false,
      reason: "expired",
    });
  });
});

describe("authorization URL", () => {
  it("targets the pinned version with state, redirect and the documented scopes", () => {
    const url = new URL(
      buildAuthUrl({
        appId: "123",
        redirectUri: "https://app.example.com/auth/meta/callback",
        state: "abc.def",
        version: "v25.0",
      }),
    );
    expect(url.origin + url.pathname).toBe(
      "https://www.facebook.com/v25.0/dialog/oauth",
    );
    expect(url.searchParams.get("client_id")).toBe("123");
    expect(url.searchParams.get("state")).toBe("abc.def");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.example.com/auth/meta/callback",
    );
    expect(url.searchParams.get("scope")).toBe(META_SCOPES.join(","));
    expect(url.searchParams.get("scope")).toContain(
      "instagram_content_publish",
    );
    expect(url.searchParams.get("scope")).toContain("pages_manage_posts");
    // The app secret must never be part of the browser URL.
    expect(url.toString()).not.toMatch(/secret/i);
  });
});
