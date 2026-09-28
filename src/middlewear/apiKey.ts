import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { envConfig } from '../utils/envConfig';

// Simple API key record
interface ApiKeyRecord {
  key: string;
}

// In-memory store; replace with persistent storage for production
const apiKeys: ApiKeyRecord[] = [{ key: envConfig.THIRD_PARTY_API_KEY! }];

/**
 * Generate and store a new API key.
 */
export function generateApiKey(): ApiKeyRecord {
  const key = crypto.randomBytes(16).toString('hex');
  const record: ApiKeyRecord = { key };
  apiKeys.push(record); // Persist to DB in production
  return record;
}

/**
 * Middleware to validate API key existence.
 */

export const apiKeyAuth = (req: Request, res: Response, next: NextFunction) => {
  try {
    const providedKey = req.header('x-api-key');
    if (!providedKey) {
      return res.status(401).json({ message: 'API key missing' });
    }

    const valid = apiKeys.some((r) => r.key === providedKey);
    if (!valid) {
      return res.status(403).json({ message: 'Invalid API key' });
    }

    // Attach key info for downstream handlers
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).apiKey = providedKey;
    return next();
  } catch (error) {
    return next(error);
  }
};
