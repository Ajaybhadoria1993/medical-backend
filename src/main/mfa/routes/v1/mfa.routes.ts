import { Router } from 'express';
import {
  enableMfaController,
  verifyEnrollmentController,
  verifyLoginController,
  recoveryLoginController,
  disableMfaController,
  regenerateRecoveryController,
  getMfaStatusController,
} from '../../controllers/mfa.controller';
import {
  verifyEnrollmentSchema,
  verifyLoginSchema,
  recoveryLoginSchema,
  disableMfaSchema,
  regenerateRecoverySchema,
} from '../../schemas/mfa.schemas';
import { validate } from '../../../../middlewear/validation.middleware';
import { requireAuth } from '../../../../middlewear/auth.middleware';
import { requireMfaToken } from '../../../../middlewear/mfaAuth.middleware';

const mfaRouter = Router();

/**
 * @route POST /api/v1/mfa/enable
 * @desc Initiate MFA enrollment for the authenticated user
 * @access Private (requireAuth)
 */
mfaRouter.post('/enable', requireAuth, enableMfaController);

/**
 * @route POST /api/v1/mfa/verify-enrollment
 * @desc Verify TOTP code to complete MFA enrollment
 * @access Private (requireAuth)
 */
mfaRouter.post(
  '/verify-enrollment',
  requireAuth,
  validate(verifyEnrollmentSchema, 'body'),
  verifyEnrollmentController
);

/**
 * @route POST /api/v1/mfa/verify-login
 * @desc Verify TOTP code during login (requires temporary MFA token)
 * @access Private (requireMfaToken)
 */
mfaRouter.post(
  '/verify-login',
  requireMfaToken,
  validate(verifyLoginSchema, 'body'),
  verifyLoginController
);

/**
 * @route POST /api/v1/mfa/recovery-login
 * @desc Use a recovery code during login (requires temporary MFA token)
 * @access Private (requireMfaToken)
 */
mfaRouter.post(
  '/recovery-login',
  requireMfaToken,
  validate(recoveryLoginSchema, 'body'),
  recoveryLoginController
);

/**
 * @route POST /api/v1/mfa/disable
 * @desc Disable MFA for the authenticated user (requires password)
 * @access Private (requireAuth)
 */
mfaRouter.post(
  '/disable',
  requireAuth,
  validate(disableMfaSchema, 'body'),
  disableMfaController
);

/**
 * @route POST /api/v1/mfa/regenerate-recovery
 * @desc Regenerate recovery codes (requires TOTP verification)
 * @access Private (requireAuth)
 */
mfaRouter.post(
  '/regenerate-recovery',
  requireAuth,
  validate(regenerateRecoverySchema, 'body'),
  regenerateRecoveryController
);

/**
 * @route GET /api/v1/mfa/status
 * @desc Get current MFA status for the authenticated user
 * @access Private (requireAuth)
 */
mfaRouter.get('/status', requireAuth, getMfaStatusController);

export default mfaRouter;
