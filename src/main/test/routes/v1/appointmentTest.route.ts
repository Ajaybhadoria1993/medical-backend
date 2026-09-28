// src/main/test/routes/v1/appointmentTest.route.ts
import { Router } from 'express';
import {
  addTestToAppointmentController,
  removeTestFromAppointmentController,
  getTestsByAppointmentIdController,
  getTestsByPatientIdController,
  updateAppointmentTestController,
} from '../../controllers/appointmentTest.controller';
import {
  addTestToAppointmentSchema,
  removeTestFromAppointmentSchema,
  appointmentIdParamSchema,
  patientIdParamSchema,
  updateReportPdfSchema,
} from '../../schemas/appointmentTest.schema';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  requireAuth,
  requireRole,
  requireClinic,
} from '../../../../middlewear/auth.middleware';
import { docsRegistry } from '../../../../utils/docsRegistry';

import { uploadPatientTest } from '../../../../middlewear/upload.middleware';

const appointmentTestRouter = Router();

/**
 * @route POST /api/v1/test/appointment-test/assign
 * @desc Assign a laboratory test to an appointment
 * @access Private (Clinic)
 */

appointmentTestRouter.post(
  '/assign',
  // Auth first: multer writes to S3 as it runs, so anything before it uploads
  // on behalf of a caller who has not been authenticated yet.
  requireAuth,
  requireClinic,
  uploadPatientTest.single('reportPdf'), // Optional PDF file
  validate(addTestToAppointmentSchema, 'body'),
  addTestToAppointmentController
);

/**
 * @route PUT /api/v1/test/appointment-test/report/:appointmentTestId
 * @desc Update a laboratory test report for an appointment
 * @access Private (Admin, Lab Assistant, Doctor, Clinic)
 */
appointmentTestRouter.put(
  '/report/:appointmentTestId',
  requireAuth,
  requireClinic,
  requireRole(['Admin', 'Lab_Assistant', 'Doctor', 'Receptionist']),
  uploadPatientTest.single('reportPdf'),
  validate(updateReportPdfSchema, 'params'),
  updateAppointmentTestController
);

/**
 * @route DELETE /api/v1/test/appointment-test/:id
 * @desc Remove a laboratory test assignment from an appointment
 * @access Private
 */
appointmentTestRouter.delete(
  '/:id',
  validate(removeTestFromAppointmentSchema, 'params'),
  requireAuth,
  removeTestFromAppointmentController
);

/**
 * @route GET /api/v1/test/appointment-test/appointment/:appointmentId
 * @desc Get all laboratory tests assigned to a specific appointment
 * @access Private
 */
appointmentTestRouter.get(
  '/appointment/:appointmentId',
  validate(appointmentIdParamSchema, 'params'),
  requireAuth,
  getTestsByAppointmentIdController
);

/**
 * @route GET /api/v1/test/appointment-test/patient/:patientId
 * @desc Get all laboratory tests assigned to a specific patient
 * @access Private
 */
appointmentTestRouter.get(
  '/patient/:patientId',
  validate(patientIdParamSchema, 'params'),
  requireAuth,
  getTestsByPatientIdController
);
// appointmentTestRouter.get(
//   "/:Id",
//   getAppointmentTestByIdController
// );

export default appointmentTestRouter;

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/test/appointment-test/assign',
  description: 'Assign a test to an appointment',
  requestSchema: addTestToAppointmentSchema,
  tags: ['appointment-test'],
});

docsRegistry.addEndpoint({
  method: 'delete',
  path: '/api/v1/test/appointment-test/:id',
  description: 'Remove a test from an appointment',
  params: removeTestFromAppointmentSchema,
  tags: ['appointment-test'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/test/appointment-test/appointment/:appointmentId',
  description: 'Get tests for an appointment',
  params: appointmentIdParamSchema,
  tags: ['appointment-test'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/test/appointment-test/patient/:patientId',
  description: 'Get tests for a patient',
  params: patientIdParamSchema,
  tags: ['appointment-test'],
});
docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/test/appointment-test/report/:appointmentTestId',
  description: 'add test report',
  params: updateReportPdfSchema,
  tags: ['appointment-test'],
});
