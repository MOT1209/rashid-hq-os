import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

/**
 * Encryption at rest for integration secrets — OAuth access/refresh tokens and
 * third-party API keys.
 *
 * The database columns hold only the output of `seal()`, so a leaked dump is
 * useless without INTEGRATIONS_SECRET. AES-256-GCM gives confidentiality and
 * integrity in one pass; a tampered ciphertext fails `open()` rather than
 * decrypting to garbage.
 *
 * The key is derived from INTEGRATIONS_SECRET with a single SHA-256 so any
 * passphrase length works. Set it to a high-entropy value:
 *   openssl rand -base64 32
 */

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;

function key(): Buffer {
  const secret = process.env.INTEGRATIONS_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "INTEGRATIONS_SECRET is not set (or too short). Integrations that store " +
        "credentials cannot be used until it is. Generate one with `openssl rand -base64 32`.",
    );
  }
  return createHash("sha256").update(secret).digest();
}

/** True when a real key is configured — lets callers degrade gracefully. */
export function encryptionConfigured(): boolean {
  const secret = process.env.INTEGRATIONS_SECRET;
  return Boolean(secret && secret.length >= 16);
}

/** Serialises and encrypts an arbitrary JSON-able value. */
export function seal(value: unknown): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  // v1:<iv>:<tag>:<ciphertext>, all base64url — a version prefix leaves room
  // to rotate the scheme later without guessing at the format.
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    enc.toString("base64url"),
  ].join(":");
}

/** Reverses `seal()`. Throws if the secret is wrong or the value was tampered. */
export function open<T = unknown>(sealed: string): T {
  const parts = sealed.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Unrecognised sealed value.");
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]);
  return JSON.parse(dec.toString("utf8")) as T;
}

/**
 * A short, non-reversible fingerprint of a secret — for logs and the UI, so an
 * owner can tell two keys apart without either ever being displayed.
 */
export function fingerprint(secret: string): string {
  return createHash("sha256").update(secret).digest("hex").slice(0, 8);
}
