import crypto from "node:crypto";
import { loadEnv } from "@bf/config";

/**
 * AES-256-GCM secret encryption for SecretReference rows with source=ENCRYPTED.
 * The key lives only in SECRET_ENCRYPTION_KEY on the server. Stored format:
 * base64(iv[12] | ciphertext | authTag[16]). Decrypted values are used
 * server-side only and never returned to the browser.
 */
function key(): Buffer {
  return Buffer.from(loadEnv().SECRET_ENCRYPTION_KEY, "hex");
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, tag]).toString("base64");
}

export function decryptSecret(stored: string): string {
  const raw = Buffer.from(stored, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(raw.length - 16);
  const ciphertext = raw.subarray(12, raw.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** "sk-abc…wxyz" style mask for UI display. Never reveals more than 4 chars each side. */
export function maskSecret(value: string): string {
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/** Resolve a SecretReference to its value (ENV name or encrypted blob). */
export function resolveSecretReference(
  source: "ENV" | "ENCRYPTED",
  reference: string,
): string | null {
  if (source === "ENV") return process.env[reference] ?? null;
  try {
    return decryptSecret(reference);
  } catch {
    return null;
  }
}
