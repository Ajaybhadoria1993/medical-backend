import {
  generateRecoveryCodes,
  hashRecoveryCode,
  verifyRecoveryCode,
} from '../services/recoveryCode.utils';

describe('Recovery Code Utilities', () => {
  describe('generateRecoveryCodes', () => {
    it('should generate exactly 10 codes', () => {
      const codes = generateRecoveryCodes();
      expect(codes).toHaveLength(10);
    });

    it('should generate codes of exactly 8 characters each', () => {
      const codes = generateRecoveryCodes();
      for (const code of codes) {
        expect(code).toHaveLength(8);
      }
    });

    it('should generate codes with only alphanumeric characters', () => {
      const codes = generateRecoveryCodes();
      const alphanumericRegex = /^[a-zA-Z0-9]{8}$/;
      for (const code of codes) {
        expect(code).toMatch(alphanumericRegex);
      }
    });

    it('should generate unique codes within a single invocation', () => {
      const codes = generateRecoveryCodes();
      const uniqueCodes = new Set(codes);
      expect(uniqueCodes.size).toBe(10);
    });
  });

  describe('hashRecoveryCode', () => {
    it('should produce a bcrypt hash that does not equal the plaintext', async () => {
      const code = 'AbCd1234';
      const hash = await hashRecoveryCode(code);
      expect(hash).not.toBe(code);
    });

    it('should produce a valid bcrypt hash string', async () => {
      const code = 'TestCode';
      const hash = await hashRecoveryCode(code);
      // bcrypt hashes start with $2a$ or $2b$ and have cost factor
      expect(hash).toMatch(/^\$2[ab]\$10\$/);
    });
  });

  describe('verifyRecoveryCode', () => {
    it('should return true for a matching code and hash', async () => {
      const code = 'AbCd1234';
      const hash = await hashRecoveryCode(code);
      const result = await verifyRecoveryCode(code, hash);
      expect(result).toBe(true);
    });

    it('should return false for a non-matching code', async () => {
      const code = 'AbCd1234';
      const hash = await hashRecoveryCode(code);
      const result = await verifyRecoveryCode('WrongCode', hash);
      expect(result).toBe(false);
    });
  });
});
