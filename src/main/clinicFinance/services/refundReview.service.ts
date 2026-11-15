import { and, desc, eq, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { AppointmentPaymentModel } from '../../appointments/models/appointment-payment.model';
import { AppointmentMoneySync } from '../../appointments/services/appointmentMoneySync.service';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import {
  CancellationRefundModel,
  CancellationRequestModel,
} from '../../cancellation-policy/models/cancellationPolicy.model';
import { PaymentStrategyFactory } from '../../payment/factory/paymentStrategy.factory';
import { PaymentTransactionModel } from '../../payment/models/paymentTransaction.model';
import { UserModel } from '../../users/models/user.model';
import {
  RefundReviewDocumentModel,
  RefundReviewModel,
} from '../models/refundReview.model';
import { money } from '../utils/clinicFinanceAmounts.utils';

export class RefundReviewService {
  static async list(clinicId: string) {
    const patient = alias(UserModel, 'refund_review_patient');
    const doctor = alias(UserModel, 'refund_review_doctor');
    const rows = await database
      .select({
        id: RefundReviewModel.id,
        appointmentId: RefundReviewModel.appointmentId,
        reasonCategory: RefundReviewModel.reasonCategory,
        policyReference: RefundReviewModel.policyReference,
        amount: RefundReviewModel.amount,
        status: RefundReviewModel.status,
        patientNote: RefundReviewModel.patientNote,
        decision: RefundReviewModel.decision,
        decisionNote: RefundReviewModel.decisionNote,
        failureReason: RefundReviewModel.failureReason,
        appointmentTime: AppointmentModel.appointmentDate,
        cancelledTime: CancellationRequestModel.createdAt,
        patient: patient.name,
        doctor: doctor.name,
        reviewedAt: RefundReviewModel.reviewedAt,
        createdAt: RefundReviewModel.createdAt,
      })
      .from(RefundReviewModel)
      .innerJoin(
        AppointmentModel,
        eq(AppointmentModel.id, RefundReviewModel.appointmentId)
      )
      .innerJoin(
        CancellationRequestModel,
        eq(CancellationRequestModel.id, RefundReviewModel.cancellationRequestId)
      )
      .leftJoin(patient, eq(patient.id, AppointmentModel.patientId))
      .leftJoin(doctor, eq(doctor.id, AppointmentModel.doctorId))
      .where(eq(RefundReviewModel.clinicId, clinicId))
      .orderBy(
        desc(RefundReviewModel.status),
        desc(RefundReviewModel.createdAt)
      );

    const reviewIds = rows.map((row) => row.id);
    const documents = reviewIds.length
      ? await database
          .select()
          .from(RefundReviewDocumentModel)
          .where(inArray(RefundReviewDocumentModel.refundReviewId, reviewIds))
      : [];

    return rows.map((row) => ({
      ...row,
      amount: money(row.amount),
      supportingDocs: documents
        .filter((document) => document.refundReviewId === row.id)
        .map((document) => ({
          id: document.id,
          filename: document.originalFilename,
          url: document.storageUrl,
          mimeType: document.mimeType,
        })),
      actionsAvailable: row.status === 'PENDING',
    }));
  }

  static async decide(
    clinicId: string,
    appointmentId: string,
    reviewerId: string,
    payload: { decision: 'approved' | 'declined'; note?: string }
  ) {
    const [review] = await database
      .select()
      .from(RefundReviewModel)
      .where(
        and(
          eq(RefundReviewModel.clinicId, clinicId),
          eq(RefundReviewModel.appointmentId, appointmentId)
        )
      )
      .limit(1);

    if (!review) throw new HttpError(404, 'Refund review not found');
    if (review.status === 'RESOLVED') {
      return {
        appointmentId,
        status: review.status,
        decision: review.decision,
        alreadyResolved: true,
      };
    }
    if (review.status !== 'PENDING' && review.status !== 'FAILED') {
      throw new HttpError(409, 'Refund review is already being processed');
    }

    if (payload.decision === 'declined') {
      const resolved = await database.transaction(async (tx) => {
        const updated = await tx
          .update(RefundReviewModel)
          .set({
            status: 'RESOLVED',
            decision: 'DECLINED',
            decisionNote: payload.note || null,
            reviewedBy: reviewerId,
            reviewedAt: new Date(),
            failureReason: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(RefundReviewModel.id, review.id),
              inArray(RefundReviewModel.status, ['PENDING', 'FAILED'])
            )
          )
          .returning();
        if (!updated[0]) {
          throw new HttpError(409, 'Refund review was already updated');
        }
        if (review.cancellationRefundId) {
          await tx
            .update(CancellationRefundModel)
            .set({
              refundStatus: 'Declined',
              failureReason: payload.note || 'Declined by clinic reviewer',
              updatedAt: new Date(),
            })
            .where(eq(CancellationRefundModel.id, review.cancellationRefundId));
        }
        return updated[0];
      });

      return {
        appointmentId,
        status: resolved.status,
        decision: resolved.decision,
      };
    }

    const [claimed] = await database
      .update(RefundReviewModel)
      .set({
        status: 'PROCESSING',
        decision: 'APPROVED',
        decisionNote: payload.note || null,
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        failureReason: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(RefundReviewModel.id, review.id),
          inArray(RefundReviewModel.status, ['PENDING', 'FAILED'])
        )
      )
      .returning();

    if (!claimed) throw new HttpError(409, 'Refund review was already updated');

    const [payment] = await database
      .select()
      .from(AppointmentPaymentModel)
      .where(eq(AppointmentPaymentModel.appointmentId, appointmentId))
      .limit(1);
    if (!payment) {
      await this.markFailed(review.id, 'Appointment payment record not found');
      throw new HttpError(409, 'Appointment payment record not found');
    }

    let refundId = review.cancellationRefundId;
    if (!refundId) {
      const [refund] = await database
        .insert(CancellationRefundModel)
        .values({
          cancellationRequestId: review.cancellationRequestId,
          appointmentId,
          clinicId,
          paymentId: payment.id,
          refundType:
            money(review.amount) >=
            money(payment.primaryServicePrice || payment.price)
              ? 'Full'
              : 'Partial',
          originalPrice: payment.price || '0',
          refundAmount: String(money(review.amount)),
          refundStatus: 'Pending',
        })
        .returning();
      refundId = refund.id;
      await database
        .update(RefundReviewModel)
        .set({ cancellationRefundId: refund.id, updatedAt: new Date() })
        .where(eq(RefundReviewModel.id, review.id));
    }

    const isOnline =
      Boolean(payment.transactionId) ||
      ['online', 'razorpay', 'cashfree'].includes(
        payment.paymentMode?.toLowerCase() || ''
      );

    if (!isOnline || !payment.transactionId) {
      await database.transaction(async (tx) => {
        await tx
          .update(CancellationRefundModel)
          .set({ refundStatus: 'Pending', updatedAt: new Date() })
          .where(eq(CancellationRefundModel.id, refundId!));
        await tx
          .update(RefundReviewModel)
          .set({ status: 'RESOLVED', updatedAt: new Date() })
          .where(eq(RefundReviewModel.id, review.id));
      });
      return {
        appointmentId,
        status: 'RESOLVED',
        decision: 'APPROVED',
        refundStatus: 'Pending',
      };
    }

    const [persistedRefund] = await database
      .select({
        gatewayRefundId: CancellationRefundModel.gatewayRefundId,
        gatewayResponse: CancellationRefundModel.gatewayResponse,
        refundStatus: CancellationRefundModel.refundStatus,
      })
      .from(CancellationRefundModel)
      .where(eq(CancellationRefundModel.id, refundId))
      .limit(1);

    let gatewayRefund:
      | {
          refundId: string;
          status: 'PROCESSED' | 'PENDING' | 'FAILED';
          rawResponse?: unknown;
        }
      | undefined;
    let gatewayResultPersisted = Boolean(persistedRefund?.gatewayRefundId);
    let gatewayAccepted = false;

    try {
      const [paymentTransaction] = payment.gatewayOrderId
        ? await database
            .select({ provider: PaymentTransactionModel.paymentProvider })
            .from(PaymentTransactionModel)
            .where(
              eq(PaymentTransactionModel.gatewayOrderId, payment.gatewayOrderId)
            )
            .limit(1)
        : [];
      const adapter = PaymentStrategyFactory.getStrategy(
        paymentTransaction?.provider || 'razorpay'
      );
      gatewayRefund = persistedRefund?.gatewayRefundId
        ? {
            refundId: persistedRefund.gatewayRefundId,
            status:
              persistedRefund.refundStatus === 'Completed'
                ? 'PROCESSED'
                : 'PENDING',
            rawResponse: persistedRefund.gatewayResponse || undefined,
          }
        : await adapter.processRefund({
            gatewayPaymentId: payment.transactionId,
            amount: money(review.amount),
            reverseAllTransfers: true,
            notes: {
              appointmentId,
              refundReviewId: review.id,
            },
          });

      if (gatewayRefund.status === 'FAILED') {
        gatewayRefund = undefined;
        throw new Error('Payment provider rejected the refund');
      }
      gatewayAccepted = true;
      const acceptedRefund = gatewayRefund;

      if (!gatewayResultPersisted) {
        await database
          .update(CancellationRefundModel)
          .set({
            refundStatus:
              acceptedRefund.status === 'PROCESSED'
                ? 'Completed'
                : 'Processing',
            gatewayRefundId: acceptedRefund.refundId,
            gatewayResponse: acceptedRefund.rawResponse || null,
            failureReason: null,
            updatedAt: new Date(),
          })
          .where(eq(CancellationRefundModel.id, refundId));
        gatewayResultPersisted = true;
      }

      await database.transaction(async (tx) => {
        await tx
          .update(CancellationRefundModel)
          .set({
            refundStatus:
              acceptedRefund.status === 'PROCESSED'
                ? 'Completed'
                : 'Processing',
            gatewayRefundId: acceptedRefund.refundId,
            gatewayResponse: acceptedRefund.rawResponse || null,
            failureReason: null,
            updatedAt: new Date(),
          })
          .where(eq(CancellationRefundModel.id, refundId!));
        await tx
          .update(AppointmentPaymentModel)
          .set({
            paymentStatus:
              acceptedRefund.status === 'PROCESSED'
                ? 'Refunded'
                : payment.paymentStatus,
            updatedAt: new Date(),
          })
          .where(eq(AppointmentPaymentModel.id, payment.id));
        // Money moves only once the gateway has processed it, with the refund's own id.
        await AppointmentMoneySync.afterChange(
          tx,
          appointmentId,
          reviewerId,
          acceptedRefund.status === 'PROCESSED'
            ? {
                move: {
                  kind: 'refund',
                  amountPaise: Math.round(money(review.amount) * 100),
                  paymentMode: adapter.providerName,
                  channel: 'online',
                  gatewayRef: acceptedRefund.refundId,
                  reason: `Refund review ${review.id}`,
                  requestId: `razorpay:refund:${acceptedRefund.refundId}`,
                },
              }
            : { chargesOnly: true }
        );
        await tx
          .update(RefundReviewModel)
          .set({ status: 'RESOLVED', updatedAt: new Date() })
          .where(eq(RefundReviewModel.id, review.id));
      });

      return {
        appointmentId,
        status: 'RESOLVED',
        decision: 'APPROVED',
        refundStatus:
          acceptedRefund.status === 'PROCESSED' ? 'Completed' : 'Processing',
        providerRefundId: acceptedRefund.refundId,
        gatewayRefundId: acceptedRefund.refundId,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Refund processing failed';
      if (gatewayAccepted && !gatewayResultPersisted) {
        await database
          .update(RefundReviewModel)
          .set({
            status: 'PROCESSING',
            failureReason: `Gateway accepted the refund but local persistence failed: ${message}`,
            updatedAt: new Date(),
          })
          .where(eq(RefundReviewModel.id, review.id));
      } else {
        await this.markFailed(review.id, message);
        if (!gatewayAccepted) {
          await database
            .update(CancellationRefundModel)
            .set({
              refundStatus: 'Failed',
              failureReason: message,
              updatedAt: new Date(),
            })
            .where(eq(CancellationRefundModel.id, refundId));
        }
      }
      throw new HttpError(502, `Refund processing failed: ${message}`);
    }
  }

  private static async markFailed(reviewId: string, reason: string) {
    await database
      .update(RefundReviewModel)
      .set({ status: 'FAILED', failureReason: reason, updatedAt: new Date() })
      .where(eq(RefundReviewModel.id, reviewId));
  }
}
