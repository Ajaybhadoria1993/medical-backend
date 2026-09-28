import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import { requireAuth } from '../../../middlewear/auth.middleware';
import { envConfig } from '../../../utils/envConfig';
import { hashPassword, hashToken } from '../../../utils/authUtils';

const JWT_SECRET = envConfig.JWT_SECRET_KEY || 'secret_key';

jest.mock('../../mfa/services/mfa.service', () => ({
  MfaService: {
    isMfaEnabled: jest.fn(),
  },
}));

jest.mock('../../notifications/services/loginAlertQueue.service', () => ({
  loginAlertQueue: {
    addLoginAlert: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../../configurations/dbConnection', () => ({
  database: {
    select: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    insert: jest.fn(),
    transaction: jest.fn(),
  },
}));

jest.mock('../../../configurations/redisConfig', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
  },
}));

jest.mock('../services/token.service', () => ({
  TokenService: {
    issueTokenPair: jest.fn(),
    rotateRefreshToken: jest.fn(),
    revokeToken: jest.fn(),
    revokeAllForUser: jest.fn(),
  },
}));

import { UserService } from '../services/user.service';
import { TokenService } from '../services/token.service';

function createMockReq(
  token?: string,
  path = '/api/v1/users'
): Partial<Request> {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    method: 'GET',
    originalUrl: path,
    user: undefined as any,
  };
}

function createMockRes(): Partial<Response> {
  return {};
}

function invokeMiddleware(
  middleware: any,
  req: Request,
  res: Response
): Promise<any> {
  return new Promise((resolve, reject) => {
    const next: NextFunction = (err?: any) => {
      if (err) {
        reject(err);
      } else {
        resolve(undefined);
      }
    };
    middleware(req, res, next);
  });
}

describe('Multi-Device Password Change & Invalidation Tests', () => {
  const userId = 'user-12345';
  const mockUserRow = {
    id: userId,
    email: 'doctor@example.com',
    userType: 'Doctor',
    userStatus: 'Active',
    emailVerifiedAt: new Date(),
    isAdminDoctorAccess: false,
    isArchive: false,
    isUserBlocked: false,
    passwordChangedAt: new Date(1700000500 * 1000), // 1700000500 in seconds
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('requireAuth middleware password change invalidation', () => {
    it('should reject requests with token issued BEFORE password was changed (other device)', async () => {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const pwdChangedSeconds = nowSeconds - 60; // changed 60s ago
      const oldTokenIat = nowSeconds - 300; // issued 300s ago

      const oldTokenDeviceB = jwt.sign(
        { sub: userId, iat: oldTokenIat, exp: nowSeconds + 3600 },
        JWT_SECRET
      );

      (redisClient.get as jest.Mock).mockImplementation(async (key: string) => {
        if (key === `user:${userId}`) {
          return JSON.stringify(mockUserRow);
        }
        if (key === `user:password_changed_at:${userId}`) {
          return String(pwdChangedSeconds);
        }
        return null; // Not in allowed_token whitelist
      });

      const req = createMockReq(oldTokenDeviceB) as Request;
      const res = createMockRes() as Response;

      await expect(
        invokeMiddleware(requireAuth, req, res)
      ).rejects.toMatchObject({
        status: 401,
        message: 'Session expired. Password was changed, please log in again.',
      });
    });

    it('should accept newly issued tokens (iat >= passwordChangedAt) on the active device', async () => {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const pwdChangedSeconds = nowSeconds - 60; // changed 60s ago
      const newTokenIat = nowSeconds; // issued now

      const newTokenDeviceA = jwt.sign(
        { sub: userId, iat: newTokenIat, exp: nowSeconds + 3600 },
        JWT_SECRET
      );

      (redisClient.get as jest.Mock).mockImplementation(async (key: string) => {
        if (key === `user:${userId}`) {
          return JSON.stringify(mockUserRow);
        }
        if (key === `user:password_changed_at:${userId}`) {
          return String(pwdChangedSeconds);
        }
        return null;
      });

      const req = createMockReq(newTokenDeviceA) as Request;
      const res = createMockRes() as Response;

      await invokeMiddleware(requireAuth, req, res);

      expect(req.user).toBeDefined();
      expect(req.user.id).toBe(userId);
      expect(req.user.email).toBe('doctor@example.com');
    });

    it('should accept whitelisted initiating device token during grace period', async () => {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const pwdChangedSeconds = nowSeconds - 60;
      const oldTokenIat = nowSeconds - 300;

      const oldTokenDeviceA = jwt.sign(
        { sub: userId, iat: oldTokenIat, exp: nowSeconds + 3600 },
        JWT_SECRET
      );
      const tokenHash = hashToken(oldTokenDeviceA);

      (redisClient.get as jest.Mock).mockImplementation(async (key: string) => {
        if (key === `user:${userId}`) {
          return JSON.stringify(mockUserRow);
        }
        if (key === `user:password_changed_at:${userId}`) {
          return String(pwdChangedSeconds);
        }
        if (key === `session:allowed_token:${userId}:${tokenHash}`) {
          return 'true';
        }
        return null;
      });

      const req = createMockReq(oldTokenDeviceA) as Request;
      const res = createMockRes() as Response;

      await invokeMiddleware(requireAuth, req, res);

      expect(req.user).toBeDefined();
      expect(req.user.id).toBe(userId);
    });
  });

  describe('UserService.changePassword', () => {
    it('should update passwordChangedAt, invalidate Redis, revoke other device sessions and return new tokens', async () => {
      const currentPassword = 'OldPassword123!';
      const newPassword = 'NewPassword123!';
      const currentHashed = await hashPassword(currentPassword);

      (database.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([
              {
                id: userId,
                password: currentHashed,
                socialProvider: null,
                userStatus: 'Active',
              },
            ]),
          }),
        }),
      });

      (database.update as jest.Mock).mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([{ id: userId }]),
        }),
      });

      (TokenService.issueTokenPair as jest.Mock).mockResolvedValue({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });

      const result = await UserService.changePassword(
        userId,
        currentPassword,
        newPassword,
        {
          currentToken: 'old-token-device-a',
          ipAddress: '127.0.0.1',
          userAgent: 'Mozilla/5.0',
        }
      );

      // Verify DB update was called
      expect(database.update).toHaveBeenCalled();

      // Verify Redis cache was invalidated and password changed timestamp was set
      expect(redisClient.del).toHaveBeenCalledWith(`user:${userId}`);
      expect(redisClient.setex).toHaveBeenCalledWith(
        `user:password_changed_at:${userId}`,
        86400 * 30,
        expect.any(String)
      );

      // Verify old token was whitelisted for the initiating device
      const oldTokenHash = hashToken('old-token-device-a');
      expect(redisClient.setex).toHaveBeenCalledWith(
        `session:allowed_token:${userId}:${oldTokenHash}`,
        300,
        'true'
      );

      // Verify all old sessions were revoked across other devices
      expect(TokenService.revokeAllForUser).toHaveBeenCalledWith(userId);

      // Verify fresh token pair was issued and returned for initiating device
      expect(TokenService.issueTokenPair).toHaveBeenCalledWith(userId, {
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0',
        platform: 'web',
      });
      expect(result).toEqual({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });
    });

    it('should allow a social-login user without an existing password to set one with only newPassword', async () => {
      const newPassword = 'NewPassword123!';

      (database.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([
              {
                id: userId,
                password: null,
                socialProvider: 'google',
                userStatus: 'Active',
              },
            ]),
          }),
        }),
      });

      (database.update as jest.Mock).mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([{ id: userId }]),
        }),
      });

      (TokenService.issueTokenPair as jest.Mock).mockResolvedValue({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });

      const result = await UserService.changePassword(
        userId,
        undefined,
        newPassword,
        {
          currentToken: 'old-token-device-a',
          ipAddress: '127.0.0.1',
          userAgent: 'Mozilla/5.0',
        }
      );

      expect(database.update).toHaveBeenCalled();
      expect(redisClient.del).toHaveBeenCalledWith(`user:${userId}`);
      expect(TokenService.revokeAllForUser).toHaveBeenCalledWith(userId);
      expect(TokenService.issueTokenPair).toHaveBeenCalledWith(userId, {
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0',
        platform: 'web',
      });
      expect(result).toEqual({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });
    });
  });

  describe('UserService.resetPassword', () => {
    it('should update passwordChangedAt, revoke other devices, and return new token pair', async () => {
      const resetToken = 'valid-reset-token';
      const resetTokenHash = hashToken(resetToken);
      const newPassword = 'ResetPassword123!';

      // Mock TokenModel lookup
      (database.select as jest.Mock)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([
                {
                  id: 'token-uuid',
                  userId,
                  tokenHash: resetTokenHash,
                  type: 'password_reset',
                  used: false,
                  expiresAt: new Date(Date.now() + 3600000),
                },
              ]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([
                {
                  id: userId,
                  name: 'Dr. Test',
                  email: 'doctor@example.com',
                  userType: 'Doctor',
                },
              ]),
            }),
          }),
        });

      (database.update as jest.Mock).mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([{ id: userId }]),
        }),
      });

      (database.delete as jest.Mock).mockReturnValue({
        where: jest.fn().mockResolvedValue([{ id: 'token-uuid' }]),
      });

      (TokenService.issueTokenPair as jest.Mock).mockResolvedValue({
        accessToken: 'reset-access-token',
        refreshToken: 'reset-refresh-token',
      });

      const result = await UserService.resetPassword(resetToken, newPassword, {
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0',
      });

      expect(database.update).toHaveBeenCalled();
      expect(database.delete).toHaveBeenCalled();
      expect(redisClient.del).toHaveBeenCalledWith(`user:${userId}`);
      expect(redisClient.setex).toHaveBeenCalledWith(
        `user:password_changed_at:${userId}`,
        86400 * 30,
        expect.any(String)
      );
      expect(TokenService.revokeAllForUser).toHaveBeenCalledWith(userId);
      expect(TokenService.issueTokenPair).toHaveBeenCalledWith(userId, {
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0',
        platform: 'web',
      });
      expect(result).toMatchObject({
        message: 'Password reset successful',
        accessToken: 'reset-access-token',
        refreshToken: 'reset-refresh-token',
        token: 'reset-access-token',
      });
    });
  });
});
