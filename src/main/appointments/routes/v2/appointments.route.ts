// src/main/appointments/routes/v2/appointments.route.ts
import express from 'express';
import {
  requireAuth,
  requireClinic,
  requireReceptionist,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import { getAvailableSlotsV2Controller } from '../../controllers/v2/appointment.controller';
import {
  getAvailableSlotsForParamsSchemas,
  getAvailableSlotsV2QuerySchema,
} from '../../schemas/appointment.schemas';

const appointmentsRouterV2 = express.Router();

/**
 * @route GET /api/v2/appointments/doctor/available-slots/:doctorId
 * @desc Simplified slot grid: fixed-step slots from the doctor's weekly
 *       availability minus booked appointments. Does not support
 *       token/queue clinics, per-date overrides, breaks, or
 *       expired-payment-lock filtering — see v1's
 *       `/doctor/available/slot-date-clinic/:doctorId` for that.
 * @access Private (Receptionist, Clinic)
 */
appointmentsRouterV2.get(
  '/doctor/available-slots/:doctorId',
  requireAuth,
  requireReceptionist,
  requireClinic,
  validate(getAvailableSlotsForParamsSchemas, 'params'),
  validate(getAvailableSlotsV2QuerySchema, 'query'),
  getAvailableSlotsV2Controller
);

export default appointmentsRouterV2;
