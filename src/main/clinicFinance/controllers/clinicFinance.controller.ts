import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { ClinicFinanceService } from '../services/clinicFinance.service';
import { DisputeService } from '../services/dispute.service';
import { RefundReviewService } from '../services/refundReview.service';
import { SettlementService } from '../services/settlement.service';
import { MonthlyStatementService } from '../services/monthlyStatement.service';
import { AppointmentPaymentsService } from '../../appointments/services/appointmentPayments.service';

export const getClinicFinanceSummaryController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await ClinicFinanceService.getSummary(
      req.clinicId,
      req.validatedQuery
    );
    return sendOk(res, 'Clinic finance summary retrieved successfully', result);
  }
);

export const getRevenueBreakdownController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await ClinicFinanceService.getRevenueBreakdown(
      req.clinicId,
      req.validatedQuery
    );
    return sendOk(
      res,
      'Clinic finance revenue breakdown retrieved successfully',
      result
    );
  }
);

export const getSettlementsController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await SettlementService.list(
      req.clinicId,
      req.validatedQuery
    );
    return sendOk(res, 'Clinic settlements retrieved successfully', result);
  }
);

export const downloadSettlementStatementController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await SettlementService.buildStatement(
      req.clinicId,
      req.validatedParams.settlementId,
      req.validatedQuery.format
    );
    res.setHeader('Content-Type', result.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`
    );
    return res.status(200).send(result.buffer);
  }
);

/** GET /statements/:month: the month's money as a PDF for the clinic's accountant. */
export const downloadMonthlyStatementController = asyncHandler(
  async (req: Request, res: Response) => {
    const { buffer, filename } = await MonthlyStatementService.build(
      req.clinicId,
      req.validatedParams.month
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(buffer);
  }
);

export const getRefundReviewsController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await RefundReviewService.list(req.clinicId);
    return sendOk(res, 'Refund reviews retrieved successfully', result);
  }
);

export const decideRefundReviewController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await RefundReviewService.decide(
      req.clinicId,
      req.validatedParams.appointmentId,
      req.user.id,
      req.validatedBody
    );
    return sendOk(res, 'Refund review decision processed successfully', result);
  }
);

export const getDisputesController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await DisputeService.list(req.clinicId, req.validatedQuery);
    return sendOk(res, 'Payment disputes retrieved successfully', result);
  }
);

export const uploadDisputeEvidenceController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await DisputeService.uploadEvidence(
      req.clinicId,
      req.validatedParams.disputeId,
      req.user.id,
      req.file
    );
    return sendOk(res, 'Dispute evidence uploaded successfully', result);
  }
);

/** Every money movement in the clinic (appointments and treatment plans); doctors see their own. */
export const getTransactionsController = asyncHandler(
  async (req: Request, res: Response) => {
    const result =
      await AppointmentPaymentsService.getAppointmentPaymentTransactions(
        req.validatedQuery,
        req.user,
        req.clinicId
      );
    return res.status(200).json({
      success: true,
      data: result.data,
      summary: result.summary,
      metadata: result.metadata,
    });
  }
);
