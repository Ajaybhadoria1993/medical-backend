import express from 'express';
import {
  requireAuth,
  requireClinic,
  requireRole,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import { docsRegistry } from '../../../../apiDocs';
import {
  getCommissionOverviewController,
  getDoctorAppointmentsController,
} from '../../controllers/patientCommission.controller';
import {
  doctorAppointmentsQuerySchema,
  doctorParamSchema,
  periodQuerySchema,
} from '../../schemas/patientCommission.schema';

// Mounted at /api/v1/patient-commission; the clinic always comes from the token.
const patientCommissionRouter = express.Router();

/** @route GET /api/v1/patient-commission/overview — the per-patient bill for a period, one line per doctor
 *  @access Admin (every doctor of the clinic), Doctor (own line only) */
patientCommissionRouter.get(
  '/overview',
  requireAuth,
  requireRole(['Admin', 'Doctor']),
  requireClinic,
  validate(periodQuerySchema, 'query'),
  getCommissionOverviewController
);

/** @route GET /api/v1/patient-commission/doctors/:doctorId/appointments — the appointments billed for one doctor
 *  @access Admin (any doctor of the clinic), Doctor (own appointments only) */
patientCommissionRouter.get(
  '/doctors/:doctorId/appointments',
  requireAuth,
  requireRole(['Admin', 'Doctor']),
  requireClinic,
  validate(doctorParamSchema, 'params'),
  validate(doctorAppointmentsQuerySchema, 'query'),
  getDoctorAppointmentsController
);

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/patient-commission/overview',
  description: 'Per-patient bill for a period, one line per doctor',
  query: periodQuerySchema,
  tags: ['patient-commission'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/patient-commission/doctors/:doctorId/appointments',
  description: "One doctor's billed appointments for a period",
  params: doctorParamSchema,
  query: doctorAppointmentsQuerySchema,
  tags: ['patient-commission'],
});

export default patientCommissionRouter;
