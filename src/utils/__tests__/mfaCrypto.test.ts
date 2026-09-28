import { encrypt, decrypt } from '../mfaCrypto';

// Use a valid 32-byte hex key for testing
const TEST_KEY = 'a'.repeat(64); // 64 hex chars = 32 bytes

describe('MFA Crypto Utility', () => {
  beforeEach(() => {
    process.env.MFA_ENCRYPTION_KEY = TEST_KEY;
  });

  afterEach(() => {
    delete process.env.MFA_ENCRYPTION_KEY;
  });

  describe('encrypt', () => {
    it('should return a string in the format iv:ciphertext:authTag', () => {
      const result = encrypt('test-secret');
      const parts = result.split(':');
      expect(parts).toHaveLength(3);

      // IV should be 12 bytes = 24 hex chars
      expect(parts[0]).toHaveLength(24);
      // Auth tag should be 16 bytes = 32 hex chars
      expect(parts[2]).toHaveLength(32);
    });

    it('should produce different ciphertexts for the same plaintext (random IV)', () => {
      const result1 = encrypt('same-secret');
      const result2 = encrypt('same-secret');
      expect(result1).not.toEqual(result2);
    });

    it('should throw an error when MFA_ENCRYPTION_KEY is not set', () => {
      delete process.env.MFA_ENCRYPTION_KEY;
      expect(() => encrypt('test')).toThrow(
        'MFA_ENCRYPTION_KEY environment variable is not set'
      );
    });

    it('should throw an error when MFA_ENCRYPTION_KEY has invalid length', () => {
      process.env.MFA_ENCRYPTION_KEY = 'abcd'; // too short
      expect(() => encrypt('test')).toThrow(
        'must be exactly 64 hex characters'
      );
    });

    it('should throw an error when MFA_ENCRYPTION_KEY contains non-hex characters', () => {
      process.env.MFA_ENCRYPTION_KEY = 'g'.repeat(64); // invalid hex
      expect(() => encrypt('test')).toThrow(
        'must be a valid hexadecimal string'
      );
    });
  });

  describe('decrypt', () => {
    it('should correctly decrypt an encrypted string', () => {
      const plaintext = 'my-totp-secret-base32';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should handle empty strings', () => {
      const plaintext = '';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should handle unicode characters', () => {
      const plaintext = 'secret-with-émojis-🔐';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should throw on invalid format (missing parts)', () => {
      expect(() => decrypt('invalid-data')).toThrow(
        'Invalid encrypted data format'
      );
    });

    it('should throw on invalid format (too many parts)', () => {
      expect(() => decrypt('a:b:c:d')).toThrow('Invalid encrypted data format');
    });

    it('should throw on tampered ciphertext', () => {
      const encrypted = encrypt('test-secret');
      const parts = encrypted.split(':');
      // Tamper with the ciphertext
      parts[1] = 'ff'.repeat(parts[1].length / 2);
      const tampered = parts.join(':');
      expect(() => decrypt(tampered)).toThrow('Decryption failed');
    });

    it('should throw on tampered auth tag', () => {
      const encrypted = encrypt('test-secret');
      const parts = encrypted.split(':');
      // Tamper with the auth tag
      parts[2] = '00'.repeat(16);
      const tampered = parts.join(':');
      expect(() => decrypt(tampered)).toThrow('Decryption failed');
    });

    it('should throw on invalid IV length', () => {
      const encrypted = encrypt('test-secret');
      const parts = encrypted.split(':');
      // Replace IV with wrong length
      parts[0] = 'aa'; // 1 byte instead of 12
      const tampered = parts.join(':');
      expect(() => decrypt(tampered)).toThrow('Invalid IV length');
    });

    it('should throw when MFA_ENCRYPTION_KEY is not set', () => {
      delete process.env.MFA_ENCRYPTION_KEY;
      expect(() => decrypt('aa:bb:cc')).toThrow(
        'MFA_ENCRYPTION_KEY environment variable is not set'
      );
    });
  });

  describe('encrypt/decrypt round-trip', () => {
    it('should correctly round-trip various string lengths', () => {
      const testCases = [
        'short',
        'a'.repeat(100),
        'JBSWY3DPEHPK3PXP', // typical base32 TOTP secret
        'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', // longer base32 secret
      ];

      for (const plaintext of testCases) {
        const encrypted = encrypt(plaintext);
        const decrypted = decrypt(encrypted);
        expect(decrypted).toBe(plaintext);
      }
    });
  });
});
