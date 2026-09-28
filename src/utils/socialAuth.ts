import crypto from 'crypto';
import axios from 'axios';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { HttpError } from '../middlewear/errorHandler';

type GoogleJwk = JsonWebKey & {
  kid: string;
  alg: string;
  use: string;
};

type GoogleJwksResponse = {
  keys: GoogleJwk[];
};

type GoogleIdTokenPayload = JwtPayload & {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

type AppleJwk = JsonWebKey & {
  kid: string;
  alg: string;
  use: string;
  kty: string;
  n: string;
  e: string;
};

type AppleJwksResponse = {
  keys: AppleJwk[];
};

type AppleIdTokenPayload = JwtPayload & {
  sub?: string;
  email?: string;
  email_verified?: boolean | string;
  is_private_email?: boolean | string;
  name?: string;
};

export type VerifiedSocialProfile = {
  provider: 'google' | 'apple';
  providerId: string;
  email: string;
  name: string;
  picture?: string;
};

type JwkCache = {
  keys: Record<string, crypto.KeyObject>;
  expiresAt: number;
};

let googleJwkCache: JwkCache | null = null;
let appleJwkCache: JwkCache | null = null;

export function _resetJwkCacheForTesting() {
  googleJwkCache = null;
  appleJwkCache = null;
}

export type DeviceType = 'web' | 'ios' | 'android';

function getGoogleClientIdForDevice(device: DeviceType): string {
  switch (device) {
    case 'ios':
      return process.env.GOOGLE_CLIENT_ID_IOS || '';
    case 'android':
      return process.env.GOOGLE_CLIENT_ID_ANDRIOD || '';
    case 'web':
    default:
      return process.env.GOOGLE_CLIENT_ID || '';
  }
}

function getGoogleClientIds(device: DeviceType = 'web') {
  // Primary: use the device-specific client ID
  const deviceClientId = getGoogleClientIdForDevice(device);
  if (deviceClientId) return [deviceClientId];

  // Fallback: comma-separated list or default web client ID
  return (process.env.GOOGLE_CLIENT_IDS || process.env.GOOGLE_CLIENT_ID || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

async function getGooglePublicKey(kid: string) {
  const now = Date.now();

  if (googleJwkCache && googleJwkCache.expiresAt > now) {
    const cachedKey = googleJwkCache.keys[kid];
    if (cachedKey) return cachedKey;
  }

  const response = await axios.get<GoogleJwksResponse>(
    'https://www.googleapis.com/oauth2/v3/certs'
  );

  const cacheControl = response.headers['cache-control'];
  const maxAgeMatch =
    typeof cacheControl === 'string'
      ? cacheControl.match(/max-age=(\d+)/)
      : null;
  const maxAgeSeconds = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;

  googleJwkCache = {
    keys: response.data.keys.reduce<Record<string, crypto.KeyObject>>(
      (acc, key) => {
        acc[key.kid] = crypto.createPublicKey({ key, format: 'jwk' });
        return acc;
      },
      {}
    ),
    expiresAt: now + maxAgeSeconds * 1000,
  };

  const publicKey = googleJwkCache.keys[kid];
  if (!publicKey) throw new HttpError(401, 'Invalid Google token');

  return publicKey;
}

export async function verifyGoogleIdToken(
  idToken: string,
  device: DeviceType = 'web'
): Promise<VerifiedSocialProfile> {
  const clientIds = getGoogleClientIds(device);
  if (clientIds.length === 0) {
    throw new HttpError(500, 'Google social login is not configured');
  }
  const audience = clientIds as [string, ...string[]];

  const decoded = jwt.decode(idToken, { complete: true });
  const kid = decoded?.header?.kid;

  if (!kid) throw new HttpError(401, 'Invalid Google token');

  const publicKey = await getGooglePublicKey(kid);

  let payload: GoogleIdTokenPayload;
  try {
    payload = jwt.verify(idToken, publicKey, {
      algorithms: ['RS256'],
      audience,
      issuer: ['https://accounts.google.com', 'accounts.google.com'] as [
        string,
        string,
      ],
    }) as GoogleIdTokenPayload;
  } catch {
    throw new HttpError(401, 'Invalid Google token');
  }

  if (!payload.sub || !payload.email || payload.email_verified !== true) {
    throw new HttpError(401, 'Google account email is not verified');
  }

  return {
    provider: 'google',
    providerId: payload.sub,
    email: payload.email.toLowerCase(),
    name: payload.name || payload.email.split('@')[0],
    picture: payload.picture,
  };
}

function getAppleClientIdForDevice(device: DeviceType): string {
  switch (device) {
    case 'ios':
      return process.env.APPLE_CLIENT_ID_IOS || '';
    case 'android':
      return (
        process.env.APPLE_CLIENT_ID_ANDRIOD ||
        process.env.APPLE_CLIENT_ID_ANDROID ||
        ''
      );
    case 'web':
    default:
      return (
        process.env.APPLE_CLIENT_ID_WEB || process.env.APPLE_CLIENT_ID || ''
      );
  }
}

function getAppleClientIds(device: DeviceType = 'web') {
  const deviceClientId = getAppleClientIdForDevice(device);
  if (deviceClientId) return [deviceClientId];

  return (
    process.env.APPLE_CLIENT_IDS ||
    process.env.APPLE_CLIENT_ID ||
    process.env.APPLE_CLIENT_ID_IOS ||
    process.env.APPLE_CLIENT_ID_WEB ||
    ''
  )
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

async function getApplePublicKey(kid: string) {
  const now = Date.now();

  if (appleJwkCache && appleJwkCache.expiresAt > now) {
    const cachedKey = appleJwkCache.keys[kid];
    if (cachedKey) return cachedKey;
  }

  const response = await axios.get<AppleJwksResponse>(
    'https://appleid.apple.com/auth/keys'
  );

  const cacheControl = response.headers['cache-control'];
  const maxAgeMatch =
    typeof cacheControl === 'string'
      ? cacheControl.match(/max-age=(\d+)/)
      : null;
  const maxAgeSeconds = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600 * 24;

  appleJwkCache = {
    keys: response.data.keys.reduce<Record<string, crypto.KeyObject>>(
      (acc, key) => {
        acc[key.kid] = crypto.createPublicKey({ key, format: 'jwk' });
        return acc;
      },
      {}
    ),
    expiresAt: now + maxAgeSeconds * 1000,
  };

  const publicKey = appleJwkCache.keys[kid];
  if (!publicKey) throw new HttpError(401, 'Invalid Apple token');

  return publicKey;
}

export async function verifyAppleIdToken(
  idToken: string,
  device: DeviceType = 'web',
  clientName?: string
): Promise<VerifiedSocialProfile> {
  const clientIds = getAppleClientIds(device);
  if (clientIds.length === 0) {
    throw new HttpError(500, 'Apple social login is not configured');
  }
  const audience = clientIds as [string, ...string[]];

  const decoded = jwt.decode(idToken, { complete: true });
  const kid = decoded?.header?.kid;

  if (!kid) throw new HttpError(401, 'Invalid Apple token');

  const publicKey = await getApplePublicKey(kid);

  let payload: AppleIdTokenPayload;
  try {
    payload = jwt.verify(idToken, publicKey, {
      algorithms: ['RS256'],
      audience,
      issuer: 'https://appleid.apple.com',
    }) as AppleIdTokenPayload;
  } catch {
    throw new HttpError(401, 'Invalid Apple token');
  }

  if (!payload.sub) {
    throw new HttpError(401, 'Invalid Apple token: missing user identifier');
  }

  const isEmailVerified =
    payload.email_verified === true || payload.email_verified === 'true';

  if (payload.email && !isEmailVerified) {
    throw new HttpError(401, 'Apple account email is not verified');
  }

  const email = payload.email ? payload.email.toLowerCase() : '';
  const resolvedName =
    clientName?.trim() ||
    payload.name ||
    (email ? email.split('@')[0] : 'Apple User');

  return {
    provider: 'apple',
    providerId: payload.sub,
    email,
    name: resolvedName,
  };
}
