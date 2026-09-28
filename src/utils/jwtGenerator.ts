// src/jwtGenerator.ts
import fs from 'fs/promises';
import jwt from 'jsonwebtoken';
import path from 'path';

const PRIVATE_KEY_PATH = process.env.PRIVATE_KEY_PATH || './private.key';
const PRIVATE_KEY_RAW = process.env.PRIVATE_KEY; // optional
const JWT_EXP_SECONDS = Number(process.env.JWT_EXP_SECONDS || '900'); // 15min
const JWT_KID = process.env.JWT_KID || undefined;

type CacheEntry = { token: string; exp: number };

let cache: CacheEntry | null = null;

async function loadPrivateKey(): Promise<string> {
  if (PRIVATE_KEY_RAW && PRIVATE_KEY_RAW.trim().length > 0) {
    // if env var is set (escaped newlines ok)
    return PRIVATE_KEY_RAW.replace(/\\n/g, '\n');
  }
  const p = path.resolve(PRIVATE_KEY_PATH);
  return fs.readFile(p, 'utf8');
}

/**
 * Generate a new RS256 JWT signed with our private key.
 * Token contains iat and exp claims. Add other claims if needed.
 */
async function generateJwt(): Promise<string> {
  const privateKey = await loadPrivateKey();
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now,
    // Any other claims required by 1mg can be added here:
    // sub, iss, merchantId, jti, etc. Confirm with onboarding docs.
  };

  const signOptions: jwt.SignOptions = {
    algorithm: 'RS256',
    expiresIn: JWT_EXP_SECONDS,
    header: {
      typ: 'JWT',
      alg: 'RS256',
    },
  };

  if (JWT_KID) {
    // set key id header if your onboarding asked to provide kid
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (signOptions.header as any).kid = JWT_KID;
  }

  const token = jwt.sign(payload, privateKey, signOptions);
  return token;
}

/**
 * Get cached JWT. Regenerates if token will expire in less than 60 seconds.
 */
export async function getCachedJwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cache && cache.exp - now > 60) {
    return cache.token;
  }
  const token = await generateJwt();
  // decode to read exp (safe: not verifying signature)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const decoded = jwt.decode(token) as { [k: string]: any } | null;
  const exp = decoded?.exp ?? now + JWT_EXP_SECONDS;
  cache = { token, exp };
  return token;
}

/** Manual cache clear (useful for key rotation) */
export function clearJwtCache() {
  cache = null;
}
