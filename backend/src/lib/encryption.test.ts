import { describe, expect, it } from 'vitest';
import { decryptField, encryptField } from './encryption';

describe('encryption (person_sss/gsis/philhealth at rest)', () => {
  it('round-trips a value', () => {
    const blob = encryptField('34-1234567-8', 'test-secret-key');
    expect(decryptField(blob, 'test-secret-key')).toBe('34-1234567-8');
  });

  it('ciphertext never contains the plaintext, in any encoding', () => {
    const plaintext = 'SSS-NUMBER-SECRET-98765';
    const blob = encryptField(plaintext, 'test-secret-key');
    expect(blob.toString('utf8')).not.toContain(plaintext);
    expect(blob.toString('base64')).not.toContain(plaintext);
    expect(blob.toString('hex')).not.toContain(Buffer.from(plaintext).toString('hex'));
  });

  it('fails closed with the wrong key -- authenticated encryption, not just obfuscation', () => {
    const blob = encryptField('34-1234567-8', 'correct-key');
    expect(() => decryptField(blob, 'wrong-key')).toThrow();
  });

  it('fails closed if the ciphertext is tampered with', () => {
    const blob = encryptField('34-1234567-8', 'test-secret-key');
    const tampered = Buffer.from(blob);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff;
    expect(() => decryptField(tampered, 'test-secret-key')).toThrow();
  });

  it('two encryptions of the same plaintext produce different ciphertext (random IV, not deterministic)', () => {
    const a = encryptField('same-value', 'test-secret-key');
    const b = encryptField('same-value', 'test-secret-key');
    expect(a.equals(b)).toBe(false);
    expect(decryptField(a, 'test-secret-key')).toBe(decryptField(b, 'test-secret-key'));
  });
});
