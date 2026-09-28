import { Router } from 'express';

import {
  requireAuth,
  requireClinic,
  requireRole,
  enforceClinicAutoLogout,
} from '../../../../middlewear/auth.middleware';
import {
  validateBody,
  validateQuery,
} from '../../../../middlewear/validateZod';
import {
  getQueueBoardController,
  holdController,
  resumeController,
  sendInController,
  skipController,
} from '../../../appointment-engine/controllers/queue.controller';
import {
  queueActionSchema,
  queueBoardQuerySchema,
  queueBoardResponseSchema,
} from '../../../appointment-engine/schemas/queue.schemas';
import { requirePermission } from '../../../../middlewear/permission.middleware';
import { PERMISSION_KEYS } from '../../../permissions/utils/permission.constants';
import { requireAppointmentScope } from '../../../permissions/middlewares/staffScope.middleware';

/**
 * Doctor queue — live positions for one doctor's day.
 *
 * The **logic** lives in `src/main/appointment-engine/` with the rest of the
 * same-day machinery (delay tracking, live queue, queue tick). This file is
 * only the HTTP surface, and it stays here deliberately: `loadRoutes` derives
 * the mount path from the folder name, so moving it would turn
 * `/api/v1/appointments/queue/*` into `/api/v1/appointment-engine/queue/*` and
 * break every client. The engine has no `routes/` of its own for exactly this
 * reason — its other endpoints are exposed through `appointments.route.ts` too.
 *
 * The module adds no appointment status: "with the doctor" is the existing
 * `Confirmed` status, and "on hold" is a Redis flag on a patient who stays
 * `Patient Arrived`. See docs/QUEUE_SYNCHRONIZATION.md.
 */
const queueRouter = Router();

/**
 * @route GET /api/v1/appointments/queue/board
 * @desc  The doctor's live queue: current patient, who is next, waiting, on
 *        hold, completed. Read by both the doctor's screen and reception.
 * @access Private (any clinic member — doctors read their own board)
 */
queueRouter.get(
  '/board',
  requireAuth,
  requireClinic,
  validateQuery(queueBoardQuerySchema),
  getQueueBoardController
);

/*
 * Actions are reception-side controls. Doctors are included because a doctor
 * working without a receptionist still has to move their own queue along, and
 * Admin because clinic admins cover reception.
 */
const queueActors = requireRole(['Receptionist', 'Nurse', 'Admin', 'Doctor']);

/**
 * @route POST /api/v1/appointments/queue/send-in
 * @desc  Move a checked-in patient to the front of the queue. A Doctor or
 *        Admin also puts them in the room, and whoever was in returns to the
 *        waiting list; for a Receptionist this only reorders. Requires the
 *        patient to be "Patient Arrived".
 * @access Private (Receptionist, Admin, Doctor)
 */
queueRouter.post(
  '/send-in',
  requireAuth,
  queueActors,
  requireClinic,
  enforceClinicAutoLogout,
  validateBody(queueActionSchema),
  requirePermission(PERMISSION_KEYS.QUEUE_MANAGE, ['Receptionist', 'Nurse']),
  requireAppointmentScope('appointmentId', 'body'),
  sendInController
);

/**
 * @route POST /api/v1/appointments/queue/hold
 * @desc  Mark a waiting patient unavailable. They keep their appointment and
 *        place but are skipped when choosing who goes next. Refuses the
 *        patient who is with the doctor — reception cannot end a consultation.
 * @access Private (Receptionist, Admin, Doctor)
 */
queueRouter.post(
  '/hold',
  requireAuth,
  queueActors,
  requireClinic,
  enforceClinicAutoLogout,
  validateBody(queueActionSchema),
  requirePermission(PERMISSION_KEYS.QUEUE_MANAGE, ['Receptionist', 'Nurse']),
  requireAppointmentScope('appointmentId', 'body'),
  holdController
);

/**
 * @route POST /api/v1/appointments/queue/skip
 * @desc  Park the patient who didn't answer and send the next one in, as one
 *        action. The skipped patient is held, not lost — Resume returns them
 *        to the queue in token order.
 * @access Private (Receptionist, Admin, Doctor)
 */
queueRouter.post(
  '/skip',
  requireAuth,
  queueActors,
  requireClinic,
  enforceClinicAutoLogout,
  validateBody(queueActionSchema),
  requirePermission(PERMISSION_KEYS.QUEUE_MANAGE, ['Receptionist', 'Nurse']),
  requireAppointmentScope('appointmentId', 'body'),
  skipController
);

/**
 * @route POST /api/v1/appointments/queue/resume
 * @desc  Return a held patient to the waiting list. Holds never clear on their
 *        own, so this is the only way back.
 * @access Private (Receptionist, Admin, Doctor)
 */
queueRouter.post(
  '/resume',
  requireAuth,
  queueActors,
  requireClinic,
  enforceClinicAutoLogout,
  validateBody(queueActionSchema),
  requirePermission(PERMISSION_KEYS.QUEUE_MANAGE, ['Receptionist', 'Nurse']),
  requireAppointmentScope('appointmentId', 'body'),
  resumeController
);

export const apiDocs = [
  {
    method: 'get',
    path: '/board',
    summary: "A doctor's live queue",
    description:
      'Current patient, next patient, waiting, on hold and completed for one ' +
      'doctor on one day. Both the doctor screen and the reception board read ' +
      'this endpoint, which is what keeps them in agreement.',
    tags: ['Queue'],
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        in: 'query',
        name: 'doctorId',
        required: true,
        schema: { type: 'string' },
      },
      {
        in: 'query',
        name: 'date',
        required: false,
        schema: { type: 'string' },
        example: '2026-08-21',
        description: 'YYYY-MM-DD. Defaults to today (IST).',
      },
    ],
    query: queueBoardQuerySchema,
    responseSchema: queueBoardResponseSchema,
    responses: { 200: { description: 'Queue board fetched successfully' } },
  },
  {
    method: 'post',
    path: '/send-in',
    summary: 'Move a patient to the front of the queue',
    description:
      'Role-dependent. A Doctor or Admin also puts the patient in the room, ' +
      'returning whoever was in to the waiting list. A Receptionist only sets ' +
      'the order override, whether or not a consultation is running — the ' +
      'front desk does not decide who is with the doctor. Rejects patients ' +
      'who have not been marked as arrived.',
    tags: ['Queue'],
    security: [{ bearerAuth: [] }],
    requestSchema: queueActionSchema,
    responseSchema: queueBoardResponseSchema,
    responses: {
      200: { description: 'Patient sent in; returns the updated board' },
      409: {
        description: 'Patient has not arrived, or is already with the doctor',
      },
    },
  },
  {
    method: 'post',
    path: '/hold',
    summary: 'Put a patient on hold',
    tags: ['Queue'],
    security: [{ bearerAuth: [] }],
    requestSchema: queueActionSchema,
    responseSchema: queueBoardResponseSchema,
    responses: {
      200: { description: 'Patient held; returns the updated board' },
      409: {
        description:
          'Appointment is already completed or cancelled, or the patient is ' +
          'with the doctor (only the doctor ends a consultation)',
      },
    },
  },
  {
    method: 'post',
    path: '/skip',
    summary: 'Skip a patient and start the next one',
    description:
      'Parks the patient who did not answer (a hold, so they keep their ' +
      'appointment and can be resumed) and sends the next waiting patient in, ' +
      'as one action. Leaves the room empty if nobody is waiting.',
    tags: ['Queue'],
    security: [{ bearerAuth: [] }],
    requestSchema: queueActionSchema,
    responseSchema: queueBoardResponseSchema,
    responses: {
      200: { description: 'Patient skipped; returns the updated board' },
      409: {
        description:
          'Appointment is already completed or cancelled, or the patient is ' +
          'already with the doctor (there is nobody to skip)',
      },
    },
  },
  {
    method: 'post',
    path: '/resume',
    summary: 'Resume a held patient',
    tags: ['Queue'],
    security: [{ bearerAuth: [] }],
    requestSchema: queueActionSchema,
    responseSchema: queueBoardResponseSchema,
    responses: {
      200: { description: 'Patient resumed; returns the updated board' },
    },
  },
];

export default queueRouter;
