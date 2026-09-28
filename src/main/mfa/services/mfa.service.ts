import { eq, and, sql } from 'drizzle-orm';
import { generateSecret, generateURI, verify as otplibVerify } from 'otplib';
import bcrypt from 'bcryptjs';
import { database } from '../../../configurations/dbConnection';
import { UserMfaModel } from '../models/mfa.model';
import { UserMfaRecoveryCodeModel } from '../models/recoveryCode.model';
import { UserModel } from '../../users/models/user.model';
import { encrypt, decrypt } from '../../../utils/mfaCrypto';
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  verifyRecoveryCode,
} from './recoveryCode.utils';
import {
  checkRateLimit,
  incrementFailedAttempts,
  resetRateLimit,
} from './mfaRateLimit.service';
import redisClient from '../../../configurations/redisConfig';
import { HttpError } from '../../../middlewear/errorHandler';
import logger from '../../../utils/logger';

const MFA_PENDING_PREFIX = 'mfa:pending';
const MFA_PENDING_TTL_SECONDS = 600; // 10 minutes
const MFA_ISSUER = 'Infinity Medisetu';
const MFA_DISABLE_RATE_PREFIX = 'mfa:disable_rate';
const MFA_DISABLE_RATE_MAX_ATTEMPTS = 5;
const MFA_DISABLE_RATE_WINDOW_SECONDS = 900; // 15 minutes

export interface EnrollmentResponse {
  otpauthUri: string;
  base32Secret: string;
}

export interface ActivationResponse {
  recoveryCodes: string[];
  message: string;
}

export interface MfaStatusResponse {
  mfaEnabled: boolean;
  recoveryCodesRemaining: number;
  lastModifiedAt: string | null; // ISO date string
}

export interface RecoveryVerifyResponse {
  success: boolean;
  remainingCodes: number;
  warning?: string;
}

export class MfaService {
  /**
   * Checks whether MFA is currently enabled (active) for a given user.
   * Used by the login flow to determine whether to issue a full-access JWT
   * or a limited-scope temporary token requiring MFA verification.
   */
  static async isMfaEnabled(userId: string): Promise<boolean> {
    const [record] = await database
      .select({ id: UserMfaModel.id })
      .from(UserMfaModel)
      .where(
        and(eq(UserMfaModel.userId, userId), eq(UserMfaModel.isActive, true))
      )
      .limit(1);

    return !!record;
  }

  /**
   * Initiates MFA enrollment for a user.
   * Generates a cryptographically random TOTP secret (>= 160 bits / 20 bytes),
   * encrypts it with AES-256-GCM, stores it in the user_mfa table as pending,
   * and sets a Redis expiry key for 10-minute timeout tracking.
   *
   * @param userId - The ID of the user initiating enrollment
   * @returns The otpauth:// URI and base32-encoded secret for authenticator app setup
   * @throws HttpError 409 if MFA is already active for the user
   * @throws HttpError 500 if secret generation or encryption fails
   */
  static async initEnrollment(userId: string): Promise<EnrollmentResponse> {
    // Check if MFA is already active for this user
    const isActive = await MfaService.isMfaEnabled(userId);
    if (isActive) {
      throw new HttpError(409, 'MFA is already enabled on this account');
    }

    // Get user's email for the otpauth URI
    const [user] = await database
      .select({ email: UserModel.email })
      .from(UserModel)
      .where(eq(UserModel.id, userId))
      .limit(1);

    if (!user) {
      throw new HttpError(400, 'User not found');
    }

    // Generate cryptographically random secret (>= 160 bits / 20 bytes)
    // otplib's generateSecret() generates a 20-byte random secret by default
    const base32Secret = generateSecret({ length: 20 });

    // Encrypt the secret for storage
    let encryptedSecret: string;
    try {
      encryptedSecret = encrypt(base32Secret);
    } catch (error) {
      logger.error('[MFA Enrollment] Encryption failed:', error);
      throw new HttpError(500, 'MFA enrollment could not be completed');
    }

    // Invalidate any previous pending enrollment and upsert the new one
    const [existingRecord] = await database
      .select({ id: UserMfaModel.id })
      .from(UserMfaModel)
      .where(eq(UserMfaModel.userId, userId))
      .limit(1);

    if (existingRecord) {
      // Update existing record (overwrite previous pending enrollment)
      await database
        .update(UserMfaModel)
        .set({
          encryptedSecret,
          isActive: false,
          isPending: true,
          enabledAt: null,
          lastModifiedAt: new Date(),
        })
        .where(eq(UserMfaModel.userId, userId));
    } else {
      // Insert new pending enrollment record
      await database.insert(UserMfaModel).values({
        userId,
        encryptedSecret,
        isActive: false,
        isPending: true,
      });
    }

    // Set Redis key for pending enrollment expiry tracking (600s TTL)
    try {
      await redisClient.set(
        `${MFA_PENDING_PREFIX}:${userId}`,
        '1',
        'EX',
        MFA_PENDING_TTL_SECONDS
      );
    } catch (error) {
      logger.error('[MFA Enrollment] Redis error setting pending key:', error);
      // Non-fatal: enrollment can still proceed, expiry will be checked lazily
    }

    // Generate the otpauth:// URI
    const otpauthUri = generateURI({
      issuer: MFA_ISSUER,
      label: user.email ?? '',
      secret: base32Secret,
    });

    return {
      otpauthUri,
      base32Secret,
    };
  }

  /**
   * Verifies a TOTP code against the user's pending MFA secret to complete enrollment.
   * On success: activates MFA, generates and stores hashed recovery codes, returns plaintext codes.
   * On failure: rejects with error, preserves pending secret for retry.
   *
   * @param userId - The ID of the user verifying enrollment
   * @param totpCode - The 6-digit TOTP code from the user's authenticator app
   * @returns ActivationResponse with recovery codes and success message
   * @throws HttpError 400 if no pending enrollment exists
   * @throws HttpError 401 if the TOTP code is invalid
   */
  static async verifyEnrollment(
    userId: string,
    totpCode: string
  ): Promise<ActivationResponse> {
    // Check if the pending enrollment has expired via Redis key (lazy cleanup)
    try {
      const pendingKey = `${MFA_PENDING_PREFIX}:${userId}`;
      const pendingExists = await redisClient.exists(pendingKey);

      if (!pendingExists) {
        // Redis key expired — the 10-minute enrollment window has passed
        // Clean up the stale pending record from the database
        await database
          .delete(UserMfaModel)
          .where(
            and(
              eq(UserMfaModel.userId, userId),
              eq(UserMfaModel.isPending, true)
            )
          );

        throw new HttpError(
          400,
          'MFA enrollment has expired. Please start a new enrollment.'
        );
      }
    } catch (error) {
      // If it's our own HttpError, re-throw it
      if (error instanceof HttpError) throw error;
      // If Redis is unavailable, skip the expiry check — don't block verification
      logger.error('[MFA Enrollment] Redis error checking pending key:', error);
    }

    // Fetch the pending MFA record for this user
    const [mfaRecord] = await database
      .select({
        id: UserMfaModel.id,
        encryptedSecret: UserMfaModel.encryptedSecret,
        isPending: UserMfaModel.isPending,
        isActive: UserMfaModel.isActive,
      })
      .from(UserMfaModel)
      .where(
        and(eq(UserMfaModel.userId, userId), eq(UserMfaModel.isPending, true))
      )
      .limit(1);

    if (!mfaRecord) {
      throw new HttpError(400, 'No MFA enrollment in progress');
    }

    // Decrypt the stored secret
    const base32Secret = decrypt(mfaRecord.encryptedSecret);

    // Verify the TOTP code with 1-step tolerance window (accepts t-1, t, t+1)
    const verificationResult = await otplibVerify({
      token: totpCode,
      secret: base32Secret,
      strategy: 'totp',
      epochTolerance: 1,
    });

    if (!verificationResult.valid) {
      throw new HttpError(401, 'Invalid verification code');
    }

    // Activate MFA: set isActive=true, isPending=false, set enabledAt
    await database
      .update(UserMfaModel)
      .set({
        isActive: true,
        isPending: false,
        enabledAt: new Date(),
        lastModifiedAt: new Date(),
      })
      .where(eq(UserMfaModel.userId, userId));

    // Generate recovery codes
    const recoveryCodes = generateRecoveryCodes();

    // Hash and store recovery codes
    const hashedCodes = await Promise.all(
      recoveryCodes.map((code) => hashRecoveryCode(code))
    );

    // Delete any existing recovery codes for this user (in case of re-enrollment)
    await database
      .delete(UserMfaRecoveryCodeModel)
      .where(eq(UserMfaRecoveryCodeModel.userId, userId));

    // Insert new hashed recovery codes
    await database.insert(UserMfaRecoveryCodeModel).values(
      hashedCodes.map((codeHash) => ({
        userId,
        codeHash,
      }))
    );

    // Clean up the Redis pending key
    try {
      await redisClient.del(`${MFA_PENDING_PREFIX}:${userId}`);
    } catch (error) {
      logger.error('[MFA Enrollment] Redis error deleting pending key:', error);
      // Non-fatal: the key will expire on its own
    }

    return {
      recoveryCodes,
      message: 'MFA has been successfully activated on your account.',
    };
  }

  /**
   * Verifies a TOTP code during login for a user with MFA enabled.
   * Checks rate limit first, then decrypts the active secret and verifies the code.
   *
   * @param userId - The ID of the user attempting MFA login verification
   * @param totpCode - The 6-digit TOTP code from the user's authenticator app
   * @returns true if verification succeeds, false if the code is invalid
   * @throws HttpError 429 if rate limit is exceeded
   * @throws HttpError 400 if no active MFA record exists for the user
   */
  static async verifyLoginCode(
    userId: string,
    totpCode: string
  ): Promise<boolean> {
    // Check rate limit first, reject if exceeded
    const rateLimitResult = await checkRateLimit(userId);
    if (!rateLimitResult.allowed) {
      throw new HttpError(
        429,
        `Too many verification attempts. Try again in ${rateLimitResult.retryAfterSeconds} seconds`
      );
    }

    // Query the user_mfa table for the active record (isActive=true)
    const [mfaRecord] = await database
      .select({
        encryptedSecret: UserMfaModel.encryptedSecret,
      })
      .from(UserMfaModel)
      .where(
        and(eq(UserMfaModel.userId, userId), eq(UserMfaModel.isActive, true))
      )
      .limit(1);

    if (!mfaRecord) {
      throw new HttpError(400, 'MFA is not enabled on this account');
    }

    // Decrypt the active secret
    const base32Secret = decrypt(mfaRecord.encryptedSecret);

    // Verify TOTP with 1-step tolerance window (accepts t-1, t, t+1)
    const verificationResult = await otplibVerify({
      token: totpCode,
      secret: base32Secret,
      strategy: 'totp',
      epochTolerance: 1,
    });

    if (verificationResult.valid) {
      // On success: reset rate limit counter
      await resetRateLimit(userId);
      return true;
    } else {
      // On failure: increment failed attempts
      await incrementFailedAttempts(userId);
      return false;
    }
  }

  /**
   * Disables MFA for a user after verifying their password.
   * Rate limits password attempts using a dedicated Redis key.
   * On success: deletes the user_mfa record, all recovery codes, and invalidates Redis cached user data.
   *
   * @param userId - The ID of the user requesting MFA disable
   * @param password - The user's current password for confirmation
   * @throws HttpError 429 if rate limit is exceeded
   * @throws HttpError 400 if MFA is not enabled on the account
   * @throws HttpError 401 if the password is incorrect
   */
  static async disableMfa(userId: string, password: string): Promise<void> {
    // Check disable rate limit first
    const rateLimitKey = `${MFA_DISABLE_RATE_PREFIX}:${userId}`;
    try {
      const attemptsStr = await redisClient.get(rateLimitKey);
      const attempts = attemptsStr ? parseInt(attemptsStr, 10) : 0;

      if (attempts >= MFA_DISABLE_RATE_MAX_ATTEMPTS) {
        const ttl = await redisClient.ttl(rateLimitKey);
        const retryAfterSeconds =
          ttl > 0 ? ttl : MFA_DISABLE_RATE_WINDOW_SECONDS;
        throw new HttpError(
          429,
          `Too many verification attempts. Try again in ${retryAfterSeconds} seconds`
        );
      }
    } catch (error) {
      if (error instanceof HttpError) throw error;
      // Fail-closed: reject if Redis is unavailable
      logger.error('[MFA Disable] Redis error during rate limit check:', error);
      throw new HttpError(
        429,
        `Too many verification attempts. Try again in ${MFA_DISABLE_RATE_WINDOW_SECONDS} seconds`
      );
    }

    // Check if MFA is enabled for this user
    const isActive = await MfaService.isMfaEnabled(userId);
    if (!isActive) {
      throw new HttpError(400, 'MFA is not enabled on this account');
    }

    // Get user's password hash from the database
    const [user] = await database
      .select({ password: UserModel.password })
      .from(UserModel)
      .where(eq(UserModel.id, userId))
      .limit(1);

    if (!user || !user.password) {
      throw new HttpError(401, 'Invalid credentials');
    }

    // Verify password against stored hash using bcrypt
    const passwordValid = await bcrypt.compare(password, user.password);

    if (!passwordValid) {
      // Increment failed attempts for disable rate limit
      try {
        const newCount = await redisClient.incr(rateLimitKey);
        if (newCount === 1) {
          await redisClient.expire(
            rateLimitKey,
            MFA_DISABLE_RATE_WINDOW_SECONDS
          );
        }
      } catch (error) {
        logger.error(
          '[MFA Disable] Redis error incrementing failed attempts:',
          error
        );
      }
      throw new HttpError(401, 'Invalid credentials');
    }

    // Password verified — delete MFA record and all recovery codes
    await database
      .delete(UserMfaRecoveryCodeModel)
      .where(eq(UserMfaRecoveryCodeModel.userId, userId));

    await database.delete(UserMfaModel).where(eq(UserMfaModel.userId, userId));

    // Invalidate Redis cached user data
    try {
      await redisClient.del(`user:${userId}`);
    } catch (error) {
      logger.error('[MFA Disable] Redis error invalidating user cache:', error);
      // Non-fatal: cache will expire on its own
    }

    // Reset the disable rate limit on success
    try {
      await redisClient.del(rateLimitKey);
    } catch (error) {
      logger.error('[MFA Disable] Redis error resetting rate limit:', error);
      // Non-fatal
    }
  }

  /**
   * Verifies a recovery code during login for a user with MFA enabled.
   * Checks rate limit first (shared with TOTP attempts), then compares
   * against all unused recovery code hashes for the user.
   *
   * @param userId - The ID of the user attempting recovery code login
   * @param recoveryCode - The plaintext recovery code provided by the user
   * @returns RecoveryVerifyResponse with success status, remaining count, and optional warning
   * @throws HttpError 429 if rate limit is exceeded
   * @throws HttpError 401 if no valid recovery code matches
   */
  static async verifyRecoveryCodeLogin(
    userId: string,
    recoveryCode: string
  ): Promise<RecoveryVerifyResponse> {
    // Check rate limit first (shared with TOTP attempts)
    const rateLimitResult = await checkRateLimit(userId);
    if (!rateLimitResult.allowed) {
      throw new HttpError(
        429,
        `Too many verification attempts. Try again in ${rateLimitResult.retryAfterSeconds} seconds`
      );
    }

    // Fetch all unused recovery code hashes for the user
    const unusedCodes = await database
      .select({
        id: UserMfaRecoveryCodeModel.id,
        codeHash: UserMfaRecoveryCodeModel.codeHash,
      })
      .from(UserMfaRecoveryCodeModel)
      .where(
        and(
          eq(UserMfaRecoveryCodeModel.userId, userId),
          eq(UserMfaRecoveryCodeModel.isUsed, false)
        )
      );

    // Compare against all unused recovery code hashes
    let matchedCodeId: string | null = null;
    for (const code of unusedCodes) {
      const isMatch = await verifyRecoveryCode(recoveryCode, code.codeHash);
      if (isMatch) {
        matchedCodeId = code.id;
        break;
      }
    }

    if (!matchedCodeId) {
      // On failure: increment failed attempts, reject
      await incrementFailedAttempts(userId);
      throw new HttpError(401, 'Invalid recovery code');
    }

    // On match: mark code as used, set usedAt
    await database
      .update(UserMfaRecoveryCodeModel)
      .set({
        isUsed: true,
        usedAt: new Date(),
      })
      .where(eq(UserMfaRecoveryCodeModel.id, matchedCodeId));

    // Reset rate limit on successful verification
    await resetRateLimit(userId);

    // Calculate remaining unused codes count (subtract 1 for the code just used)
    const remainingCodes = unusedCodes.length - 1;

    // Build response with optional warning
    const response: RecoveryVerifyResponse = {
      success: true,
      remainingCodes,
    };

    if (remainingCodes === 0) {
      response.warning =
        'No recovery codes remaining. Please regenerate codes immediately.';
    } else if (remainingCodes < 3) {
      response.warning = `Only ${remainingCodes} recovery codes remaining. Please regenerate your codes.`;
    }

    return response;
  }

  /**
   * Regenerates recovery codes for a user with MFA enabled.
   * Requires a valid TOTP code for confirmation.
   * Deletes all existing recovery codes, generates a new set of 10, stores hashed, returns plaintext.
   *
   * @param userId - The ID of the user requesting regeneration
   * @param totpCode - The 6-digit TOTP code for verification
   * @returns Array of 10 new plaintext recovery codes
   * @throws HttpError 400 if MFA is not enabled
   * @throws HttpError 401 if the TOTP code is invalid
   */
  static async regenerateRecoveryCodes(
    userId: string,
    totpCode: string
  ): Promise<string[]> {
    // Check if MFA is active for this user
    const [mfaRecord] = await database
      .select({
        id: UserMfaModel.id,
        encryptedSecret: UserMfaModel.encryptedSecret,
        isActive: UserMfaModel.isActive,
      })
      .from(UserMfaModel)
      .where(
        and(eq(UserMfaModel.userId, userId), eq(UserMfaModel.isActive, true))
      )
      .limit(1);

    if (!mfaRecord) {
      throw new HttpError(400, 'MFA is not enabled on this account');
    }

    // Decrypt the stored secret and verify the TOTP code
    const base32Secret = decrypt(mfaRecord.encryptedSecret);

    const verificationResult = await otplibVerify({
      token: totpCode,
      secret: base32Secret,
      strategy: 'totp',
      epochTolerance: 1,
    });

    if (!verificationResult.valid) {
      throw new HttpError(401, 'Invalid verification code');
    }

    // Delete all existing recovery codes for this user
    await database
      .delete(UserMfaRecoveryCodeModel)
      .where(eq(UserMfaRecoveryCodeModel.userId, userId));

    // Generate new set of 10 recovery codes
    const recoveryCodes = generateRecoveryCodes();

    // Hash and store the new recovery codes
    const hashedCodes = await Promise.all(
      recoveryCodes.map((code) => hashRecoveryCode(code))
    );

    await database.insert(UserMfaRecoveryCodeModel).values(
      hashedCodes.map((codeHash) => ({
        userId,
        codeHash,
      }))
    );

    // Update lastModifiedAt on the user_mfa record
    await database
      .update(UserMfaModel)
      .set({ lastModifiedAt: new Date() })
      .where(eq(UserMfaModel.userId, userId));

    return recoveryCodes;
  }

  /**
   * Returns the current MFA status for a user.
   * Includes whether MFA is enabled, the count of remaining unused recovery codes,
   * and the last modification date of the MFA configuration.
   *
   * @param userId - The ID of the user to query
   * @returns MfaStatusResponse with mfaEnabled, recoveryCodesRemaining, lastModifiedAt
   */
  static async getMfaStatus(userId: string): Promise<MfaStatusResponse> {
    // Query user_mfa table for an active record
    const [mfaRecord] = await database
      .select({
        isActive: UserMfaModel.isActive,
        lastModifiedAt: UserMfaModel.lastModifiedAt,
      })
      .from(UserMfaModel)
      .where(
        and(eq(UserMfaModel.userId, userId), eq(UserMfaModel.isActive, true))
      )
      .limit(1);

    // If no active MFA record exists, return default response
    if (!mfaRecord) {
      return {
        mfaEnabled: false,
        recoveryCodesRemaining: 0,
        lastModifiedAt: null,
      };
    }

    // Count unused recovery codes for this user
    const [countResult] = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(UserMfaRecoveryCodeModel)
      .where(
        and(
          eq(UserMfaRecoveryCodeModel.userId, userId),
          eq(UserMfaRecoveryCodeModel.isUsed, false)
        )
      );

    const recoveryCodesRemaining = countResult?.count ?? 0;

    return {
      mfaEnabled: true,
      recoveryCodesRemaining,
      lastModifiedAt: mfaRecord.lastModifiedAt
        ? mfaRecord.lastModifiedAt.toISOString()
        : null,
    };
  }
}
