// src/main/users/services/token.service.ts
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import {
  hashToken,
  signJwt,
  signRefreshToken,
  verifyRefreshToken,
  type Platform,
} from '../../../utils/authUtils';
import { RefreshTokenModel } from '../models/refreshToken.model';

export type { Platform };

export interface TokenRequestMeta {
  userAgent?: string;
  ipAddress?: string;
  platform?: Platform;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

function expiryFromNow(): Date {
  const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, mirrors REFRESH_TOKEN_EXPIRES_IN default
  return new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
}

/** One `refresh_tokens` row per device: logging in on a new device never ends another's session. */
export class TokenService {
  static async issueTokenPair(
    userId: string,
    meta?: TokenRequestMeta
  ): Promise<TokenPair> {
    const platform: Platform = meta?.platform ?? 'web';
    const jti = randomUUID();
    const accessToken = signJwt({ sub: userId });
    const refreshToken = signRefreshToken(userId, jti, platform);

    await database.insert(RefreshTokenModel).values({
      id: jti,
      userId,
      platform,
      tokenHash: hashToken(refreshToken),
      expiresAt: expiryFromNow(),
      userAgent: meta?.userAgent,
      ipAddress: meta?.ipAddress,
    });

    return { accessToken, refreshToken };
  }

  static async rotateRefreshToken(
    rawRefreshToken: string,
    meta?: TokenRequestMeta
  ): Promise<TokenPair> {
    let payload: { sub: string; jti: string; platform: Platform };
    try {
      payload = verifyRefreshToken(rawRefreshToken);
    } catch {
      throw new HttpError(401, 'Session expired, please login again.');
    }

    const [row] = await database
      .select()
      .from(RefreshTokenModel)
      .where(eq(RefreshTokenModel.id, payload.jti))
      .limit(1);

    if (!row || row.tokenHash !== hashToken(rawRefreshToken)) {
      // Unknown/rotated token: end only this device's session, never the user's other devices.
      await database
        .delete(RefreshTokenModel)
        .where(eq(RefreshTokenModel.id, payload.jti));
      throw new HttpError(401, 'Session expired, please login again.');
    }

    await database
      .delete(RefreshTokenModel)
      .where(eq(RefreshTokenModel.id, payload.jti));

    return TokenService.issueTokenPair(payload.sub, {
      ...meta,
      platform: payload.platform,
    });
  }

  static async revokeToken(rawRefreshToken: string): Promise<void> {
    let payload: { sub: string; jti: string };
    try {
      payload = verifyRefreshToken(rawRefreshToken);
    } catch {
      return; // already invalid/expired — nothing to revoke
    }

    // Logout only ends this device's session.
    await database
      .delete(RefreshTokenModel)
      .where(eq(RefreshTokenModel.id, payload.jti));
  }

  /** Kills every session across all platforms — password change, account compromise, etc. */
  static async revokeAllForUser(userId: string): Promise<void> {
    await database
      .delete(RefreshTokenModel)
      .where(eq(RefreshTokenModel.userId, userId));
  }
}
