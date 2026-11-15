import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import redisClient from '../../configurations/redisConfig';
import { envConfig } from '../../utils/envConfig';
import { requireAuth } from '../auth.middleware';

const JWT_SECRET = envConfig.JWT_SECRET_KEY || 'change-me';
const USER_ID = 'user-1';

/** Runs requireAuth for a cached user in the given state; resolves on next(), rejects on error. */
function authAs(user: Record<string, unknown>) {
  (redisClient.get as jest.Mock).mockImplementation(async (key: string) =>
    key === `user:${USER_ID}`
      ? JSON.stringify({ id: USER_ID, userType: 'Admin', ...user })
      : null
  );
  const token = jwt.sign({ sub: USER_ID }, JWT_SECRET);
  const req = {
    headers: { authorization: `Bearer ${token}` },
    method: 'GET',
    originalUrl: '/api/v1/x',
  };
  return new Promise<void>((resolve, reject) => {
    requireAuth(
      req as Request,
      {} as Response,
      ((err?: unknown) => (err ? reject(err) : resolve())) as NextFunction
    );
  });
}

describe('requireAuth account status', () => {
  it('lets Active and Pending accounts through', async () => {
    await expect(authAs({ userStatus: 'Active' })).resolves.toBeUndefined();
    await expect(authAs({ userStatus: 'Pending' })).resolves.toBeUndefined();
  });

  it.each(['Inactive', 'Reviewing', 'Blocked', 'Rejected'])(
    'blocks a %s account',
    async (status) => {
      await expect(authAs({ userStatus: status })).rejects.toMatchObject({
        status: 403,
        message: 'Your account is not active.',
      });
    }
  );

  it('rejects a token issued before revokeUserTokens ran, accepts one issued after', async () => {
    const now = Math.floor(Date.now() / 1000);
    const stub = (validAfter: number) =>
      (redisClient.get as jest.Mock).mockImplementation(async (key: string) => {
        if (key === `user:${USER_ID}`)
          return JSON.stringify({ id: USER_ID, userStatus: 'Active' });
        if (key === `user:tokens_valid_after:${USER_ID}`)
          return String(validAfter);
        return null;
      });
    const run = (iat: number) =>
      new Promise<void>((resolve, reject) => {
        const token = jwt.sign({ sub: USER_ID, iat }, JWT_SECRET);
        const req = { headers: { authorization: `Bearer ${token}` } };
        requireAuth(
          req as Request,
          {} as Response,
          ((err?: unknown) => (err ? reject(err) : resolve())) as NextFunction
        );
      });

    stub(now);
    await expect(run(now - 60)).rejects.toMatchObject({ status: 401 });
    await expect(run(now)).resolves.toBeUndefined();
  });

  it('blocks archived and blocked users with their own messages', async () => {
    await expect(
      authAs({ userStatus: 'Active', isArchive: true })
    ).rejects.toMatchObject({
      status: 403,
      message:
        'Your account has been deactivated. Please contact your clinic administrator.',
    });
    await expect(
      authAs({ userStatus: 'Active', isUserBlocked: true })
    ).rejects.toMatchObject({
      status: 403,
      message: 'Your account has been blocked.',
    });
  });
});
