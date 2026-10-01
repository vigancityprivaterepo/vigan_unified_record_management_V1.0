import crypto from 'node:crypto';
import { env } from '../env';

// Application-level encryption for person_sss/gsis/philhealth (RA 10173 --
// these must be unreadable via a direct SELECT, key held nowhere in
// Postgres). AES-256-GCM: authenticated, so a wrong key or corrupted
// ciphertext throws instead of silently returning garbage plaintext.
//
// The encryption_key secret is an arbitrary-length passphrase (same
// Docker-secrets pattern as every other secret here), not guaranteed to be
// exactly 32 bytes -- SHA-256 of it gives a deterministic, fixed-size key.
// This is a KDF that's fast to invert if the passphrase is weak, not a
// slow one like scrypt/argon2 -- acceptable here because encryption_key.txt
// is a generated random secret (see docker/secrets/README.md), not a
// human-chosen password.
function deriveKey(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

const IV_LENGTH = 12; // recommended for GCM
const AUTH_TAG_LENGTH = 16;

// Storage format: [iv (12 bytes)][authTag (16 bytes)][ciphertext].
// Self-contained so no separate column/metadata is needed to decrypt.
export function encryptField(plaintext: string, secret: string = env.encryptionKey): Buffer {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

// Throws (does not return garbage) if `secret` is wrong or `blob` was
// tampered with -- GCM's auth tag check fails closed.
export function decryptField(blob: Buffer, secret: string = env.encryptionKey): string {
  const iv = blob.subarray(0, IV_LENGTH);
  const authTag = blob.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = blob.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(secret), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
