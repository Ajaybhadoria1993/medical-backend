// src/middleware/socketAuth.ts
import { Socket, ExtendedError } from 'socket.io';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { envConfig } from '../utils/envConfig';
import { database } from '../configurations/dbConnection';
import redisClient from '../configurations/redisConfig';
import { UserModel } from '../main/users/models/user.model';
import { hashToken } from '../utils/authUtils';
import { HttpError } from './errorHandler';

/**
 * Helper: extract token from handshake (auth token or Authorization header)
 */
export function getTokenFromSocket(socket: Socket): string | null {
  // 1️⃣ Check if token is sent in handshake.auth (common in Socket.IO clients)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const auth = (socket.handshake.auth as any) || {};
  if (auth.token) return String(auth.token);

  // 2️⃣ Fallback: check Authorization header
  const authHeader = (socket.handshake.headers?.authorization as string) || '';
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7).trim();

  return null;
}

/**
 * Socket.IO middleware for authentication.
 * Use: io.use(requireSocketAuth);
 */

export async function requireSocketAuth(
  socket: Socket,
  next: (err?: ExtendedError) => void
) {
  try {
    const token = getTokenFromSocket(socket);
    if (!token) {
      const err = new HttpError(
        401,
        'Authorization token missing'
      ) as ExtendedError;
      err.data = { status: 401, message: 'Authorization token missing' };
      return next(err);
    }
    let payload: JwtPayload;
    try {
      payload = jwt.verify(token, envConfig.JWT_SECRET_KEY) as JwtPayload;
    } catch (e: unknown) {
      const err = new HttpError(
        401,
        'Invalid or expired token'
      ) as ExtendedError;
      err.data = {
        status: 401,
        message: 'Invalid or expired token',
        details: String(e),
      };
      return next(err);
    }

    if (!payload?.sub) {
      const err = new HttpError(401, 'Invalid token payload') as ExtendedError;
      err.data = { status: 401, message: 'Invalid token payload' };
      return next(err);
    }

    // Fetch user from DB (Drizzle example; adapt to your DB client)
    const [userRow] = await database
      .select()
      .from(UserModel)
      .where(eq(UserModel.id, payload.sub))
      .limit(1);
    if (!userRow) {
      const err = new HttpError(401, 'User not found') as ExtendedError;
      err.data = { status: 401, message: 'User not found' };
      return next(err);
    }

    // Invalidation check: verify token was not issued before a password change/reset
    if (payload?.iat) {
      const pwdChangedKey = `user:password_changed_at:${payload.sub}`;
      let pwdChangedRaw = await redisClient.get(pwdChangedKey);

      if (pwdChangedRaw === null && userRow.passwordChangedAt) {
        pwdChangedRaw = String(
          Math.floor(new Date(userRow.passwordChangedAt).getTime() / 1000)
        );
        await redisClient.setex(pwdChangedKey, 86400 * 30, pwdChangedRaw);
      }

      if (pwdChangedRaw) {
        const pwdChangedAt = Number(pwdChangedRaw);
        if (payload.iat < pwdChangedAt) {
          const tokenHash = hashToken(token);
          const isAllowed = await redisClient.get(
            `session:allowed_token:${payload.sub}:${tokenHash}`
          );
          if (!isAllowed) {
            const err = new HttpError(
              401,
              'Session expired. Password was changed, please log in again.'
            ) as ExtendedError;
            err.data = {
              status: 401,
              message:
                'Session expired. Password was changed, please log in again.',
            };
            return next(err);
          }
        }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (socket as any).user = userRow;
    // `data` is the only field fetchSockets() returns across nodes; keep it small.
    socket.data.user = {
      id: userRow.id,
      name: userRow.name,
      userType: userRow.userType,
    };

    return next();
  } catch (err) {
    // Unexpected error
    const e = new HttpError(500, 'Authentication error') as ExtendedError;
    e.data = {
      status: 500,
      message: 'Authentication error',
      details: String(err),
    };
    return next(e);
  }
}
