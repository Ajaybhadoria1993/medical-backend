/* eslint-disable @typescript-eslint/no-explicit-any */
// Who is calling: token verification and account checks. Runs first on every protected route.
import { eq } from 'drizzle-orm';
import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { database } from '../../configurations/dbConnection';
import redisClient from '../../configurations/redisConfig';
import { enforceSupportSession } from '../../main/supportAccess';
import { UserModel } from '../../main/users/models/user.model';
import { CacheKeys } from '../../utils/cache.util';
import {
  hashToken,
  toCachedUser,
  tokensValidAfterKey,
} from '../../utils/authUtils';
import { envConfig } from '../../utils/envConfig';
import { asyncHandler, HttpError } from '../errorHandler';
import type { JwtPayload } from './types';

const JWT_SECRET = envConfig.JWT_SECRET_KEY || 'change-me';
const USER_CACHE_TTL_SECS = 600;
const PWD_CHANGED_CACHE_TTL_SECS = 86400 * 30;

/** Statuses that may not use the API. 'Pending' is allowed so onboarding can finish. */
const INACTIVE_STATUSES = new Set([
  'Inactive',
  'Reviewing',
  'Blocked',
  'Rejected',
]);

function getTokenFromHeader(req: Request): string | null {
  const auth = req.headers['authorization'] || req.headers['Authorization'];
  if (!auth) return null;
  const parts = String(auth).split(' ');
  if (parts.length === 2 && /^Bearer$/i.test(parts[0])) return parts[1];
  return null;
}

function verifyToken(token: string): JwtPayload {
  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    // Library error text stays server-side (BACKEND_STANDARDS §6).
    throw new HttpError(401, 'Invalid or expired token');
  }
  if (!payload?.sub) throw new HttpError(401, 'Invalid token payload');
  return payload;
}

/** Redis first, DB on a miss; only the fields the guards read are cached (no password hash). */
async function loadUser(
  userId: string,
  cachedUser: string | null
): Promise<any> {
  if (cachedUser) return JSON.parse(cachedUser);

  const [dbUser] = await database
    .select()
    .from(UserModel)
    .where(eq(UserModel.id, userId))
    .limit(1);
  if (!dbUser) throw new HttpError(401, 'User not found');

  const userRow = toCachedUser(dbUser);
  await redisClient.setex(
    `user:${userId}`,
    USER_CACHE_TTL_SECS,
    JSON.stringify(userRow)
  );
  return userRow;
}

/** Rejects tokens issued before the last password change, except the device that changed it. */
async function assertTokenNewerThanPasswordChange(
  token: string,
  payload: JwtPayload,
  userRow: any,
  cachedPwdChanged: string | null
): Promise<void> {
  if (!payload.iat) return;

  let pwdChangedRaw = cachedPwdChanged;
  if (pwdChangedRaw === null && userRow.passwordChangedAt) {
    pwdChangedRaw = String(
      Math.floor(new Date(userRow.passwordChangedAt).getTime() / 1000)
    );
    await redisClient.setex(
      `user:password_changed_at:${payload.sub}`,
      PWD_CHANGED_CACHE_TTL_SECS,
      pwdChangedRaw
    );
  }
  if (!pwdChangedRaw || payload.iat >= Number(pwdChangedRaw)) return;

  const isAllowed = await redisClient.get(
    `session:allowed_token:${payload.sub}:${hashToken(token)}`
  );
  if (!isAllowed) {
    throw new HttpError(
      401,
      'Session expired. Password was changed, please log in again.'
    );
  }
}

/** Rejects tokens issued before revokeUserTokens() last ran for this user. */
function assertNotRevoked(
  payload: JwtPayload,
  tokensValidAfter: string | null
): void {
  if (!tokensValidAfter || !payload.iat) return;
  if (payload.iat < Number(tokensValidAfter)) {
    throw new HttpError(401, 'Session expired, please log in again.');
  }
}

function assertAccountActive(userRow: any): void {
  if (userRow.isArchive) {
    throw new HttpError(
      403,
      'Your account has been deactivated. Please contact your clinic administrator.'
    );
  }
  if (userRow.isUserBlocked) {
    throw new HttpError(403, 'Your account has been blocked.');
  }
  if (INACTIVE_STATUSES.has(userRow.userStatus)) {
    throw new HttpError(403, 'Your account is not active.');
  }
}

/** Verifies the bearer token, loads the user and attaches the minimal `req.user`. */
export const requireAuth = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const token = getTokenFromHeader(req);
    if (!token) throw new HttpError(401, 'Authorization token missing');

    const payload = verifyToken(token);

    // One round trip for every key the checks read.
    const [cachedUser, cachedPwdChanged, tokensValidAfter, supportActor] =
      await redisClient.mget(
        `user:${payload.sub}`,
        `user:password_changed_at:${payload.sub}`,
        tokensValidAfterKey(payload.sub),
        CacheKeys.supportSession(payload.sup ?? '-')
      );
    assertNotRevoked(payload, tokensValidAfter);
    // Ending a session deletes its marker, so the token stops working before it expires.
    if (payload.sup && supportActor !== payload.act) {
      throw new HttpError(401, 'This support view has ended.');
    }
    const userRow = await loadUser(payload.sub, cachedUser);

    await assertTokenNewerThanPasswordChange(
      token,
      payload,
      userRow,
      cachedPwdChanged
    );
    assertAccountActive(userRow);

    req.user = {
      id: userRow.id,
      email: userRow.email,
      userType: userRow.userType,
      emailVerifiedAt: userRow.emailVerifiedAt
        ? String(userRow.emailVerifiedAt)
        : null,
      userStatus: userRow.userStatus,
      isAdminDoctorAccess: userRow.isAdminDoctorAccess,
    };
    if (payload.sup && payload.act) {
      req.supportSession = { id: payload.sup, actorId: payload.act };
      enforceSupportSession(req, res, payload.sup);
    }
    return next();
  }
);

export const requireEmailVerified = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) throw new HttpError(401, 'Authentication required');
    if (!user.emailVerifiedAt) throw new HttpError(403, 'Email not verified');
    return next();
  }
);
