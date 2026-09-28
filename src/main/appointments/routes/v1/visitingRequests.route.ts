// src/main/appointments/routes/v1/visitingRequests.route.ts
import express from 'express';

import {
  requireAuth,
  requireReceptionist,
  requireClinic,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  getAllVisitingRequestController,
  getRelatedAppointmentController,
  cancelVisitingRequestController,
  findVisitingRequestController,
} from '../../controllers/visitingRequest.controller';
import {
  getAllVisitingRequestQuerySchema,
  getRelatedAppointmentParamsSchema,
  cancelVisitingRequestParamsSchema,
  findVisitingRequestQuerySchema,
} from '../../schemas/visitingRequest.schemas';
import { docsRegistry } from '../../../../utils/docsRegistry';

const visitingRequestsRouter = express.Router();

/**
 * @route GET /api/v1/appointments/visiting-requests/get-all-visiting-request
 * @desc Get all doctor-suggested visiting requests for the clinic, grouped
 *       by doctor+patient, with a status stat card (total/pending/scheduled/
 *       cancelled/doctorPatientRelationsCount) computed over the full
 *       filtered set. Optional filters: doctorId, status (Pending/Scheduled/
 *       Cancelled, single or array), requestedDate range (startDate/endDate),
 *       and search (doctor or patient name)
 * @access Private (Admin, Doctor, Receptionist, Lab_Assistant)
 */
visitingRequestsRouter.get(
  '/get-all-visiting-request',
  requireAuth,
  requireReceptionist,
  requireClinic,
  validate(getAllVisitingRequestQuerySchema, 'query'),
  getAllVisitingRequestController
);

/**
 * @route GET /api/v1/appointments/visiting-requests/get-related-appointment/:appointmentId
 * @desc Given a source or generated appointmentId, return the rest of its
 *       linked visiting-request appointment family
 * @access Private (Admin, Doctor, Receptionist, Lab_Assistant)
 */
visitingRequestsRouter.get(
  '/get-related-appointment/:appointmentId',
  requireAuth,
  requireReceptionist,
  requireClinic,
  validate(getRelatedAppointmentParamsSchema, 'params'),
  getRelatedAppointmentController
);

/**
 * @route PATCH /api/v1/appointments/visiting-requests/cancel/:id
 * @desc Cancel a Pending visiting request. Admin/Receptionist/Lab_Assistant
 *       can cancel any request for a doctor in their own clinic; a Doctor
 *       can only cancel their own.
 * @access Private (Admin, Doctor, Receptionist, Lab_Assistant)
 */
visitingRequestsRouter.patch(
  '/cancel/:id',
  requireAuth,
  requireReceptionist,
  requireClinic,
  validate(cancelVisitingRequestParamsSchema, 'params'),
  cancelVisitingRequestController
);

/**
 * @route GET /api/v1/appointments/visiting-requests/find-visiting-request
 * @desc Look up whether a visiting request already exists for a given
 *       doctor + patient + calendar day. Returns { visitingRequestId,
 *       mainPrescriptionPdf } — both null when there's no match.
 * @access Private (Admin, Doctor, Receptionist, Lab_Assistant)
 */
visitingRequestsRouter.get(
  '/find-visiting-request',
  requireAuth,
  requireReceptionist,
  requireClinic,
  validate(findVisitingRequestQuerySchema, 'query'),
  findVisitingRequestController
);

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/appointments/visiting-requests/get-all-visiting-request',
  description:
    'Get all visiting requests for the clinic, grouped by doctor+patient, with a status stat card (optional doctorId, status, startDate, endDate, search-by-name filters)',
  query: getAllVisitingRequestQuerySchema,
  tags: ['appointments', 'visiting-requests'],
});
docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/appointments/visiting-requests/get-related-appointment/:appointmentId',
  description:
    'Get appointments linked to the given appointmentId via visiting requests',
  params: getRelatedAppointmentParamsSchema,
  tags: ['appointments', 'visiting-requests'],
});
docsRegistry.addEndpoint({
  method: 'patch',
  path: '/api/v1/appointments/visiting-requests/cancel/:id',
  description:
    'Cancel a pending visiting request (Doctor: own only; Admin/Receptionist/Lab_Assistant: any in their clinic)',
  params: cancelVisitingRequestParamsSchema,
  tags: ['appointments', 'visiting-requests'],
});
docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/appointments/visiting-requests/find-visiting-request',
  description:
    'Look up an existing visiting request by doctorId, patientId and requestedDate — returns its id and source prescription PDF if found',
  query: findVisitingRequestQuerySchema,
  tags: ['appointments', 'visiting-requests'],
});

export default visitingRequestsRouter;
