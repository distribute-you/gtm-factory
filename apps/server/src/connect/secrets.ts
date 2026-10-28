/**
 * Credentials at rest: AES-256-GCM with the host's key (FACTORY_SECRETS_KEY, 32 bytes in base64).
 * A credential is sealed before it reaches the database and opened only to call its vendor;
 * it is never logged and never sent back to a page. No key set: nothing can be stored, said plainly.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const SECRETS_KEY_ENV = "FACTORY_SECRETS_KEY";

function key(): Buffer {
  const v = process.env[SECRETS_KEY_ENV];
  if (!v) throw new Error(`Credentials cannot be stored: ${SECRETS_KEY_ENV} is not set on this host.`);
  const k = Buffer.from(v, "base64");
  if (k.length !== 32) throw new Error(`${SECRETS_KEY_ENV} must be 32 bytes in base64 (openssl rand -base64 32).`);
  return k;
}

export function secretsConfigured(): boolean {
  const v = process.env[SECRETS_KEY_ENV];
  return !!v && Buffer.from(v, "base64").length === 32;
}

/** iv (12) | tag (16) | ciphertext, in base64. */
export function seal(value: unknown): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

export function unseal<T>(sealed: string): T {
  const b = Buffer.from(sealed, "base64");
  const d = createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8")) as T;
}
