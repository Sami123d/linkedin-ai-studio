import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import "server-only";

/// Pure AES-256-GCM helpers (no env access, so they're unit-testable).
/// Payload format: `v1.<iv>.<authTag>.<ciphertext>`, each part base64url.
/// The version prefix leaves room for key rotation later.
const VERSION = "v1";
const IV_BYTES = 12;

/// Accepts 32 bytes as 64 hex chars or base64. Hex is checked first because
/// a 64-char hex string is also valid base64 (but decodes to 48 bytes).
export function parseEncryptionKey(raw: string): Buffer {
  const trimmed = raw.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");
  if (key.length !== 32) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex characters or base64).",
    );
  }
  return key;
}

export function encryptWithKey(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptWithKey(payload: string, key: Buffer): string {
  const [version, iv, tag, ciphertext] = payload.split(".");
  if (version !== VERSION || !iv || !tag || !ciphertext) {
    throw new Error("Unrecognized encrypted token format.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Wrong key or tampered data. Deliberately generic.
    throw new Error("Stored token could not be decrypted.");
  }
}
