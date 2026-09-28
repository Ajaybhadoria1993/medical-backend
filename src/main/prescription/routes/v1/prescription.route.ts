import express from 'express';
import {
  getDummyPrescription,
  scanPrescription,
} from '../../controllers/prescription.controller';
import {
  createScanSession,
  getScanStatus,
  uploadScanViaOtp,
} from '../../controllers/scan.bridge.controller';
import {
  requireAuth,
  requireClinic,
  requireDoctor,
} from '../../../../middlewear/auth.middleware';
import { requireFeature } from '../../../../middlewear/limitation.middleware';
import { FEATURE_KEYS } from '../../../subscription/services/limitation.service';
import geminiAutoAlignRouter from '../../services/gemini-auto-align.route';

const prescriptionRouter = express.Router();

prescriptionRouter.get(
  '/dummy',
  requireAuth,
  // requireDoctor,
  getDummyPrescription
);

prescriptionRouter.post(
  '/scan',
  requireAuth,
  requireClinic,
  requireDoctor,
  requireFeature(FEATURE_KEYS.OCR_PRESCRIPTION_SCAN),
  scanPrescription,
  express.json({ limit: '12mb' })
);

prescriptionRouter.post(
  '/scan/session',
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.OCR_PRESCRIPTION_SCAN),
  createScanSession
);

prescriptionRouter.post(
  '/scan/upload',
  // requireAuth,
  // requireDoctor,
  uploadScanViaOtp,
  express.json({ limit: '12mb' })
);

prescriptionRouter.get(
  '/scan/status',
  // requireAuth,
  // requireDoctor,
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
