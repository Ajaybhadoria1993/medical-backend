import express from 'express';
import {
  requireAuth,
  requireClinic,
  requireRole,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  getClinicFinanceSummaryController,
  getDisputesController,
  getRefundReviewsController,
  getRevenueBreakdownController,
  getSettlementsController,
  getTransactionsController,
  decideRefundReviewController,
  downloadSettlementStatementController,
  downloadMonthlyStatementController,
  uploadDisputeEvidenceController,
} from '../../controllers/clinicFinance.controller';
import { uploadFinanceEvidence } from '../../middlewares/financeEvidenceUpload.middleware';
import {
  clinicFinanceDateRangeSchema,
  disputeListQuerySchema,
  disputeParamsSchema,
  refundReviewDecisionSchema,
  refundReviewParamsSchema,
  revenueBreakdownQuerySchema,
  settlementListQuerySchema,
  settlementParamsSchema,
  statementMonthParamsSchema,
  settlementStatementQuerySchema,
} from '../../schemas/clinicFinance.schemas';
import { getAppointmentPaymentsSchema } from '../../../appointments/schemas/appointment.schemas';
import {
  enforceDateLimit,
  FEATURE_KEYS,
} from '../../../../middlewear/limitation.middleware';

const clinicFinanceRouter = express.Router();
const requireClinicFinanceAdmin = requireRole(['Admin', 'Super_Admin']);

/** @route GET /api/v1/clinic-finance/transactions — every payment and refund (appointments and plans)
 *  @access Admin, Receptionist; Doctor (own money only, filtered in the service) */
clinicFinanceRouter.get(
  '/transactions',
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Doctor', 'Receptionist']),
  requireClinic,
  validate(getAppointmentPaymentsSchema, 'query'),
  enforceDateLimit(FEATURE_KEYS.PAYMENT_HISTORY_MONTHS),
  getTransactionsController
);

clinicFinanceRouter.use(requireAuth, requireClinicFinanceAdmin, requireClinic);

clinicFinanceRouter.get(
  '/summary',
  validate(clinicFinanceDateRangeSchema, 'query'),
  getClinicFinanceSummaryController
);

clinicFinanceRouter.get(
  '/revenue-breakdown',
  validate(revenueBreakdownQuerySchema, 'query'),
  getRevenueBreakdownController
);

clinicFinanceRouter.get(
  '/settlements',
  validate(settlementListQuerySchema, 'query'),
  getSettlementsController
);

clinicFinanceRouter.get(
  '/settlements/:settlementId/statement',
  validate(settlementParamsSchema, 'params'),
  validate(settlementStatementQuerySchema, 'query'),
  downloadSettlementStatementController
);

/** @route GET /api/v1/clinic-finance/statements/:month — the month's money as a PDF
 *  @access Admin, Super_Admin (clinic from the token) */
clinicFinanceRouter.get(
  '/statements/:month',
  validate(statementMonthParamsSchema, 'params'),
  downloadMonthlyStatementController
);

clinicFinanceRouter.get('/refund-reviews', getRefundReviewsController);

clinicFinanceRouter.post(
  '/refund-reviews/:appointmentId/decision',
  validate(refundReviewParamsSchema, 'params'),
  validate(refundReviewDecisionSchema, 'body'),
  decideRefundReviewController
);

clinicFinanceRouter.get(
  '/disputes',
  validate(disputeListQuerySchema, 'query'),
  getDisputesController
);

clinicFinanceRouter.post(
  '/disputes/:disputeId/evidence',
  validate(disputeParamsSchema, 'params'),
  uploadFinanceEvidence.single('file'),
  uploadDisputeEvidenceController
);

export default clinicFinanceRouter;

export const apiDocs = [
  {
    method: 'get' as const,
    path: '/summary',
    description: 'Get clinic-scoped finance KPIs for a selected period',
    query: clinicFinanceDateRangeSchema,
    tags: ['Clinic Finance'],
  },
  {
    method: 'get' as const,
    path: '/revenue-breakdown',
    description: 'Get clinic revenue grouped by day, doctor, or service',
    query: revenueBreakdownQuerySchema,
    tags: ['Clinic Finance'],
  },
  {
    method: 'get' as const,
    path: '/settlements',
    description: 'Get paginated clinic bank settlements',
    query: settlementListQuerySchema,
    tags: ['Clinic Finance'],
  },
  {
    method: 'get' as const,
    path: '/settlements/:settlementId/statement',
    description: 'Download a completed settlement statement as PDF or CSV',
    params: settlementParamsSchema,
    query: settlementStatementQuerySchema,
    tags: ['Clinic Finance'],
  },
  {
    method: 'get' as const,
    path: '/statements/:month',
    description:
      'Download the monthly money statement (PDF) for a month like 2026-11',
    params: statementMonthParamsSchema,
    tags: ['Clinic Finance'],
  },
  {
    method: 'get' as const,
    path: '/refund-reviews',
    description: 'Get clinic refund review cases and supporting documents',
    tags: ['Clinic Finance'],
  },
  {
    method: 'post' as const,
    path: '/refund-reviews/:appointmentId/decision',
    description: 'Approve or decline a clinic refund review',
    params: refundReviewParamsSchema,
    requestSchema: refundReviewDecisionSchema,
    tags: ['Clinic Finance'],
  },
  {
    method: 'get' as const,
    path: '/disputes',
    description: 'Get paginated payment disputes and submitted evidence',
    query: disputeListQuerySchema,
    tags: ['Clinic Finance'],
  },
  {
    method: 'post' as const,
    path: '/disputes/:disputeId/evidence',
    description: 'Upload evidence for a dispute under review',
    contentType: 'multipart/form-data',
    params: disputeParamsSchema,
    tags: ['Clinic Finance'],
  },
];
