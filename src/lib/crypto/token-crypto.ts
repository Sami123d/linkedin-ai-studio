import "server-only";

import { serverEnv } from "@/config/env.server";
import {
  decryptWithKey,
  encryptWithKey,
  parseEncryptionKey,
} from "@/lib/crypto/aes-gcm";

/// The only place the encryption key is read. Token plaintext exists only in
/// server memory around a Graph API call. The key is parsed on every call so a
/// missing or malformed key fails the request instead of crashing at import.
function key(): Buffer {
  if (!serverEnv.TOKEN_ENCRYPTION_KEY) {
    throw new Error("TOKEN_ENCRYPTION_KEY is not configured.");
  }
  return parseEncryptionKey(serverEnv.TOKEN_ENCRYPTION_KEY);
}

export function encryptToken(plaintext: string): string {
  return encryptWithKey(plaintext, key());
}

export function decryptToken(payload: string): string {
  return decryptWithKey(payload, key());
}
