import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { AppointmentPaymentModel } from '../../appointments/models/appointment-payment.model';
import { UserModel } from '../../users/models/user.model';
import { ClinicBankHistoryModel } from '../../clinic/models/clinicBankHistory.model';
import {
  ClinicSettlementItemModel,
  ClinicSettlementModel,
} from '../models/clinicSettlement.model';
import {
  buildSettlementCsv,
  buildSettlementPdf,
} from '../utils/settlementStatement.utils';
import {
  isOnlinePaymentCondition,
  money,
} from '../utils/clinicFinanceAmounts.utils';
import { istDayBoundsUtc } from '../../../utils/istDateTime';
import { expectedPayoutDate } from '../utils/payoutTiming.utils';

export class SettlementService {
  static async upsertFromProvider(input: {
    clinicId: string;
    paymentProvider: string;
    providerSettlementId: string;
    gatewayAccountId?: string | null;
    cycleStart: Date;
    cycleEnd: Date;
    amount: number;
    status: 'COMPLETED' | 'PROCESSING' | 'FAILED';
    failureReason?: string | null;
    expectedSettlementAt?: Date | null;
    settledAt?: Date | null;
    gatewayResponse?: Record<string, unknown>;
    items: Array<{
      appointmentPaymentId: string;
      appointmentId: string;
      providerTransferId?: string | null;
      clinicAmount: number;
      reversedAmount?: number;
      status: string;
    }>;
  }) {
    return database.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: ClinicSettlementModel.id })
        .from(ClinicSettlementModel)
        .where(
          and(
            eq(ClinicSettlementModel.paymentProvider, input.paymentProvider),
            eq(
              ClinicSettlementModel.providerSettlementId,
              input.providerSettlementId
            )
          )
        )
        .limit(1);

      const values = {
        clinicId: input.clinicId,
        paymentProvider: input.paymentProvider,
        providerSettlementId: input.providerSettlementId,
        gatewayAccountId: input.gatewayAccountId || null,
        cycleStart: input.cycleStart,
        cycleEnd: input.cycleEnd,
        amount: String(input.amount),
        status: input.status,
        failureReason: input.failureReason || null,
        expectedSettlementAt: input.expectedSettlementAt || null,
        settledAt: input.settledAt || null,
        gatewayResponse: input.gatewayResponse || null,
        updatedAt: new Date(),
      };
      const [settlement] = existing
        ? await tx
            .update(ClinicSettlementModel)
            .set(values)
            .where(eq(ClinicSettlementModel.id, existing.id))
            .returning()
        : await tx.insert(ClinicSettlementModel).values(values).returning();

      for (const item of input.items) {
        const [existingItem] = await tx
          .select({ id: ClinicSettlementItemModel.id })
          .from(ClinicSettlementItemModel)
          .where(
            and(
              eq(ClinicSettlementItemModel.settlementId, settlement.id),
              eq(
                ClinicSettlementItemModel.appointmentPaymentId,
                item.appointmentPaymentId
              )
            )
          )
          .limit(1);
        const itemValues = {
          settlementId: settlement.id,
          clinicId: input.clinicId,
          paymentProvider: input.paymentProvider,
          appointmentPaymentId: item.appointmentPaymentId,
          appointmentId: item.appointmentId,
          providerTransferId: item.providerTransferId || null,
          clinicAmount: String(item.clinicAmount),
          reversedAmount: String(item.reversedAmount || 0),
          status: item.status,
          updatedAt: new Date(),
        };

        if (existingItem) {
          await tx
            .update(ClinicSettlementItemModel)
            .set(itemValues)
            .where(eq(ClinicSettlementItemModel.id, existingItem.id));
        } else {
          await tx.insert(ClinicSettlementItemModel).values(itemValues);
        }
      }

      return settlement;
    });
  }

  static async list(
    clinicId: string,
    query: {
      page: number;
      pageSize: number;
      status?: string;
      startDate?: string;
      endDate?: string;
    }
  ) {
    const conditions = [eq(ClinicSettlementModel.clinicId, clinicId)];
    if (query.status) {
      conditions.push(eq(ClinicSettlementModel.status, query.status));
    }
    // The range filter below runs in SQL too, so a clinic's whole history isn't read for one month.
    const range =
      query.startDate && query.endDate
        ? {
            start: istDayBoundsUtc(query.startDate).start,
            end: istDayBoundsUtc(query.endDate).end,
          }
        : null;
    if (range)
      conditions.push(
        gte(ClinicSettlementModel.cycleEnd, range.start),
        lte(ClinicSettlementModel.cycleEnd, range.end)
      );
    // ISO strings: raw SQL through postgres-js cannot bind a Date (the query fails and the list comes back empty).
    const from = range?.start.toISOString();
    const to = range?.end.toISOString();
    const paidIn = range
      ? sql`AND ${AppointmentPaymentModel.createdAt} BETWEEN ${from} AND ${to}`
      : sql``;
    const enteredIn = range
      ? sql`AND e.created_at BETWEEN ${from} AND ${to}`
      : sql``;

    const dbRows = await database
      .select()
      .from(ClinicSettlementModel)
      .where(and(...conditions))
      .orderBy(desc(ClinicSettlementModel.cycleEnd));

    const settlementIds = dbRows.map((r) => r.id);
    const itemsBySettlement: Record<
      string,
      Array<{
        id: string;
        paymentRecordId: string | null;
        provider: string;
        providerPaymentId: string | null;
        paymentId: string | null;
        transactionId: string | null;
        providerTransferId: string | null;
        patientName: string;
        amount: number;
        transferAmount: number;
        paymentStatus: string | null;
        createdAt?: Date | string;
      }>
    > = {};

    if (settlementIds.length > 0) {
      try {
        const itemRows = await database
          .select({
            settlementId: ClinicSettlementItemModel.settlementId,
            id: ClinicSettlementItemModel.id,
            paymentRecordId: AppointmentPaymentModel.id,
            paymentProvider: ClinicSettlementItemModel.paymentProvider,
            providerTransferId: ClinicSettlementItemModel.providerTransferId,
            providerPaymentId: AppointmentPaymentModel.transactionId,
            patientAmount: AppointmentPaymentModel.price,
            paymentStatus: AppointmentPaymentModel.paymentStatus,
            clinicAmount: ClinicSettlementItemModel.clinicAmount,
            reversedAmount: ClinicSettlementItemModel.reversedAmount,
            patientName: UserModel.name,
            createdAt: ClinicSettlementItemModel.createdAt,
          })
          .from(ClinicSettlementItemModel)
          .leftJoin(
            AppointmentPaymentModel,
            eq(
              AppointmentPaymentModel.id,
              ClinicSettlementItemModel.appointmentPaymentId
            )
          )
          .leftJoin(
            AppointmentModel,
            eq(AppointmentModel.id, ClinicSettlementItemModel.appointmentId)
          )
          .leftJoin(UserModel, eq(UserModel.id, AppointmentModel.patientId))
          .where(
            and(
              eq(ClinicSettlementItemModel.clinicId, clinicId),
              inArray(ClinicSettlementItemModel.settlementId, settlementIds)
            )
          );

        for (const item of itemRows) {
          if (!itemsBySettlement[item.settlementId]) {
            itemsBySettlement[item.settlementId] = [];
          }
          itemsBySettlement[item.settlementId].push({
            id: item.id,
            paymentRecordId: item.paymentRecordId,
            provider: item.paymentProvider,
            providerPaymentId: item.providerPaymentId,
            paymentId: item.providerPaymentId,
            transactionId: item.providerPaymentId,
            providerTransferId: item.providerTransferId,
            patientName: item.patientName || 'Patient',
            amount: money(item.patientAmount ?? item.clinicAmount),
            transferAmount: money(
              Math.max(
                Number(item.clinicAmount || 0) -
                  Number(item.reversedAmount || 0),
                0
              )
            ),
            paymentStatus: item.paymentStatus,
            createdAt: item.createdAt,
          });
        }
      } catch (err) {
        console.warn('Could not load settlement items:', err);
      }
    }

    const mappedDbRows = dbRows.map((row) => {
      const gw = (row.gatewayResponse as Record<string, unknown>) || {};
      const payload = (gw.payload as Record<string, unknown>) || {};
      const settlementPayload =
        (payload.settlement as Record<string, unknown>) || {};
      const settlementEntity =
        (settlementPayload.entity as Record<string, unknown>) || {};
      const utr =
        (settlementEntity.utr as string) ||
        (settlementEntity.bank_ref_no as string) ||
        (gw.utr as string) ||
        (gw.bank_ref_no as string) ||
        null;
      const list = itemsBySettlement[row.id] || [];
      // Provider gross values can include patient-borne fees. The clinic ledger
      // item amounts are the clinic's transferred share and are authoritative.
      const clinicGross = money(
        list.reduce((sum, item) => sum + item.transferAmount, 0)
      );
      return {
        id: row.id,
        provider: row.paymentProvider,
        settlementId: row.providerSettlementId || null,
        cycleId: null,
        providerSettlementId: row.providerSettlementId,
        subMerchantId: row.gatewayAccountId,
        settlementDate: row.settledAt || row.expectedSettlementAt,
        expectedSettlementDate: row.expectedSettlementAt || row.settledAt,
        cycleStart: row.cycleStart,
        cycleEnd: row.cycleEnd,
        amount: money(row.amount),
        grossAmount: list.length > 0 ? clinicGross : money(row.amount),
        paymentsCount: list.length || 1,
        paymentsList: list,
        utr: utr,
        status: row.status.toLowerCase(),
        failureReason: row.failureReason,
        statementAvailable: row.status === 'COMPLETED',
      };
    });

    // Unsettled online payments grouped by capture date (daily settlement cycle T -> T+2)
    const unsettledDailyCycles: Array<{
      id: null;
      cycleId: string;
      settlementId: string | null;
      providerSettlementId: string | null;
      subMerchantId: string | null;
      settlementDate: Date;
      expectedSettlementDate: Date;
      cycleStart: Date;
      cycleEnd: Date;
      amount: number;
      onHoldAmount: number;
      grossAmount: number;
      paymentsCount: number;
      paymentsList: Array<{
        id: string | null;
        paymentRecordId: string | null;
        provider: string | null;
        providerPaymentId: string | null;
        paymentId: string | null;
        transactionId: string | null;
        providerTransferId: string | null;
        patientName: string;
        amount: number;
        transferAmount: number;
        transferStatus: string | null;
        transferOnHold: boolean;
        transferFailureReason: string | null;
        paymentStatus: string | null;
        createdAt?: Date | string;
      }>;
      utr: string | null;
      status: string;
      failureReason: string | null;
      statementAvailable: boolean;
    }> = [];

    try {
      const unsettledRows = await database.execute(sql`
        WITH appointment_ledger AS (
          SELECT
            e.source_id AS appointment_id,
            SUM(CASE
              WHEN e.entry_type = 'payment' THEN e.amount_paise
              WHEN e.entry_type = 'refund' THEN -e.amount_paise
              WHEN e.entry_type = 'adjustment' AND reversed.entry_type = 'payment'
                THEN -e.amount_paise
              WHEN e.entry_type = 'adjustment' AND reversed.entry_type = 'refund'
                THEN e.amount_paise
              ELSE 0
            END) AS net_paise,
            SUM(CASE
              WHEN e.entry_type = 'payment' THEN e.amount_paise
              WHEN e.entry_type = 'adjustment' AND reversed.entry_type = 'payment'
                THEN -e.amount_paise
              ELSE 0
            END) AS gross_paise
          FROM money_entries e
          LEFT JOIN money_entries reversed ON reversed.id = e.reverses_entry_id
          WHERE e.clinic_id = ${clinicId}
            AND e.account = 'clinic'
            AND e.source_type = 'appointment'
            AND e.channel = 'online'
          GROUP BY e.source_id
          HAVING SUM(CASE
            WHEN e.entry_type = 'payment' THEN e.amount_paise
            WHEN e.entry_type = 'adjustment' AND reversed.entry_type = 'payment'
              THEN -e.amount_paise
            ELSE 0
          END) > 0
        )
        SELECT
          DATE(${AppointmentPaymentModel.createdAt}) AS capture_date,
          COUNT(${AppointmentPaymentModel.id}) AS payment_count,
          COALESCE(SUM(appointment_ledger.net_paise), 0) / 100 AS total_amount,
          COALESCE(SUM(appointment_ledger.gross_paise), 0) / 100 AS gross_amount,
          MIN(${AppointmentPaymentModel.createdAt}) AS earliest_capture,
          MAX(${AppointmentPaymentModel.createdAt}) AS latest_capture,
          json_agg(
            json_build_object(
              'paymentRecordId', ${AppointmentPaymentModel.id},
              'providerPaymentId', ${AppointmentPaymentModel.transactionId},
              'transfersData', ${AppointmentPaymentModel.transfersData},
              'patientAmount', ${AppointmentPaymentModel.price}::numeric,
              'transferAmount', appointment_ledger.net_paise::numeric / 100,
              'paymentStatus', ${AppointmentPaymentModel.paymentStatus},
              'patientName', COALESCE(${UserModel.name}, 'Patient'),
              'createdAt', ${AppointmentPaymentModel.createdAt}
            ) ORDER BY ${AppointmentPaymentModel.createdAt} ASC
          ) AS payments
        FROM ${AppointmentPaymentModel}
        JOIN ${AppointmentModel} ON ${AppointmentModel.id} = ${AppointmentPaymentModel.appointmentId}
        JOIN ${UserModel} ON ${UserModel.id} = ${AppointmentModel.patientId}
        JOIN appointment_ledger ON appointment_ledger.appointment_id = ${AppointmentModel.id}
        LEFT JOIN ${ClinicSettlementItemModel} ON ${ClinicSettlementItemModel.appointmentId} = ${AppointmentModel.id}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          AND LOWER(COALESCE(${AppointmentPaymentModel.paymentStatus}, ''))
            IN ('paid', 'refunded', 'partly refunded')
          AND (${isOnlinePaymentCondition()})
          AND ${ClinicSettlementItemModel.id} IS NULL
          ${paidIn}
        GROUP BY DATE(${AppointmentPaymentModel.createdAt})
        ORDER BY capture_date DESC
      `);

      let rawGrouped = unsettledRows as unknown as Record<string, unknown>[];

      // Fallback to money_entries if appointment_payments has no unsettled records
      if (rawGrouped.length === 0) {
        const moneyRows = await database.execute(sql`
          SELECT
            DATE(e.created_at) AS capture_date,
            COUNT(e.id) AS payment_count,
            COALESCE(SUM(CASE
              WHEN e.entry_type = 'payment' THEN e.amount_paise
              WHEN e.entry_type = 'refund' THEN -e.amount_paise
              WHEN e.entry_type = 'adjustment' AND target.entry_type = 'payment' THEN -e.amount_paise
              WHEN e.entry_type = 'adjustment' AND target.entry_type = 'refund' THEN e.amount_paise
              ELSE 0 END)::numeric / 100, 0) AS total_amount,
            COALESCE(SUM(CASE
              WHEN e.entry_type = 'payment' THEN e.amount_paise
              WHEN e.entry_type = 'adjustment' AND target.entry_type = 'payment' THEN -e.amount_paise
              ELSE 0 END)::numeric / 100, 0) AS gross_amount,
            MIN(e.created_at) AS earliest_capture,
            MAX(e.created_at) AS latest_capture
          FROM money_entries e
          LEFT JOIN money_entries target ON target.id = e.reverses_entry_id
          LEFT JOIN ${ClinicSettlementItemModel} csi ON csi.appointment_id = e.source_id
          WHERE e.clinic_id = ${clinicId}
            AND e.account = 'clinic'
            AND e.source_type = 'appointment'
            AND e.channel = 'online'
            AND e.entry_type IN ('payment', 'refund', 'adjustment')
            AND csi.id IS NULL
            ${enteredIn}
          GROUP BY DATE(e.created_at)
          ORDER BY capture_date DESC
        `);
        rawGrouped = moneyRows as unknown as Record<string, unknown>[];
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const [destination] = await database
        .select({ bankName: ClinicBankHistoryModel.bankName })
        .from(ClinicBankHistoryModel)
        .where(
          and(
            eq(ClinicBankHistoryModel.clinicId, clinicId),
            eq(ClinicBankHistoryModel.isActive, true)
          )
        )
        .limit(1);
      const paysToUpi = destination?.bankName === 'UPI';

      rawGrouped.forEach((row) => {
        const captureDateStr = String(row.capture_date);
        const countNum = Number(row.payment_count || 0);
        const amountNum = money(row.total_amount || 0);
        if (amountNum <= 0 && countNum <= 0) return;

        const earliest = row.earliest_capture
          ? new Date(row.earliest_capture as string)
          : new Date(captureDateStr + 'T00:00:00Z');
        const latest = row.latest_capture
          ? new Date(row.latest_capture as string)
          : new Date(captureDateStr + 'T23:59:59Z');

        // Bank: Razorpay's T+2 working days. UPI: paid per payment within minutes (no T+N).
        const expDate = expectedPayoutDate(captureDateStr, paysToUpi);

        const expDateMidnight = new Date(expDate);
        expDateMidnight.setHours(0, 0, 0, 0);
        const diffDays = Math.round(
          (expDateMidnight.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)
        );

        // A forecast date passing does not confirm a bank settlement. Only a
        // provider settlement webhook creates a completed settlement record.
        let status: string;
        if (amountNum <= 0) {
          status = 'no_payout';
        } else if (diffDays >= 2) {
          status = 'scheduled';
        } else {
          // Keep expired estimates pending until a provider confirms settlement.
          status = 'processing';
        }

        const paymentsRaw = Array.isArray(row.payments) ? row.payments : [];
        const paymentsList = paymentsRaw.map((p: Record<string, unknown>) => {
          const transferRecords = Array.isArray(p.transfersData)
            ? (p.transfersData as Record<string, unknown>[])
            : [];
          const latestTransfer =
            transferRecords[transferRecords.length - 1] || {};
          return {
            id: null,
            paymentRecordId:
              typeof p.paymentRecordId === 'string' ? p.paymentRecordId : null,
            provider: null,
            providerPaymentId:
              typeof p.providerPaymentId === 'string'
                ? p.providerPaymentId
                : null,
            paymentId:
              typeof p.providerPaymentId === 'string'
                ? p.providerPaymentId
                : null,
            transactionId:
              typeof p.providerPaymentId === 'string'
                ? p.providerPaymentId
                : null,
            patientName: (p.patientName as string) || 'Patient',
            amount: money(Number(p.patientAmount) || 0),
            transferAmount: money(Number(p.transferAmount) || 0),
            providerTransferId:
              typeof latestTransfer.id === 'string' ? latestTransfer.id : null,
            transferStatus:
              typeof latestTransfer.status === 'string'
                ? latestTransfer.status
                : null,
            transferOnHold: latestTransfer.onHold === true,
            transferFailureReason:
              typeof latestTransfer.failureReason === 'string'
                ? latestTransfer.failureReason
                : null,
            paymentStatus:
              typeof p.paymentStatus === 'string' ? p.paymentStatus : null,
            createdAt: p.createdAt as string | Date | undefined,
          };
        });

        const heldAmount = money(
          paymentsList.reduce(
            (sum, payment) =>
              sum + (payment.transferOnHold ? payment.transferAmount : 0),
            0
          )
        );
        const failedAmount = money(
          paymentsList.reduce(
            (sum, payment) =>
              sum +
              (!payment.transferOnHold &&
              (payment.transferStatus === 'failed' ||
                payment.transferStatus === 'reversed')
                ? payment.transferAmount
                : 0),
            0
          )
        );
        const blockedAmount = money(heldAmount + failedAmount);
        if (amountNum > 0 && blockedAmount >= amountNum) {
          status = heldAmount > 0 ? 'on_hold' : 'failed';
        }

        unsettledDailyCycles.push({
          id: null,
          cycleId: `cycle-${captureDateStr}`,
          settlementId: null,
          providerSettlementId: null,
          subMerchantId: null,
          settlementDate: expDate,
          expectedSettlementDate: expDate,
          cycleStart: earliest,
          cycleEnd: latest,
          amount: amountNum,
          onHoldAmount: blockedAmount,
          grossAmount: money(row.gross_amount ?? row.total_amount ?? 0),
          paymentsCount: countNum,
          paymentsList,
          utr: null,
          status,
          failureReason: null,
          statementAvailable: false,
        });
      });
    } catch (err) {
      console.warn('Could not compute daily settlement cycles:', err);
    }

    // Combine recorded settlements and daily capture cycles
    const allCombined = [...mappedDbRows, ...unsettledDailyCycles].sort(
      (a, b) =>
        new Date(b.cycleEnd || b.settlementDate).getTime() -
        new Date(a.cycleEnd || a.settlementDate).getTime()
    );

    // Filter by cycle end (the payment-cycle date), consistently for recorded
    // settlements and synthetic daily cycles. Boundaries are inclusive in IST.
    const dateFiltered =
      query.startDate && query.endDate
        ? (() => {
            const start = istDayBoundsUtc(query.startDate).start.getTime();
            const end = istDayBoundsUtc(query.endDate).end.getTime();
            return allCombined.filter((item) => {
              const cycleEnd = new Date(item.cycleEnd).getTime();
              return cycleEnd >= start && cycleEnd <= end;
            });
          })()
        : allCombined;

    // Compute overall summary stats for KPI cards across all settlements
    let netSettled = 0;
    let settledCount = 0;
    let nextExpectedAmount = 0;
    let nextExpectedDate: Date | null = null;
    let onHoldAmount = 0;

    for (const item of dateFiltered) {
      const s = String(item.status || '').toLowerCase();
      const blockedAmount = money(
        Number((item as { onHoldAmount?: number }).onHoldAmount || 0)
      );
      if (s === 'completed' || s === 'processed') {
        netSettled = money(netSettled + item.amount);
        settledCount += 1;
      } else if (s === 'scheduled' || s === 'processing') {
        nextExpectedAmount = money(
          nextExpectedAmount + Math.max(item.amount - blockedAmount, 0)
        );
        if (!nextExpectedDate) {
          nextExpectedDate = item.expectedSettlementDate || item.settlementDate;
        }
      } else if (s === 'on hold' || s === 'on_hold' || s === 'failed') {
        onHoldAmount = money(onHoldAmount + (blockedAmount || item.amount));
      }
      if (
        blockedAmount > 0 &&
        s !== 'on hold' &&
        s !== 'on_hold' &&
        s !== 'failed'
      ) {
        onHoldAmount = money(onHoldAmount + blockedAmount);
      }
    }

    // Apply optional status filtering
    const filteredRows = query.status
      ? dateFiltered.filter(
          (r) => r.status.toLowerCase() === query.status?.toLowerCase()
        )
      : dateFiltered;

    const total = filteredRows.length;
    const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
    const offset = (query.page - 1) * query.pageSize;
    const paginatedData = filteredRows.slice(offset, offset + query.pageSize);

    return {
      data: paginatedData,
      summary: {
        netSettled,
        settledCount,
        nextExpectedAmount,
        nextExpectedDate,
        onHoldAmount,
      },
      metadata: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages,
      },
    };
  }

  static async buildStatement(
    clinicId: string,
    settlementId: string,
    format: 'pdf' | 'csv'
  ) {
    const [settlement] = await database
      .select()
      .from(ClinicSettlementModel)
      .where(
        and(
          eq(ClinicSettlementModel.id, settlementId),
          eq(ClinicSettlementModel.clinicId, clinicId)
        )
      )
      .limit(1);

    if (!settlement) throw new HttpError(404, 'Settlement not found');
    if (settlement.status !== 'COMPLETED') {
      throw new HttpError(
        409,
        'Statement is available only for completed settlements'
      );
    }

    const items = await database
      .select()
      .from(ClinicSettlementItemModel)
      .where(
        and(
          eq(ClinicSettlementItemModel.settlementId, settlement.id),
          eq(ClinicSettlementItemModel.clinicId, clinicId)
        )
      )
      .orderBy(asc(ClinicSettlementItemModel.createdAt));

    const settlementData = settlement as unknown as Record<string, unknown>;
    const itemData = items as unknown as Record<string, unknown>[];
    const buffer =
      format === 'csv'
        ? buildSettlementCsv(settlementData, itemData)
        : await buildSettlementPdf(settlementData, itemData);

    return {
      buffer,
      contentType:
        format === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf',
      filename: `settlement-${settlement.providerSettlementId}.${format}`,
    };
  }
}
