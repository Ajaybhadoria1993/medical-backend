import express from 'express';
import {
  requireAuth,
  requireClinic,
  requirePatient,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import { docsRegistry } from '../../../../utils/docsRegistry';
import {
  downloadDocumentController,
  signDocumentController,
  signPatientDocumentController,
} from '../../controllers/files.controller';
import {
  downloadDocumentQuerySchema,
  signDocumentQuerySchema,
  signPatientDocumentQuerySchema,
} from '../../schemas/files.schema';

const filesRouter = express.Router();

/**
 * @route GET /api/v1/files/sign/patient
 * @desc Short-lived signed URL for a document the patient themselves owns
 * @access Private (Patient)
 */
filesRouter.get(
  '/sign/patient',
  requireAuth,
  // Patients hold no clinic assignment, so ownership is the patient id itself.
  requirePatient,
  validate(signPatientDocumentQuerySchema, 'query'),
  signPatientDocumentController
);

/**
 * @route GET /api/v1/files/sign
 * @desc Short-lived signed URL for a document the caller's clinic owns
 * @access Private
 */
filesRouter.get(
  '/sign',
  requireAuth,
  // Sets req.clinicId, which is the whole ownership check. requireAuth does not.
  requireClinic,
  validate(signDocumentQuerySchema, 'query'),
  signDocumentController
);

/** GET /api/v1/files/download — the file itself, as an attachment, for a clinic-owned document. */
filesRouter.get(
  '/download',
  requireAuth,
  requireClinic,
  validate(downloadDocumentQuerySchema, 'query'),
  downloadDocumentController
);

export default filesRouter;

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/files/sign',
  description:
    'Returns a 5-minute signed URL for a document owned by the caller clinic',
  query: signDocumentQuerySchema,
  tags: ['files'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/files/download',
  description:
    'Returns the document itself as an attachment, for a clinic-owned document the browser must save',
  query: downloadDocumentQuerySchema,
  tags: ['files'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/files/sign/patient',
  description:
    'Returns a 5-minute signed URL for a document owned by the patient or a family member they manage',
  query: signPatientDocumentQuerySchema,
  tags: ['files'],
});
