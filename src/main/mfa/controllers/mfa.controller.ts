import { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import { MfaService } from '../services/mfa.service';
import { database } from '../../../configurations/dbConnection';
import { TokenService } from '../../users/services/token.service';
import { UserModel } from '../../users/models/user.model';
import type {
  VerifyEnrollmentDto,
  VerifyLoginDto,
  RecoveryLoginDto,
  DisableMfaDto,
  RegenerateRecoveryDto,
} from '../schemas/mfa.schemas';

/**
 * POST /api/v1/mfa/enable
 * Initiates MFA enrollment for the authenticated user.
 * Returns the otpauth URI and base32 secret for authenticator app setup.
 */
export const enableMfaController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) throw new HttpError(401, 'Authentication required');

    const result = await MfaService.initEnrollment(userId);

    res.json({
      success: true,
      message:
        'MFA enrollment initiated. Scan the QR code with your authenticator app.',
      data: result,
    });
  }
);

/**
 * POST /api/v1/mfa/verify-enrollment
 * Verifies the TOTP code to complete MFA enrollment.
 * Returns recovery codes on success.
 */
export const verifyEnrollmentController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) throw new HttpError(401, 'Authentication required');

    const { totpCode } = req.validatedBody as VerifyEnrollmentDto;

    const result = await MfaService.verifyEnrollment(userId, totpCode);

    res.json({
      success: true,
      message: result.message,
      data: {
        recoveryCodes: result.recoveryCodes,
      },
    });
  }
);

/**
 * POST /api/v1/mfa/verify-login
 * Verifies the TOTP code during login (requires temporary MFA token).
 * On success, issues a full-access JWT session token.
 */
export const verifyLoginController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) throw new HttpError(401, 'Authentication required');

    const { totpCode } = req.validatedBody as VerifyLoginDto;

    const isValid = await MfaService.verifyLoginCode(userId, totpCode);

    if (!isValid) {
      throw new HttpError(401, 'Invalid verification code');
    }

    // Fetch user data for the response (same shape as normal login)
    const [user] = await database
      .select({
        id: UserModel.id,
        name: UserModel.name,
        email: UserModel.email,
        userStatus: UserModel.userStatus,
        emailVerifiedAt: UserModel.emailVerifiedAt,
        userType: UserModel.userType,
      })
      .from(UserModel)
      .where(eq(UserModel.id, userId))
      .limit(1);

    // Issue full access/refresh token pair, ending any other active session
    const tokens = await TokenService.issueTokenPair(userId, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      message: 'MFA verification successful.',
      user: user ? { ...user, password: null } : null,
      ...tokens,
    });
  }
);

/**
 * POST /api/v1/mfa/recovery-login
 * Uses a recovery code during login (requires temporary MFA token).
 * On success, issues a full-access JWT session token.
 */
export const recoveryLoginController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) throw new HttpError(401, 'Authentication required');

    const { recoveryCode } = req.validatedBody as RecoveryLoginDto;

    const result = await MfaService.verifyRecoveryCodeLogin(
      userId,
      recoveryCode
    );

    // Fetch user data for the response (same shape as normal login)
    const [user] = await database
      .select({
        id: UserModel.id,
        name: UserModel.name,
        email: UserModel.email,
        userStatus: UserModel.userStatus,
        emailVerifiedAt: UserModel.emailVerifiedAt,
        userType: UserModel.userType,
      })
      .from(UserModel)
      .where(eq(UserModel.id, userId))
      .limit(1);

    // Issue full access/refresh token pair, ending any other active session
    const tokens = await TokenService.issueTokenPair(userId, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      message: 'Recovery code verified successfully.',
      user: user ? { ...user, password: null } : null,
      ...tokens,
      data: {
        remainingCodes: result.remainingCodes,
        warning: result.warning,
      },
    });
  }
);

/**
 * POST /api/v1/mfa/disable
 * Disables MFA for the authenticated user (requires password confirmation).
 */
export const disableMfaController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) throw new HttpError(401, 'Authentication required');

    const { password } = req.validatedBody as DisableMfaDto;

    await MfaService.disableMfa(userId, password);

    res.json({
      success: true,
      message: 'MFA has been disabled on your account.',
    });
  }
);

/**
 * POST /api/v1/mfa/regenerate-recovery
 * Regenerates recovery codes for the authenticated user (requires TOTP verification).
 */
export const regenerateRecoveryController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) throw new HttpError(401, 'Authentication required');

    const { totpCode } = req.validatedBody as RegenerateRecoveryDto;

    const recoveryCodes = await MfaService.regenerateRecoveryCodes(
      userId,
      totpCode
    );

    res.json({
      success: true,
      message: 'Recovery codes regenerated successfully.',
      data: {
        recoveryCodes,
      },
    });
  }
);

/**
 * GET /api/v1/mfa/status
 * Returns the current MFA status for the authenticated user.
 */
export const getMfaStatusController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) throw new HttpError(401, 'Authentication required');

    const status = await MfaService.getMfaStatus(userId);

    res.json({
      success: true,
      data: status,
    });
  }
);
