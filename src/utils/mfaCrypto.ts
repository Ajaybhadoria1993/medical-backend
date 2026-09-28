import crypto from 'crypto';
import logger from './logger';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 12 bytes for GCM recommended IV size
const KEY_LENGTH = 32; // 32 bytes for AES-256

/**
 * Retrieves and validates the MFA encryption key from environment variables.
 * @returns The 32-byte encryption key as a Buffer
 * @throws Error if the key is missing or invalid
 */
function getEncryptionKey(): Buffer {
  const hexKey = process.env.MFA_ENCRYPTION_KEY;

  if (!hexKey) {
    throw new Error(
      'MFA_ENCRYPTION_KEY environment variable is not set. A 32-byte hex-encoded key is required.'
    );
  }

  if (hexKey.length !== KEY_LENGTH * 2) {
    throw new Error(
      `MFA_ENCRYPTION_KEY must be exactly ${KEY_LENGTH * 2} hex characters (${KEY_LENGTH} bytes). Got ${hexKey.length} characters.`
    );
  }

  if (!/^[0-9a-fA-F]+$/.test(hexKey)) {
    throw new Error('MFA_ENCRYPTION_KEY must be a valid hexadecimal string.');
  }

  return Buffer.from(hexKey, 'hex');
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Generates a random 12-byte IV for each encryption operation.
 *
 * @param plaintext - The string to encrypt
 * @returns Encrypted string in format: {iv_hex}:{ciphertext_hex}:{auth_tag_hex}
 * @throws Error if encryption fails or the key is missing/invalid
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${encrypted.toString('hex')}:${authTag.toString('hex')}`;
}

/**
 * Decrypts an AES-256-GCM encrypted string.
 *
 * @param encrypted - The encrypted string in format: {iv_hex}:{ciphertext_hex}:{auth_tag_hex}
 * @returns The decrypted plaintext string
 * @throws Error if decryption fails, the format is invalid, or the key is missing/invalid
 */
export function decrypt(encrypted: string): string {
  const key = getEncryptionKey();

  const parts = encrypted.split(':');
  if (parts.length !== 3) {
    throw new Error(
      'Invalid encrypted data format. Expected format: {iv_hex}:{ciphertext_hex}:{auth_tag_hex}'
    );
  }

  const [ivHex, ciphertextHex, authTagHex] = parts;

  const iv = Buffer.from(ivHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  if (iv.length !== IV_LENGTH) {
    throw new Error(
      `Invalid IV length. Expected ${IV_LENGTH} bytes, got ${iv.length} bytes.`
    );
  }

  if (authTag.length !== 16) {
    throw new Error(
      `Invalid auth tag length. Expected 16 bytes, got ${authTag.length} bytes.`
    );
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch (error) {
    logger.error('[MFA Crypto] Decryption failed:', (error as Error).message);
    throw new Error(
      'Decryption failed. The data may be corrupted or the encryption key may be incorrect.'
    );
  }
}
