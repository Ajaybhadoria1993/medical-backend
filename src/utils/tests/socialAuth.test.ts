import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import {
  verifyGoogleIdToken,
  verifyAppleIdToken,
  _resetJwkCacheForTesting,
} from '../socialAuth';
import { HttpError } from '../../middlewear/errorHandler';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('socialAuth unit tests', () => {
  const originalEnv = process.env;

  // Generate a real RSA key pair for testing genuine JWT signing and verification
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });

  const jwkPublicKey = publicKey.export({ format: 'jwk' });
  const kid = 'test-key-id-1';

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    _resetJwkCacheForTesting();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('verifyGoogleIdToken', () => {
    beforeEach(() => {
      process.env.GOOGLE_CLIENT_ID = 'google-web-client-id';
      process.env.GOOGLE_CLIENT_ID_IOS = 'google-ios-client-id';
      process.env.GOOGLE_CLIENT_ID_ANDRIOD = 'google-android-client-id';
    });

    it('should successfully verify a valid Google token', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        headers: { 'cache-control': 'public, max-age=3600' },
        data: {
          keys: [
            {
              ...jwkPublicKey,
              kid,
              alg: 'RS256',
              use: 'sig',
            },
          ],
        },
      } as any);

      const token = jwt.sign(
        {
          sub: 'google-user-123',
          email: 'doctor@google.com',
          email_verified: true,
          name: 'Dr. Google',
          picture: 'https://avatar.url/pic.jpg',
        },
        privateKey,
        {
          algorithm: 'RS256',
          keyid: kid,
          issuer: 'https://accounts.google.com',
          audience: 'google-web-client-id',
          expiresIn: '1h',
        }
      );

      const result = await verifyGoogleIdToken(token, 'web');

      expect(result).toEqual({
        provider: 'google',
        providerId: 'google-user-123',
        email: 'doctor@google.com',
        name: 'Dr. Google',
        picture: 'https://avatar.url/pic.jpg',
      });
    });

    it('should throw 500 when Google social login is not configured', async () => {
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_ID_IOS;
      delete process.env.GOOGLE_CLIENT_ID_ANDRIOD;
      delete process.env.GOOGLE_CLIENT_IDS;

      await expect(verifyGoogleIdToken('any-token', 'web')).rejects.toThrow(
        new HttpError(500, 'Google social login is not configured')
      );
    });

    it('should throw 401 when token has no kid header', async () => {
      const token = jwt.sign({ sub: '123' }, 'secret');
      await expect(verifyGoogleIdToken(token, 'web')).rejects.toThrow(
        new HttpError(401, 'Invalid Google token')
      );
    });

    it('should throw 401 when email is not verified', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        headers: {},
        data: {
          keys: [{ ...jwkPublicKey, kid, alg: 'RS256', use: 'sig' }],
        },
      } as any);

      const token = jwt.sign(
        {
          sub: 'google-user-123',
          email: 'unverified@google.com',
          email_verified: false,
        },
        privateKey,
        {
          algorithm: 'RS256',
          keyid: kid,
          issuer: 'https://accounts.google.com',
          audience: 'google-web-client-id',
          expiresIn: '1h',
        }
      );

      await expect(verifyGoogleIdToken(token, 'web')).rejects.toThrow(
        new HttpError(401, 'Google account email is not verified')
      );
    });
  });

  describe('verifyAppleIdToken', () => {
    beforeEach(() => {
      process.env.APPLE_CLIENT_ID_IOS = 'com.infinity.medisetu';
      process.env.APPLE_CLIENT_ID_WEB = 'com.infinity.medisetu.web';
      process.env.APPLE_CLIENT_ID_ANDROID = 'com.infinity.medisetu.android';
    });

    it('should successfully verify a valid Apple token on iOS', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        headers: { 'cache-control': 'public, max-age=86400' },
        data: {
          keys: [
            {
              ...jwkPublicKey,
              kid,
              alg: 'RS256',
              use: 'sig',
              kty: 'RSA',
            },
          ],
        },
      } as any);

      const token = jwt.sign(
        {
          sub: '001490.15518c200f0f416f8efed4e7599e7ca1.0614',
          email: 'igtechso30@icloud.com',
          email_verified: true,
          auth_time: Math.floor(Date.now() / 1000),
        },
        privateKey,
        {
          algorithm: 'RS256',
          keyid: kid,
          issuer: 'https://appleid.apple.com',
          audience: 'com.infinity.medisetu',
          expiresIn: '1h',
        }
      );

      const result = await verifyAppleIdToken(
        token,
        'ios',
        'Dr. Apple Practitioner'
      );

      expect(result).toEqual({
        provider: 'apple',
        providerId: '001490.15518c200f0f416f8efed4e7599e7ca1.0614',
        email: 'igtechso30@icloud.com',
        name: 'Dr. Apple Practitioner',
      });
    });

    it('should support string email_verified: "true" and email prefix name fallback', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        headers: {},
        data: {
          keys: [
            {
              ...jwkPublicKey,
              kid,
              alg: 'RS256',
              use: 'sig',
              kty: 'RSA',
            },
          ],
        },
      } as any);

      const token = jwt.sign(
        {
          sub: 'apple-user-999',
          email: 'doctor.smith@privaterelay.appleid.com',
          email_verified: 'true',
        },
        privateKey,
        {
          algorithm: 'RS256',
          keyid: kid,
          issuer: 'https://appleid.apple.com',
          audience: 'com.infinity.medisetu.web',
          expiresIn: '1h',
        }
      );

      const result = await verifyAppleIdToken(token, 'web');

      expect(result).toEqual({
        provider: 'apple',
        providerId: 'apple-user-999',
        email: 'doctor.smith@privaterelay.appleid.com',
        name: 'doctor.smith',
      });
    });

    it('should throw 500 when Apple client ID is not configured', async () => {
      delete process.env.APPLE_CLIENT_ID_IOS;
      delete process.env.APPLE_CLIENT_ID_WEB;
      delete process.env.APPLE_CLIENT_ID_ANDROID;
      delete process.env.APPLE_CLIENT_ID_ANDRIOD;
      delete process.env.APPLE_CLIENT_IDS;
      delete process.env.APPLE_CLIENT_ID;

      await expect(verifyAppleIdToken('any-token', 'ios')).rejects.toThrow(
        new HttpError(500, 'Apple social login is not configured')
      );
    });

    it('should throw 401 when token has no kid', async () => {
      const token = jwt.sign({ sub: '123' }, 'secret');
      await expect(verifyAppleIdToken(token, 'ios')).rejects.toThrow(
        new HttpError(401, 'Invalid Apple token')
      );
    });

    it('should throw 401 when Apple JWKS does not contain matching kid', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        headers: {},
        data: {
          keys: [
            {
              ...jwkPublicKey,
              kid: 'different-key-id',
              alg: 'RS256',
              use: 'sig',
              kty: 'RSA',
            },
          ],
        },
      } as any);

      const token = jwt.sign({ sub: 'user-1' }, privateKey, {
        algorithm: 'RS256',
        keyid: 'missing-key-id',
        issuer: 'https://appleid.apple.com',
        audience: 'com.infinity.medisetu',
      });

      await expect(verifyAppleIdToken(token, 'ios')).rejects.toThrow(
        new HttpError(401, 'Invalid Apple token')
      );
    });

    it('should throw 401 when token signature or issuer is invalid', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        headers: {},
        data: {
          keys: [
            {
              ...jwkPublicKey,
              kid,
              alg: 'RS256',
              use: 'sig',
              kty: 'RSA',
            },
          ],
        },
      } as any);

      // Wrong issuer
      const token = jwt.sign(
        { sub: 'user-1', email: 'doc@apple.com', email_verified: true },
        privateKey,
        {
          algorithm: 'RS256',
          keyid: kid,
          issuer: 'https://invalid-issuer.com',
          audience: 'com.infinity.medisetu',
        }
      );

      await expect(verifyAppleIdToken(token, 'ios')).rejects.toThrow(
        new HttpError(401, 'Invalid Apple token')
      );
    });

    it('should throw 401 when email is present but unverified', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        headers: {},
        data: {
          keys: [
            {
              ...jwkPublicKey,
              kid,
              alg: 'RS256',
              use: 'sig',
              kty: 'RSA',
            },
          ],
        },
      } as any);

      const token = jwt.sign(
        {
          sub: 'user-1',
          email: 'doc@apple.com',
          email_verified: false,
        },
        privateKey,
        {
          algorithm: 'RS256',
          keyid: kid,
          issuer: 'https://appleid.apple.com',
          audience: 'com.infinity.medisetu',
        }
      );

      await expect(verifyAppleIdToken(token, 'ios')).rejects.toThrow(
        new HttpError(401, 'Apple account email is not verified')
      );
    });

    it('should reuse cached public keys without fetching JWKS again', async () => {
      mockedAxios.get.mockResolvedValue({
        headers: { 'cache-control': 'max-age=3600' },
        data: {
          keys: [
            {
              ...jwkPublicKey,
              kid,
              alg: 'RS256',
              use: 'sig',
              kty: 'RSA',
            },
          ],
        },
      } as any);

      const token = jwt.sign(
        {
          sub: 'apple-user-cached',
          email: 'cached@apple.com',
          email_verified: true,
        },
        privateKey,
        {
          algorithm: 'RS256',
          keyid: kid,
          issuer: 'https://appleid.apple.com',
          audience: 'com.infinity.medisetu',
        }
      );

      await verifyAppleIdToken(token, 'ios');
      await verifyAppleIdToken(token, 'ios');

      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });
  });
});
