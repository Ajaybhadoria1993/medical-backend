import express from 'express';
import {
  getDummyPrescription,
  scanPrescription,
} from '../../controllers/prescription.controller';
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
  requireDoctor,
  requireRole,
} from '../../../../middlewear/auth.middleware';
import { requireFeature } from '../../../../middlewear/limitation.middleware';
import { FEATURE_KEYS } from '../../../subscription';
import geminiAutoAlignRouter from '../../services/gemini-auto-align.route';

const prescriptionRouter = express.Router();

prescriptionRouter.get(
  '/dummy',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  // requireDoctor,
  getDummyPrescription
);

prescriptionRouter.post(
  '/scan',
  requireAuth,
  requireClinic,
  requireDoctor,
  scanPrescription,
  express.json({ limit: '12mb' })
);

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

prescriptionRouter.use(
  '/auto-align',
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.OCR_PRESCRIPTION_SCAN),
  geminiAutoAlignRouter,
  express.json({ limit: '12mb' })
);

export default prescriptionRouter;
