import express from 'express';
import {
  cancelScanSession,
  createScanSession,
  getScanStatus,
  uploadScanViaOtp,
} from '../../controllers/scan.bridge.controller';
import {
  CLINIC_STAFF_ROLES,
  requireAuth,
  requireClinic,
  requireRole,
} from '../../../../middlewear/auth.middleware';

const prescriptionRouter = express.Router();

prescriptionRouter.post(
  '/scan/session',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  createScanSession
);

/** @route DELETE /api/v1/prescription/scan/session?otp= — the computer closed the scan
 *  @access any clinic user (same guard as creating one) */
prescriptionRouter.delete(
  '/scan/session',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  cancelScanSession
);

prescriptionRouter.post(
  '/scan/upload',
  // No login on the phone: the one-time OTP is the credential, checked in the controller.
  uploadScanViaOtp,
  express.json({ limit: '12mb' })
);

prescriptionRouter.get(
  '/scan/status',
  // Polled by the logged-out phone too; OTP-gated like /scan/upload.
  getScanStatus
);

export default prescriptionRouter;
