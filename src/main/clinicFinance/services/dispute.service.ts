import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { uploadBufferToS3 } from '../../../configurations/s3/client';
import { HttpError } from '../../../middlewear/errorHandler';
import {
  PaymentDisputeEvidenceModel,
  PaymentDisputeModel,
} from '../models/paymentDispute.model';
import { financeEvidenceKey } from '../utils/financeUpload.utils';
import { money } from '../utils/clinicFinanceAmounts.utils';

export class DisputeService {
  static async list(
    clinicId: string,
    query: { page: number; pageSize: number; status?: string }
  ) {
    const conditions = [eq(PaymentDisputeModel.clinicId, clinicId)];
    if (query.status) {
      conditions.push(eq(PaymentDisputeModel.status, query.status));
    }
    const offset = (query.page - 1) * query.pageSize;
    const [rows, totalRows] = await Promise.all([
      database
        .select()
        .from(PaymentDisputeModel)
        .where(and(...conditions))
        .orderBy(desc(PaymentDisputeModel.filedAt))
        .limit(query.pageSize)
        .offset(offset),
      database
        .select({ total: count() })
        .from(PaymentDisputeModel)
        .where(and(...conditions)),
    ]);
    const disputeIds = rows.map((row) => row.id);
    const evidence = disputeIds.length
      ? await database
          .select()
          .from(PaymentDisputeEvidenceModel)
          .where(inArray(PaymentDisputeEvidenceModel.disputeId, disputeIds))
      : [];
    const total = Number(totalRows[0]?.total || 0);

    return {
      data: rows.map((row) => ({
        id: row.id,
        provider: row.paymentProvider,
        providerDisputeId: row.providerDisputeId,
        appointmentId: row.appointmentId,
        amount: money(row.amount),
        filedDate: row.filedAt,
        reason: row.reason,
        status: row.status.toLowerCase(),
        resolutionParty: row.resolutionParty,
        resolvedAt: row.resolvedAt,
        evidence: evidence
          .filter((item) => item.disputeId === row.id)
          .map((item) => ({
            id: item.id,
            filename: item.filename,
            mimeType: item.mimeType,
            url: item.storageUrl,
          })),
        evidenceUploadAllowed: row.status === 'UNDER_REVIEW',
      })),
      metadata: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  static async uploadEvidence(
    clinicId: string,
    disputeId: string,
    uploadedBy: string,
    file: Express.Multer.File | undefined
  ) {
    if (!file) throw new HttpError(400, 'Evidence file is required');

    const [dispute] = await database
      .select()
      .from(PaymentDisputeModel)
      .where(
        and(
          eq(PaymentDisputeModel.id, disputeId),
          eq(PaymentDisputeModel.clinicId, clinicId)
        )
      )
      .limit(1);

    if (!dispute) throw new HttpError(404, 'Dispute not found');
    if (dispute.status !== 'UNDER_REVIEW') {
      throw new HttpError(
        409,
        'Evidence can only be added to disputes under review'
      );
    }

    const storageUrl = await uploadBufferToS3(
      file.buffer,
      financeEvidenceKey(clinicId, disputeId, file.originalname),
      file.mimetype
    );
    const [evidence] = await database
      .insert(PaymentDisputeEvidenceModel)
      .values({
        disputeId,
        clinicId,
        storageUrl,
        filename: file.originalname,
        mimeType: file.mimetype,
        uploadedBy,
      })
      .returning();

    return {
      id: evidence.id,
      disputeId,
      filename: evidence.filename,
      mimeType: evidence.mimeType,
      url: evidence.storageUrl,
    };
  }

  static async upsertFromProvider(input: {
    clinicId: string;
    appointmentId: string;
    appointmentPaymentId: string;
    paymentProvider: string;
    providerDisputeId: string;
    amount: number;
    reason: string;
    status: string;
    resolutionParty?: string | null;
    filedAt: Date;
    resolvedAt?: Date | null;
    providerResponse?: Record<string, unknown>;
  }) {
    const [existing] = await database
      .select({ id: PaymentDisputeModel.id })
      .from(PaymentDisputeModel)
      .where(
        and(
          eq(PaymentDisputeModel.paymentProvider, input.paymentProvider),
          eq(PaymentDisputeModel.providerDisputeId, input.providerDisputeId)
        )
      )
      .limit(1);

    if (existing) {
      const [updated] = await database
        .update(PaymentDisputeModel)
        .set({
          status: input.status,
          reason: input.reason,
          amount: String(input.amount),
          resolutionParty: input.resolutionParty || null,
          resolvedAt: input.resolvedAt || null,
          providerResponse: input.providerResponse || null,
          updatedAt: new Date(),
        })
        .where(eq(PaymentDisputeModel.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await database
      .insert(PaymentDisputeModel)
      .values({
        clinicId: input.clinicId,
        appointmentId: input.appointmentId,
        appointmentPaymentId: input.appointmentPaymentId,
        paymentProvider: input.paymentProvider,
        providerDisputeId: input.providerDisputeId,
        amount: String(input.amount),
        reason: input.reason,
        status: input.status,
        resolutionParty: input.resolutionParty || null,
        filedAt: input.filedAt,
        resolvedAt: input.resolvedAt || null,
        providerResponse: input.providerResponse || null,
      })
      .returning();
    return created;
  }
}
