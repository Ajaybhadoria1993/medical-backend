import crypto from 'crypto';
import bcrypt from 'bcryptjs';

const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_LENGTH = 8;
const BCRYPT_COST_FACTOR = 10;

// Alphanumeric character set for recovery codes
const ALPHANUMERIC_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Generates a set of cryptographically random recovery codes.
 * Each code is 8 alphanumeric characters. Returns exactly 10 codes.
 */
export function generateRecoveryCodes(): string[] {
  const codes: string[] = [];

  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const bytes = crypto.randomBytes(RECOVERY_CODE_LENGTH);
    let code = '';
    for (let j = 0; j < RECOVERY_CODE_LENGTH; j++) {
      code += ALPHANUMERIC_CHARS[bytes[j] % ALPHANUMERIC_CHARS.length];
    }
    codes.push(code);
  }

  return codes;
}

/**
 * Hashes a recovery code using bcrypt with cost factor 10.
 * Used before storing recovery codes in the database.
 */
export async function hashRecoveryCode(code: string): Promise<string> {
  return bcrypt.hash(code, BCRYPT_COST_FACTOR);
}

/**
 * Verifies a plaintext recovery code against a bcrypt hash.
 * Returns true if the code matches the hash.
 */
export async function verifyRecoveryCode(
  code: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(code, hash);
}
