import crypto from 'crypto-js';

const SECRET_KEY = 'uhdhdc%##@$$%@GFFjhvbjhvjhvjhHVjvjh@#456';

export class ReferralService {
  // Encode user ID
  static generateReferralCode(userId: string): string {
    try {
      const encrypted = crypto.AES.encrypt(userId, SECRET_KEY).toString();
      return encrypted
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
    } catch {
      throw new Error(`Failed to generate referral code`);
    }
  }

  // Decode to user ID
  static decodeReferralCode(code: string): string {
    try {
      let base64 = code.replace(/-/g, '+').replace(/_/g, '/');

      const padLength = 4 - (base64.length % 4);
      if (padLength < 4) {
        base64 += '='.repeat(padLength);
      }

      const bytes = crypto.AES.decrypt(base64, SECRET_KEY);
      const decodedId = bytes.toString(crypto.enc.Utf8);

      if (!decodedId) {
        throw new Error('Invalid referral code');
      }

      return decodedId;
    } catch {
      throw new Error(`Invalid referral code`);
    }
  }
}
