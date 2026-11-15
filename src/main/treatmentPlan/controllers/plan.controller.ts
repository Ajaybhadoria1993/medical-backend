import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendCreated, sendOk } from '../../../utils/response.utils';
import { PlanBookingService } from '../services/plans/planBooking.service';
import { PlanDecisionService } from '../services/plans/planDecision.service';
import { PlanLedgerService } from '../services/plans/planLedger.service';
import { PlanLifecycleService } from '../services/plans/planLifecycle.service';
import { PlanQueryService } from '../services/plans/planQuery.service';
import { PlanWriteService } from '../services/plans/planWrite.service';
import { toActor } from '../utils/actor.utils';

// The clinic comes from the token (requireClinic), never from the request.

export const planSuggestionsController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await PlanQueryService.suggestions(
      req.clinicId!,
      req.user!.id,
      req.validatedQuery.diagnosis
    );
    return sendOk(res, 'Suggestions ready', data);
  }
);

export const patientContextController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await PlanQueryService.patientContext(
      req.clinicId!,
      req.validatedParams.patientId
    );
    return sendOk(res, 'Patient fetched', data);
  }
);

export const listPlansController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await PlanQueryService.list(
      req.clinicId!,
      toActor(req.user!),
      req.validatedQuery
    );
    return sendOk(res, 'Treatment plans fetched', data);
  }
);

export const getPlanController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await PlanQueryService.get(
      req.clinicId!,
      toActor(req.user!),
      req.validatedParams.planId
    );
    return sendOk(res, 'Treatment plan fetched', data);
  }
);

export const createPlanController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await PlanWriteService.create(
      req.clinicId!,
      toActor(req.user!),
      req.validatedBody
    );
    return sendCreated(res, 'Treatment plan proposed', data);
  }
);

export const updatePlanController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await PlanWriteService.update(
      req.clinicId!,
      toActor(req.user!),
      req.validatedParams.planId,
      req.validatedBody
    );
    return sendOk(res, 'Treatment plan saved', data);
  }
);

export const addPlanOptionController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await PlanWriteService.addOption(
      req.clinicId!,
      toActor(req.user!),
      req.validatedParams.planId,
      req.validatedBody
    );
    return sendCreated(res, `Option ${data.optionLabel} added`, data);
  }
);

export const removePlanOptionController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await PlanWriteService.removeOption(
      req.clinicId!,
      toActor(req.user!),
      req.validatedParams.planId
    );
    return sendOk(res, 'Option removed', data);
  }
);

export const saveAsTemplateController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await PlanWriteService.saveAsTemplate(
      req.clinicId!,
      toActor(req.user!),
      req.validatedParams.planId,
      req.validatedBody.name
    );
    return sendCreated(res, 'Saved as your template', data);
  }
);

/** Runs before the consent upload, so a file never reaches S3 for a plan that can't take an answer. */
export const requireAnswerablePlan = asyncHandler(async (req, _res, next) => {
  await PlanQueryService.assertAnswerable(
    req.clinicId!,
    toActor(req.user!),
    req.validatedParams.planId
  );
  next();
});

export const planDecisionController = asyncHandler(
  async (req: Request, res: Response) => {
    // Stored as the S3 key (DEV_PLAN §7); links are signed only when someone opens the file.
    const consentFile = (req.file as { key?: string } | undefined)?.key ?? null;
    const data = await PlanDecisionService.decide(
      req.clinicId!,
      toActor(req.user!),
      req.validatedParams.planId,
      req.validatedBody,
      consentFile
    );
    return sendOk(res, 'Patient decision recorded', data);
  }
);

export const planFollowUpController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await PlanDecisionService.logCall(
      req.clinicId!,
      toActor(req.user!),
      req.validatedParams.planId,
      req.validatedBody
    );
    return sendCreated(res, 'Call logged', data);
  }
);

export const approvePlanChangeController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await PlanDecisionService.approveChange(
      req.clinicId!,
      toActor(req.user!),
      req.validatedParams.planId
    );
    return sendOk(res, 'Change approved by the patient', data);
  }
);

export const planConsentFileController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await PlanQueryService.consentFileLink(
      req.clinicId!,
      toActor(req.user!),
      req.validatedParams.planId
    );
    return sendOk(res, 'Consent form link ready', data);
  }
);

// ── Phase 4: booking and visits ──────────────────────────────────────────────

export const stepBookingOptionsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { planId, stepId } = req.validatedParams;
    const data = await PlanBookingService.bookingOptions(
      req.clinicId!,
      toActor(req.user!),
      planId,
      stepId,
      req.validatedQuery.date
    );
    return sendOk(res, 'Booking options ready', data);
  }
);

export const bookStepController = asyncHandler(
  async (req: Request, res: Response) => {
    const { planId, stepId } = req.validatedParams;
    const data = await PlanBookingService.book(
      req.clinicId!,
      toActor(req.user!),
      planId,
      stepId,
      req.validatedBody
    );
    return sendCreated(res, 'Step booked', data);
  }
);

export const bookAllPreviewController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await PlanBookingService.bookAllPreview(
      req.clinicId!,
      toActor(req.user!),
      req.validatedParams.planId
    );
    return sendOk(res, 'Suggested visits ready', data);
  }
);

export const bookAllController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await PlanBookingService.bookAll(
      req.clinicId!,
      toActor(req.user!),
      req.validatedParams.planId,
      req.validatedBody
    );
    return sendCreated(res, 'Steps booked', data);
  }
);

export const linkableAppointmentsController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await PlanBookingService.linkable(
      req.clinicId!,
      toActor(req.user!),
      req.validatedParams.planId
    );
    return sendOk(res, 'Visits fetched', data);
  }
);

export const linkStepController = asyncHandler(
  async (req: Request, res: Response) => {
    const { planId, stepId } = req.validatedParams;
    const data = await PlanBookingService.link(
      req.clinicId!,
      toActor(req.user!),
      planId,
      stepId,
      req.validatedBody
    );
    return sendOk(res, 'Visit linked to the step', data);
  }
);

export const unlinkStepController = asyncHandler(
  async (req: Request, res: Response) => {
    const { planId, stepId } = req.validatedParams;
    const data = await PlanBookingService.unlink(
      req.clinicId!,
      toActor(req.user!),
      planId,
      stepId
    );
    return sendOk(res, 'Visit taken off the step', data);
  }
);

export const keepEarlyController = asyncHandler(
  async (req: Request, res: Response) => {
    const { planId, stepId } = req.validatedParams;
    const data = await PlanBookingService.keepEarly(
      req.clinicId!,
      toActor(req.user!),
      planId,
      stepId,
      req.validatedBody.reason
    );
    return sendOk(res, 'Visit kept', data);
  }
);

export const markStepDoneController = asyncHandler(
  async (req: Request, res: Response) => {
    const { planId, stepId } = req.validatedParams;
    const data = await PlanBookingService.markDoneWithoutVisit(
      req.clinicId!,
      toActor(req.user!),
      planId,
      stepId,
      req.validatedBody
    );
    return sendOk(res, 'Step marked done', data);
  }
);

export const countableVisitController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await PlanBookingService.countableFor(
      req.clinicId!,
      toActor(req.user!),
      req.validatedParams.appointmentId
    );
    return sendOk(res, 'Plans this visit can count for', data);
  }
);

export const visitStepsController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await PlanBookingService.visitSteps(
      req.clinicId!,
      toActor(req.user!),
      req.validatedParams.appointmentId
    );
    return sendOk(res, 'Visit steps fetched', data);
  }
);

export const visitStepsBulkController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await PlanBookingService.visitStepsFor(
      req.clinicId!,
      toActor(req.user!),
      req.validatedQuery.ids
    );
    return sendOk(res, 'Visit steps fetched', data);
  }
);

export const planDayOptionsController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await PlanBookingService.dayOptions(
      req.clinicId!,
      toActor(req.user!),
      req.validatedParams.planId,
      req.validatedQuery.date
    );
    return sendOk(res, 'Free times ready', data);
  }
);

// ── Phase 5: payments ────────────────────────────────────────────────────────

export const collectPaymentController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await PlanLedgerService.collect(
      req.clinicId!,
      toActor(req.user!),
      req.validatedParams.planId,
      req.validatedBody
    );
    return sendCreated(res, 'Payment recorded', data);
  }
);

export const refundController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await PlanLedgerService.refund(
      req.clinicId!,
      toActor(req.user!),
      req.validatedParams.planId,
      req.validatedBody
    );
    return sendCreated(res, 'Refund recorded', data);
  }
);

export const writeOffController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await PlanLedgerService.writeOff(
      req.clinicId!,
      toActor(req.user!),
      req.validatedParams.planId,
      req.validatedBody
    );
    return sendCreated(res, 'Amount written off', data);
  }
);

export const discountController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await PlanLedgerService.discount(
      req.clinicId!,
      toActor(req.user!),
      req.validatedParams.planId,
      req.validatedBody
    );
    return sendOk(res, 'Discount applied', data);
  }
);

// ── Phase 6: track and close ─────────────────────────────────────────────────

export const pausePlanController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await PlanLifecycleService.pause(
      req.clinicId!,
      toActor(req.user!),
      req.validatedParams.planId,
      req.validatedBody
    );
    return sendOk(res, 'Plan paused', data);
  }
);

export const resumePlanController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await PlanLifecycleService.resume(
      req.clinicId!,
      toActor(req.user!),
      req.validatedParams.planId
    );
    return sendOk(res, 'Plan resumed', data);
  }
);

export const endPlanController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await PlanLifecycleService.end(
      req.clinicId!,
      toActor(req.user!),
      req.validatedParams.planId,
      req.validatedBody
    );
    return sendOk(res, 'Plan ended', data);
  }
);

export const planRecallController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await PlanLifecycleService.setRecall(
      req.clinicId!,
      toActor(req.user!),
      req.validatedParams.planId,
      req.validatedBody
    );
    return sendOk(res, 'Recall date saved', data);
  }
);

export const extendPlanController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await PlanLifecycleService.extend(
      req.clinicId!,
      toActor(req.user!),
      req.validatedParams.planId,
      req.validatedBody
    );
    return sendOk(res, 'Package extended', data);
  }
);

export const planNoteController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await PlanLifecycleService.addNote(
      req.clinicId!,
      toActor(req.user!),
      req.validatedParams.planId,
      req.validatedBody
    );
    return sendCreated(res, 'Note added', data);
  }
);

export const planHistoryController = asyncHandler(
  async (req: Request, res: Response) => {
    const { pageNumber, pageSize } = req.validatedQuery;
    const data = await PlanQueryService.history(
      req.clinicId!,
      toActor(req.user!),
      req.validatedParams.planId,
      pageNumber,
      pageSize
    );
    return sendOk(res, 'Plan history fetched', data);
  }
);
