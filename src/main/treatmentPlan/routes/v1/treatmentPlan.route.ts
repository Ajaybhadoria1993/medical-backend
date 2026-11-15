import express from 'express';
import {
  requireAuth,
  requireClinic,
  requireRole,
} from '../../../../middlewear/auth.middleware';
import { uploadConsentFile } from '../../../../middlewear/upload.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  addPlanOptionController,
  removePlanOptionController,
  approvePlanChangeController,
  collectPaymentController,
  discountController,
  endPlanController,
  extendPlanController,
  pausePlanController,
  planNoteController,
  planHistoryController,
  planRecallController,
  resumePlanController,
  refundController,
  writeOffController,
  createPlanController,
  getPlanController,
  listPlansController,
  patientContextController,
  planConsentFileController,
  planDecisionController,
  planFollowUpController,
  planSuggestionsController,
  requireAnswerablePlan,
  saveAsTemplateController,
  updatePlanController,
  bookAllController,
  bookAllPreviewController,
  bookStepController,
  linkStepController,
  linkableAppointmentsController,
  planDayOptionsController,
  stepBookingOptionsController,
  unlinkStepController,
  keepEarlyController,
  markStepDoneController,
  visitStepsController,
  visitStepsBulkController,
  countableVisitController,
} from '../../controllers/plan.controller';
import {
  planCreateSchema,
  planDiscountSchema,
  planEndSchema,
  planExtendSchema,
  planNoteSchema,
  planHistoryQuerySchema,
  planPauseSchema,
  planRecallSchema,
  planPaymentSchema,
  planRefundSchema,
  planWriteOffSchema,
  planDecisionSchema,
  planFollowUpSchema,
  planIdParamSchema,
  planOptionAddSchema,
  patientIdParamSchema,
  planListQuerySchema,
  planUpdateSchema,
  saveAsTemplateSchema,
  suggestionQuerySchema,
  appointmentIdParamSchema,
  visitStepsBulkQuerySchema,
  bookAllSchema,
  bookStepSchema,
  keepEarlySchema,
  markStepDoneSchema,
  bookingOptionsQuerySchema,
  linkStepSchema,
  planStepParamSchema,
} from '../../schemas/plan.schema';
import {
  consentFileResponse,
  patientContextResponse,
  planDetailResponse,
  planHistoryResponse,
  planListResponse,
  planSuggestionsResponse,
  templateDetailResponse,
  bookAllPreviewResponse,
  bookingOptionsResponse,
  dayOptionsResponse,
  linkableAppointmentsResponse,
  visitStepsResponse,
} from '../../schemas/response.schema';

// Mounted at /api/v1/treatment-plan. loadRoutes mounts files in no fixed order, so "/:planId" must
// not swallow /settings or /templates: a non-uuid id leaves this router for the next one.
const planRouter = express.Router();
const STAFF = ['Admin', 'Doctor', 'Receptionist'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
planRouter.param('planId', (_req, _res, next, id: string) =>
  UUID.test(id) ? next() : next('router')
);

/** @route GET /api/v1/treatment-plan/suggestions — templates matching a diagnosis, best first
 *  @access Doctor (their specialties and own versions; up to 4, each with the matched keyword) */
planRouter.get(
  '/suggestions',
  requireAuth,
  requireRole(['Doctor']),
  requireClinic,
  validate(suggestionQuerySchema, 'query'),
  planSuggestionsController
);

/** @route GET /api/v1/treatment-plan/patients/:patientId — name and recorded allergies for the create screen
 *  @access Doctor (patient of this clinic; else 404) */
planRouter.get(
  '/patients/:patientId',
  requireAuth,
  requireRole(['Doctor']),
  requireClinic,
  validate(patientIdParamSchema, 'params'),
  patientContextController
);

/** @route GET /api/v1/treatment-plan — plans the caller may see, newest first
 *  @access Admin, Doctor, Receptionist (Doctor: own; Receptionist: assigned doctors) */
planRouter.get(
  '/',
  requireAuth,
  requireRole(STAFF),
  requireClinic,
  validate(planListQuerySchema, 'query'),
  listPlansController
);

/** @route POST /api/v1/treatment-plan — propose a plan for a patient of this clinic
 *  @access Doctor (the plan's doctor is the caller; flagged checks need a reason) */
planRouter.post(
  '/',
  requireAuth,
  requireRole(['Doctor']),
  requireClinic,
  validate(planCreateSchema),
  createPlanController
);

/** @route GET /api/v1/treatment-plan/:planId — one plan with steps, patient and options
 *  @access Admin, Doctor, Receptionist (same scope as the list; else 404) */
planRouter.get(
  '/:planId',
  requireAuth,
  requireRole(STAFF),
  requireClinic,
  validate(planIdParamSchema, 'params'),
  getPlanController
);

/** @route PUT /api/v1/treatment-plan/:planId — edit a proposed plan in full
 *  @access Doctor (own plan, suggested or accepted; after accept it saves a new version; 409 when someone else saved first) */
planRouter.put(
  '/:planId',
  requireAuth,
  requireRole(['Doctor']),
  requireClinic,
  validate(planIdParamSchema, 'params'),
  validate(planUpdateSchema),
  updatePlanController
);

/** @route POST /api/v1/treatment-plan/:planId/options — copy as the next option (A → B → C)
 *  @access Doctor (own proposed plan; up to 3 options) */
planRouter.post(
  '/:planId/options',
  requireAuth,
  requireRole(['Doctor']),
  requireClinic,
  validate(planIdParamSchema, 'params'),
  validate(planOptionAddSchema),
  addPlanOptionController
);

/** @route DELETE /api/v1/treatment-plan/:planId/options — remove a suggested option (never the last one)
 *  @access Doctor (own proposed plan) */
planRouter.delete(
  '/:planId/options',
  requireAuth,
  requireRole(['Doctor']),
  requireClinic,
  validate(planIdParamSchema, 'params'),
  removePlanOptionController
);

/** @route POST /api/v1/treatment-plan/:planId/save-as-template — the doctor's own template from this plan
 *  @access Doctor (own plan) */
planRouter.post(
  '/:planId/save-as-template',
  requireAuth,
  requireRole(['Doctor']),
  requireClinic,
  validate(planIdParamSchema, 'params'),
  validate(saveAsTemplateSchema),
  saveAsTemplateController
);

/** @route POST /api/v1/treatment-plan/:planId/decision — the patient's answer: accept, think or decline
 *  @access Admin, Doctor, Receptionist (same scope as the list; accept may carry `consentFile`, multipart) */
planRouter.post(
  '/:planId/decision',
  requireAuth,
  requireRole(STAFF),
  requireClinic,
  validate(planIdParamSchema, 'params'),
  requireAnswerablePlan,
  uploadConsentFile.single('consentFile'),
  validate(planDecisionSchema),
  planDecisionController
);

/** @route POST /api/v1/treatment-plan/:planId/followups — log a call and, optionally, the next call date
 *  @access Admin, Doctor, Receptionist (suggested or declined plans) */
planRouter.post(
  '/:planId/followups',
  requireAuth,
  requireRole(STAFF),
  requireClinic,
  validate(planIdParamSchema, 'params'),
  validate(planFollowUpSchema),
  planFollowUpController
);

/** @route POST /api/v1/treatment-plan/:planId/approve-change — the patient agreed to the changed plan
 *  @access Admin, Doctor, Receptionist (only when a version is waiting for approval) */
planRouter.post(
  '/:planId/approve-change',
  requireAuth,
  requireRole(STAFF),
  requireClinic,
  validate(planIdParamSchema, 'params'),
  approvePlanChangeController
);

/** @route GET /api/v1/treatment-plan/:planId/consent-file — a 5-minute link to the signed consent form
 *  @access Admin, Doctor, Receptionist (same scope as the list) */
planRouter.get(
  '/:planId/consent-file',
  requireAuth,
  requireRole(STAFF),
  requireClinic,
  validate(planIdParamSchema, 'params'),
  planConsentFileController
);

// ── Phase 4: booking and visits ──────────────────────────────────────────────

/** @route GET /api/v1/treatment-plan/appointments/:appointmentId/countable — plans whose step 1 this visit can count as
 *  @access Admin, Doctor, Receptionist (same scope as the list) */
planRouter.get(
  '/appointments/:appointmentId/countable',
  requireAuth,
  requireRole(STAFF),
  requireClinic,
  validate(appointmentIdParamSchema, 'params'),
  countableVisitController
);

/** @route GET /api/v1/treatment-plan/appointments/steps?ids=a,b — plan steps for many visits at once
 *  @access Admin, Doctor, Receptionist (same scope as the list; feeds the plan tag on a visit list) */
planRouter.get(
  '/appointments/steps',
  requireAuth,
  requireRole(STAFF),
  requireClinic,
  validate(visitStepsBulkQuerySchema, 'query'),
  visitStepsBulkController
);

/** @route GET /api/v1/treatment-plan/appointments/:appointmentId/steps — plan steps this visit is for
 *  @access Admin, Doctor, Receptionist (same scope as the list; feeds the consultation's "This visit" card) */
planRouter.get(
  '/appointments/:appointmentId/steps',
  requireAuth,
  requireRole(STAFF),
  requireClinic,
  validate(appointmentIdParamSchema, 'params'),
  visitStepsController
);

/** @route GET /api/v1/treatment-plan/:planId/steps/:stepId/booking-options?date= — earliest day + free times
 *  @access Admin, Doctor, Receptionist (accepted or in-treatment plans) */
planRouter.get(
  '/:planId/steps/:stepId/booking-options',
  requireAuth,
  requireRole(STAFF),
  requireClinic,
  validate(planStepParamSchema, 'params'),
  validate(bookingOptionsQuerySchema, 'query'),
  stepBookingOptionsController
);

/** @route POST /api/v1/treatment-plan/:planId/steps/:stepId/book — book a "Treatment" visit for the step
 *  @access Admin, Doctor, Receptionist (before the earliest day: Doctor or Admin with a reason) */
planRouter.post(
  '/:planId/steps/:stepId/book',
  requireAuth,
  requireRole(STAFF),
  requireClinic,
  validate(planStepParamSchema, 'params'),
  validate(bookStepSchema),
  bookStepController
);

/** @route GET /api/v1/treatment-plan/:planId/booking-options?date= — the doctor's free times on a day (any step)
 *  @access Admin, Doctor, Receptionist (used by "Book all" when staff move a visit) */
planRouter.get(
  '/:planId/booking-options',
  requireAuth,
  requireRole(STAFF),
  requireClinic,
  validate(planIdParamSchema, 'params'),
  validate(bookingOptionsQuerySchema, 'query'),
  planDayOptionsController
);

/** @route GET /api/v1/treatment-plan/:planId/book-all — first free visit for each remaining step, to confirm
 *  @access Admin, Doctor, Receptionist */
planRouter.get(
  '/:planId/book-all',
  requireAuth,
  requireRole(STAFF),
  requireClinic,
  validate(planIdParamSchema, 'params'),
  bookAllPreviewController
);

/** @route POST /api/v1/treatment-plan/:planId/book-all — book the confirmed visits in order
 *  @access Admin, Doctor, Receptionist */
planRouter.post(
  '/:planId/book-all',
  requireAuth,
  requireRole(STAFF),
  requireClinic,
  validate(planIdParamSchema, 'params'),
  validate(bookAllSchema),
  bookAllController
);

/** @route GET /api/v1/treatment-plan/:planId/linkable-appointments — the patient's upcoming visits a step can use
 *  @access Admin, Doctor, Receptionist (same patient, the plan's doctor, not used by another step) */
planRouter.get(
  '/:planId/linkable-appointments',
  requireAuth,
  requireRole(STAFF),
  requireClinic,
  validate(planIdParamSchema, 'params'),
  linkableAppointmentsController
);

/** @route POST /api/v1/treatment-plan/:planId/steps/:stepId/link — use an existing visit for the step
 *  @access Admin, Doctor, Receptionist */
planRouter.post(
  '/:planId/steps/:stepId/link',
  requireAuth,
  requireRole(STAFF),
  requireClinic,
  validate(planStepParamSchema, 'params'),
  validate(linkStepSchema),
  linkStepController
);

/** @route POST /api/v1/treatment-plan/:planId/steps/:stepId/unlink — take the step off its visit (the visit stays)
 *  @access Admin, Doctor, Receptionist */
planRouter.post(
  '/:planId/steps/:stepId/unlink',
  requireAuth,
  requireRole(STAFF),
  requireClinic,
  validate(planStepParamSchema, 'params'),
  unlinkStepController
);

/** @route POST /api/v1/treatment-plan/:planId/steps/:stepId/keep-early — keep a visit now before its gap, with a reason
 *  @access Doctor, Admin (checked in the service, as for booking early) */
planRouter.post(
  '/:planId/steps/:stepId/keep-early',
  requireAuth,
  requireRole(STAFF),
  requireClinic,
  validate(planStepParamSchema, 'params'),
  validate(keepEarlySchema),
  keepEarlyController
);

/** @route POST /api/v1/treatment-plan/:planId/steps/:stepId/done — the step was done without a booked visit (walk-in)
 *  @access Doctor, Admin (checked in the service) */
planRouter.post(
  '/:planId/steps/:stepId/done',
  requireAuth,
  requireRole(STAFF),
  requireClinic,
  validate(planStepParamSchema, 'params'),
  validate(markStepDoneSchema),
  markStepDoneController
);

// ── Phase 5: payments ────────────────────────────────────────────────────────

/** @route POST /api/v1/treatment-plan/:planId/payments — collect money; returns the plan with the receipt
 *  @access Admin, Doctor, Receptionist (same requestId again = the first payment, never a second) */
planRouter.post(
  '/:planId/payments',
  requireAuth,
  requireRole(STAFF),
  requireClinic,
  validate(planIdParamSchema, 'params'),
  validate(planPaymentSchema),
  collectPaymentController
);

/** @route POST /api/v1/treatment-plan/:planId/refunds — money back, with a reason (never more than was paid)
 *  @access Admin, Doctor, Receptionist */
planRouter.post(
  '/:planId/refunds',
  requireAuth,
  requireRole(STAFF),
  requireClinic,
  validate(planIdParamSchema, 'params'),
  validate(planRefundSchema),
  refundController
);

/** @route POST /api/v1/treatment-plan/:planId/write-offs — forgive what is owed now, with a reason
 *  @access Admin, Doctor */
planRouter.post(
  '/:planId/write-offs',
  requireAuth,
  requireRole(['Admin', 'Doctor']),
  requireClinic,
  validate(planIdParamSchema, 'params'),
  validate(planWriteOffSchema),
  writeOffController
);

/** @route POST /api/v1/treatment-plan/:planId/discount — lower what is still to come, with a reason
 *  @access Admin, Doctor */
planRouter.post(
  '/:planId/discount',
  requireAuth,
  requireRole(['Admin', 'Doctor']),
  requireClinic,
  validate(planIdParamSchema, 'params'),
  validate(planDiscountSchema),
  discountController
);

// ── Phase 6: track and close ─────────────────────────────────────────────────

const APPROVERS = ['Admin', 'Doctor'];

/** @route POST /api/v1/treatment-plan/:planId/pause — stop booking for a while, with a reason
 *  @access Admin, Doctor (accepted or in-treatment plans; booked visits stay) */
planRouter.post(
  '/:planId/pause',
  requireAuth,
  requireRole(APPROVERS),
  requireClinic,
  validate(planIdParamSchema, 'params'),
  validate(planPauseSchema),
  pausePlanController
);

/** @route POST /api/v1/treatment-plan/:planId/resume — carry on a paused plan
 *  @access Admin, Doctor */
planRouter.post(
  '/:planId/resume',
  requireAuth,
  requireRole(APPROVERS),
  requireClinic,
  validate(planIdParamSchema, 'params'),
  resumePlanController
);

/** @route POST /api/v1/treatment-plan/:planId/end — end early with a reason; `sensitive` stops every message
 *  @access Admin, Doctor (suggested, accepted, in-treatment or paused plans) */
planRouter.post(
  '/:planId/end',
  requireAuth,
  requireRole(APPROVERS),
  requireClinic,
  validate(planIdParamSchema, 'params'),
  validate(planEndSchema),
  endPlanController
);

/** @route PUT /api/v1/treatment-plan/:planId/recall — set or clear the recall date of a completed plan
 *  @access Admin, Doctor */
planRouter.put(
  '/:planId/recall',
  requireAuth,
  requireRole(APPROVERS),
  requireClinic,
  validate(planIdParamSchema, 'params'),
  validate(planRecallSchema),
  planRecallController
);

/** @route POST /api/v1/treatment-plan/:planId/extend — new last day for a package, optional fee
 *  @access Admin, Doctor (same requestId again = no second fee) */
planRouter.post(
  '/:planId/extend',
  requireAuth,
  requireRole(APPROVERS),
  requireClinic,
  validate(planIdParamSchema, 'params'),
  validate(planExtendSchema),
  extendPlanController
);

/** @route POST /api/v1/treatment-plan/:planId/notes — a note in the plan's history
 *  @access Admin, Doctor, Receptionist (same scope as the list) */
planRouter.post(
  '/:planId/notes',
  requireAuth,
  requireRole(STAFF),
  requireClinic,
  validate(planIdParamSchema, 'params'),
  validate(planNoteSchema),
  planNoteController
);

/** @route GET /api/v1/treatment-plan/:planId/history?pageNumber=&pageSize= — the plan's history, newest first
 *  @access Admin, Doctor, Receptionist (same scope as the list; the plan detail carries only the newest 10) */
planRouter.get(
  '/:planId/history',
  requireAuth,
  requireRole(STAFF),
  requireClinic,
  validate(planIdParamSchema, 'params'),
  validate(planHistoryQuerySchema, 'query'),
  planHistoryController
);

// Paths are relative: loadRoutes prefixes the mount path.
export const apiDocs = [
  {
    method: 'get' as const,
    path: '/patients/:patientId',
    description: 'Patient name and allergies for the create screen (Doctor)',
    params: patientIdParamSchema,
    responseSchema: patientContextResponse,
  },
  {
    method: 'get' as const,
    path: '/suggestions',
    description: 'Templates matching a diagnosis (Doctor)',
    query: suggestionQuerySchema,
    responseSchema: planSuggestionsResponse,
  },
  {
    method: 'get' as const,
    path: '',
    description: 'Plans the caller may see (Staff)',
    query: planListQuerySchema,
    responseSchema: planListResponse,
  },
  {
    method: 'post' as const,
    path: '',
    description: 'Propose a plan (Doctor)',
    requestSchema: planCreateSchema,
    responseSchema: planDetailResponse,
  },
  {
    method: 'get' as const,
    path: '/:planId',
    description: 'One plan (Staff)',
    params: planIdParamSchema,
    responseSchema: planDetailResponse,
  },
  {
    method: 'put' as const,
    path: '/:planId',
    description:
      'Edit a suggested plan, or an accepted one as a new version (Doctor)',
    params: planIdParamSchema,
    requestSchema: planUpdateSchema,
    responseSchema: planDetailResponse,
  },
  {
    method: 'post' as const,
    path: '/:planId/options',
    description: 'Add the next option (Doctor)',
    params: planIdParamSchema,
    responseSchema: planDetailResponse,
  },
  {
    method: 'post' as const,
    path: '/:planId/save-as-template',
    description: 'Save as own template (Doctor)',
    params: planIdParamSchema,
    requestSchema: saveAsTemplateSchema,
    responseSchema: templateDetailResponse,
  },
  {
    method: 'post' as const,
    path: '/:planId/decision',
    description:
      'Patient decision: accept (payment way, optional advance, consent file as multipart field consentFile), think or decline (Staff)',
    params: planIdParamSchema,
    requestSchema: planDecisionSchema,
    responseSchema: planDetailResponse,
  },
  {
    method: 'post' as const,
    path: '/:planId/followups',
    description: 'Log a follow-up call and the next call date (Staff)',
    params: planIdParamSchema,
    requestSchema: planFollowUpSchema,
    responseSchema: planDetailResponse,
  },
  {
    method: 'post' as const,
    path: '/:planId/approve-change',
    description: 'Record that the patient approved the changed plan (Staff)',
    params: planIdParamSchema,
    responseSchema: planDetailResponse,
  },
  {
    method: 'get' as const,
    path: '/:planId/consent-file',
    description: '5-minute link to the signed consent form (Staff)',
    params: planIdParamSchema,
    responseSchema: consentFileResponse,
  },
  {
    method: 'get' as const,
    path: '/appointments/steps',
    description: 'Plan steps linked to many visits, by ?ids=a,b (Staff)',
    query: visitStepsBulkQuerySchema,
  },
  {
    method: 'get' as const,
    path: '/appointments/:appointmentId/steps',
    description: 'Plan steps linked to one visit (Staff)',
    params: appointmentIdParamSchema,
    responseSchema: visitStepsResponse,
  },
  {
    method: 'get' as const,
    path: '/:planId/steps/:stepId/booking-options',
    description:
      "A step's earliest day and the doctor's free times or token sessions on a date (Staff)",
    params: planStepParamSchema,
    query: bookingOptionsQuerySchema,
    responseSchema: bookingOptionsResponse,
  },
  {
    method: 'post' as const,
    path: '/:planId/steps/:stepId/book',
    description:
      'Book a Treatment visit for a step (Staff; early needs Doctor/Admin + reason)',
    params: planStepParamSchema,
    requestSchema: bookStepSchema,
    responseSchema: planDetailResponse,
  },
  {
    method: 'get' as const,
    path: '/:planId/booking-options',
    description:
      "The plan doctor's free times or token sessions on a date (Staff)",
    params: planIdParamSchema,
    query: bookingOptionsQuerySchema,
    responseSchema: dayOptionsResponse,
  },
  {
    method: 'get' as const,
    path: '/:planId/book-all',
    description: 'First free visit for each remaining step (Staff)',
    params: planIdParamSchema,
    responseSchema: bookAllPreviewResponse,
  },
  {
    method: 'post' as const,
    path: '/:planId/book-all',
    description: 'Book the confirmed visits in order (Staff)',
    params: planIdParamSchema,
    requestSchema: bookAllSchema,
    responseSchema: planDetailResponse,
  },
  {
    method: 'get' as const,
    path: '/:planId/linkable-appointments',
    description:
      "The patient's upcoming visits with the plan's doctor not used by a step (Staff)",
    params: planIdParamSchema,
    responseSchema: linkableAppointmentsResponse,
  },
  {
    method: 'post' as const,
    path: '/:planId/steps/:stepId/link',
    description: 'Use an existing visit for a step (Staff)',
    params: planStepParamSchema,
    requestSchema: linkStepSchema,
    responseSchema: planDetailResponse,
  },
  {
    method: 'post' as const,
    path: '/:planId/steps/:stepId/unlink',
    description: 'Take a step off its visit; the visit stays booked (Staff)',
    params: planStepParamSchema,
    responseSchema: planDetailResponse,
  },
  {
    method: 'post' as const,
    path: '/:planId/steps/:stepId/keep-early',
    description:
      'Keep a visit that is now before its gap, with a reason (Doctor, Admin)',
    params: planStepParamSchema,
    requestSchema: keepEarlySchema,
    responseSchema: planDetailResponse,
  },
  {
    method: 'post' as const,
    path: '/:planId/steps/:stepId/done',
    description:
      'Mark a step done without a booked visit, on a day up to today (Doctor, Admin)',
    params: planStepParamSchema,
    requestSchema: markStepDoneSchema,
    responseSchema: planDetailResponse,
  },
  {
    method: 'post' as const,
    path: '/:planId/payments',
    description: 'Collect a payment with a receipt (Staff)',
    params: planIdParamSchema,
    requestSchema: planPaymentSchema,
    responseSchema: planDetailResponse,
  },
  {
    method: 'post' as const,
    path: '/:planId/refunds',
    description: 'Refund money with a reason (Staff)',
    params: planIdParamSchema,
    requestSchema: planRefundSchema,
    responseSchema: planDetailResponse,
  },
  {
    method: 'post' as const,
    path: '/:planId/write-offs',
    description: 'Write off what is owed now (Admin, Doctor)',
    params: planIdParamSchema,
    requestSchema: planWriteOffSchema,
    responseSchema: planDetailResponse,
  },
  {
    method: 'post' as const,
    path: '/:planId/discount',
    description: 'Lower what is still to come (Admin, Doctor)',
    params: planIdParamSchema,
    requestSchema: planDiscountSchema,
    responseSchema: planDetailResponse,
  },
  {
    method: 'post' as const,
    path: '/:planId/pause',
    description: 'Pause a plan with a reason (Admin, Doctor)',
    params: planIdParamSchema,
    requestSchema: planPauseSchema,
    responseSchema: planDetailResponse,
  },
  {
    method: 'post' as const,
    path: '/:planId/resume',
    description: 'Resume a paused plan (Admin, Doctor)',
    params: planIdParamSchema,
    responseSchema: planDetailResponse,
  },
  {
    method: 'post' as const,
    path: '/:planId/end',
    description:
      'End a plan early; sensitive stops every message (Admin, Doctor)',
    params: planIdParamSchema,
    requestSchema: planEndSchema,
    responseSchema: planDetailResponse,
  },
  {
    method: 'put' as const,
    path: '/:planId/recall',
    description:
      'Set or clear the recall date of a completed plan (Admin, Doctor)',
    params: planIdParamSchema,
    requestSchema: planRecallSchema,
    responseSchema: planDetailResponse,
  },
  {
    method: 'post' as const,
    path: '/:planId/extend',
    description: "Extend a package's last day, optional fee (Admin, Doctor)",
    params: planIdParamSchema,
    requestSchema: planExtendSchema,
    responseSchema: planDetailResponse,
  },
  {
    method: 'post' as const,
    path: '/:planId/notes',
    description: "Add a note to the plan's history (Staff)",
    params: planIdParamSchema,
    requestSchema: planNoteSchema,
    responseSchema: planDetailResponse,
  },
  {
    method: 'get' as const,
    path: '/:planId/history',
    description: "One page of the plan's history, newest first (Staff)",
    params: planIdParamSchema,
    query: planHistoryQuerySchema,
    responseSchema: planHistoryResponse,
  },
];

export default planRouter;
