import { SQL, sql } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { AppointmentPaymentModel } from '../../appointments/models/appointment-payment.model';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { ClinicPaymentAccountModel } from '../../clinic/models/clinicPaymentAccount.model';
import { ClinicServiceModel } from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models/user.model';
import { FeeConfigVersionModel } from '../../payment/models/feeConfigVersion.model';
import {
  ClinicSettlementItemModel,
  ClinicSettlementModel,
} from '../models/clinicSettlement.model';
import { PaymentDisputeModel } from '../models/paymentDispute.model';
import {
  ClinicFinanceDateRangeDto,
  RevenueBreakdownQueryDto,
} from '../schemas/clinicFinance.schemas';
import {
  bookedPaymentCondition,
  isOfflinePaymentCondition,
  isOnlinePaymentCondition,
  money,
  patientPlatformFeeExpression,
} from '../utils/clinicFinanceAmounts.utils';
import {
  CLINIC_AMOUNT,
  HAS_RECEIVED_MONEY,
} from '../../dashboard/utils/revenueSql';
import { istDayBoundsUtc } from '../../../utils/istDateTime';
import { MoneyReadService } from '../../money';

/** IST day bounds as ISO strings, the form drizzle sends for a timestamp column; a raw Date would bind as timestamptz. */
function istRange(query: { startDate: string; endDate: string }) {
  return {
    start: istDayBoundsUtc(query.startDate).start.toISOString(),
    end: istDayBoundsUtc(query.endDate).end.toISOString(),
  };
}

export class ClinicFinanceService {
  static async getSummary(clinicId: string, query: ClinicFinanceDateRangeDto) {
    const { start, end } = istRange(query);
    const platformFee = patientPlatformFeeExpression();
    const isOnline = isOnlinePaymentCondition();
    const isOffline = isOfflinePaymentCondition();

    // Visit counts and the patient platform fee stay on visits; money comes from the ledger.
    const [
      aggregateRows,
      feeRows,
      payoutRows,
      settlementRows,
      settledPeriodRows,
      disputeHoldRows,
      settlementHoldRows,
      transferHoldRows,
      ledger,
      dues,
    ] = await Promise.all([
      database.execute(sql`
        SELECT
          COUNT(DISTINCT ${AppointmentModel.id}) FILTER (
            WHERE ${AppointmentModel.appointmentStatus} = 'Completed'
          ) AS completed_appointment_count,
          COUNT(DISTINCT ${AppointmentModel.id}) FILTER (
            WHERE ${AppointmentModel.appointmentStatus} = 'Completed' AND ${isOnline}
          ) AS online_completed_count,
          COUNT(DISTINCT ${AppointmentModel.id}) FILTER (
            WHERE ${AppointmentModel.appointmentStatus} = 'Completed' AND ${isOffline}
          ) AS offline_completed_count,
          COALESCE(SUM(CASE WHEN ${HAS_RECEIVED_MONEY} THEN ${platformFee} ELSE 0 END), 0) AS platform_fee
        FROM ${AppointmentModel}
        LEFT JOIN ${AppointmentPaymentModel}
          ON ${AppointmentPaymentModel.appointmentId} = ${AppointmentModel.id}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          AND ${AppointmentModel.appointmentDate} BETWEEN ${start} AND ${end}
      `),
      database.execute(sql`
        SELECT
          ${FeeConfigVersionModel.rateOrAmount} AS rate,
          ${FeeConfigVersionModel.feePayer} AS fee_payer,
          ${FeeConfigVersionModel.effectiveFrom} AS effective_from
        FROM ${FeeConfigVersionModel}
        WHERE ${FeeConfigVersionModel.feeType} = 'CLINIC_COMMISSION'
          AND ${FeeConfigVersionModel.enabled} = true
          AND ${FeeConfigVersionModel.isActive} = true
          AND ${FeeConfigVersionModel.effectiveFrom} <= NOW()
          AND (${FeeConfigVersionModel.effectiveTo} IS NULL OR ${FeeConfigVersionModel.effectiveTo} >= NOW())
          AND (${FeeConfigVersionModel.clinicId} = ${clinicId} OR ${FeeConfigVersionModel.clinicId} IS NULL)
        ORDER BY (${FeeConfigVersionModel.clinicId} IS NOT NULL) DESC,
          ${FeeConfigVersionModel.version} DESC
        LIMIT 1
      `),
      database.execute(sql`
        SELECT
          ${ClinicPaymentAccountModel.gatewayAccountId} AS account_id,
          ${ClinicPaymentAccountModel.routeStatus} AS route_status,
          ${ClinicPaymentAccountModel.routeOnboardingRejectionReason} AS rejection_reason
        FROM ${ClinicPaymentAccountModel}
        WHERE ${ClinicPaymentAccountModel.clinicId} = ${clinicId}
          AND ${ClinicPaymentAccountModel.paymentProvider} = 'razorpay'
        LIMIT 1
      `),
      database.execute(sql`
        SELECT
          COALESCE(SUM(CASE
            WHEN ${ClinicSettlementModel.status} = 'COMPLETED'
            THEN GREATEST(
              ${ClinicSettlementItemModel.clinicAmount}::numeric
                - ${ClinicSettlementItemModel.reversedAmount}::numeric,
              0
            )
            ELSE 0
          END), 0) AS already_received,
          MIN(${ClinicSettlementModel.expectedSettlementAt}) FILTER (
            WHERE ${ClinicSettlementModel.status} = 'PROCESSING'
          ) AS next_settlement_date,
          (
            SELECT ${ClinicSettlementModel.id}
            FROM ${ClinicSettlementModel}
            WHERE ${ClinicSettlementModel.clinicId} = ${clinicId}
              AND ${ClinicSettlementModel.status} = 'PROCESSING'
            ORDER BY ${ClinicSettlementModel.expectedSettlementAt} ASC
            LIMIT 1
          ) AS next_settlement_id,
          (
            SELECT ${ClinicSettlementModel.providerSettlementId}
            FROM ${ClinicSettlementModel}
            WHERE ${ClinicSettlementModel.clinicId} = ${clinicId}
              AND ${ClinicSettlementModel.status} = 'PROCESSING'
            ORDER BY ${ClinicSettlementModel.expectedSettlementAt} ASC
            LIMIT 1
          ) AS next_settlement_ref
        FROM ${ClinicSettlementItemModel}
        INNER JOIN ${ClinicSettlementModel}
          ON ${ClinicSettlementModel.id} = ${ClinicSettlementItemModel.settlementId}
        INNER JOIN ${AppointmentModel}
          ON ${AppointmentModel.id} = ${ClinicSettlementItemModel.appointmentId}
        INNER JOIN ${AppointmentPaymentModel}
          ON ${AppointmentPaymentModel.id} = ${ClinicSettlementItemModel.appointmentPaymentId}
        WHERE ${ClinicSettlementItemModel.clinicId} = ${clinicId}
          AND EXISTS (
            SELECT 1
            FROM money_entries payment_entry
            WHERE payment_entry.clinic_id = ${ClinicSettlementItemModel.clinicId}
              AND payment_entry.account = 'clinic'
              AND payment_entry.source_type = 'appointment'
              AND payment_entry.source_id = ${ClinicSettlementItemModel.appointmentId}
              AND payment_entry.entry_type = 'payment'
              AND payment_entry.channel = 'online'
              AND payment_entry.gateway_ref IN (
                ${AppointmentPaymentModel.transactionId},
                ${AppointmentPaymentModel.gatewayOrderId}
              )
              AND payment_entry.created_at BETWEEN ${start} AND ${end}
          )
      `),
      database.execute(sql`
        SELECT
          COALESCE(SUM(${ClinicSettlementModel.amount}::numeric), 0) AS settled_to_bank,
          COUNT(*) AS settled_count
        FROM ${ClinicSettlementModel}
        WHERE ${ClinicSettlementModel.clinicId} = ${clinicId}
          AND ${ClinicSettlementModel.status} = 'COMPLETED'
          AND (
            (${ClinicSettlementModel.settledAt} BETWEEN ${start} AND ${end})
            OR (${ClinicSettlementModel.settledAt} IS NULL AND ${ClinicSettlementModel.cycleEnd} BETWEEN ${start} AND ${end})
          )
      `),
      database.execute(sql`
        SELECT
          COALESCE(SUM(${PaymentDisputeModel.amount}::numeric), 0) AS dispute_held
        FROM ${PaymentDisputeModel}
        WHERE ${PaymentDisputeModel.clinicId} = ${clinicId}
          AND ${PaymentDisputeModel.status} = 'UNDER_REVIEW'
      `),
      database.execute(sql`
        SELECT
          COALESCE(SUM(${ClinicSettlementModel.amount}::numeric), 0) AS settlement_held
        FROM ${ClinicSettlementModel}
        WHERE ${ClinicSettlementModel.clinicId} = ${clinicId}
          AND ${ClinicSettlementModel.status} IN ('FAILED', 'ON_HOLD')
      `),
      database.execute(sql`
        SELECT COALESCE(SUM(
          CASE
            WHEN transfer->>'onHold' = 'true'
              OR LOWER(COALESCE(transfer->>'status', '')) IN ('failed', 'reversed')
            THEN COALESCE((transfer->>'amount')::numeric, 0)
            ELSE 0
          END
        ), 0) AS transfer_held
        FROM ${AppointmentPaymentModel}
        INNER JOIN ${AppointmentModel}
          ON ${AppointmentModel.id} = ${AppointmentPaymentModel.appointmentId}
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(${AppointmentPaymentModel.transfersData}) = 'array'
              THEN ${AppointmentPaymentModel.transfersData}
            ELSE '[]'::jsonb
          END
        ) AS transfer
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          AND ${AppointmentPaymentModel.createdAt} BETWEEN ${start} AND ${end}
          AND (${isOnline})
          AND NOT EXISTS (
            SELECT 1
            FROM ${ClinicSettlementItemModel}
            WHERE ${ClinicSettlementItemModel.appointmentPaymentId} = ${AppointmentPaymentModel.id}
          )
      `),
      // Every rupee received, appointments and treatment plans alike, from the one ledger reader.
      MoneyReadService.totals({ clinicId, start, end }),
      MoneyReadService.outstanding({ clinicId, start, end }),
    ]);
    const rupees = (paise: number) => money(paise / 100);

    const aggregate =
      (aggregateRows as unknown as Record<string, unknown>[])[0] || {};
    const fee = (feeRows as unknown as Record<string, unknown>[])[0] || {};
    const payout = (payoutRows as unknown as Record<string, unknown>[])[0];
    const settlement = (
      settlementRows as unknown as Record<string, unknown>[]
    )[0] || {
      already_received: 0,
      next_settlement_date: null,
      next_settlement_ref: null,
    };
    const settledPeriod = (
      settledPeriodRows as unknown as Record<string, unknown>[]
    )[0] || { settled_to_bank: 0, settled_count: 0 };
    const disputeHold = (
      disputeHoldRows as unknown as Record<string, unknown>[]
    )[0] || { dispute_held: 0 };
    const settlementHold = (
      settlementHoldRows as unknown as Record<string, unknown>[]
    )[0] || { settlement_held: 0 };
    const transferHold = (
      transferHoldRows as unknown as Record<string, unknown>[]
    )[0] || { transfer_held: 0 };

    const settledToBank = money(settledPeriod.settled_to_bank || 0);
    const onHold = money(
      Number(disputeHold.dispute_held || 0) +
        Number(settlementHold.settlement_held || 0) +
        Number(transferHold.transfer_held || 0)
    );
    const nextSettlementRef = settlement.next_settlement_ref
      ? String(settlement.next_settlement_ref)
      : null;
    const refundCount = ledger.refundsCount ?? 0;

    const grossRevenue = rupees(ledger.grossPaise);
    const netRevenue = rupees(ledger.netPaise);
    const refundsIssued = money(grossRevenue - netRevenue);
    const routeStatus = String(
      payout?.route_status || 'INACTIVE'
    ).toUpperCase();

    const onlineGross = rupees(ledger.byChannel.online.grossPaise);
    const offlineGross = rupees(ledger.byChannel.desk.grossPaise);
    const onlineNetPayable = rupees(ledger.byChannel.online.netPaise);
    const offlineNetPayable = rupees(ledger.byChannel.desk.netPaise);
    const onlineRefunds = money(onlineGross - onlineNetPayable);
    const offlineRefunds = money(offlineGross - offlineNetPayable);
    // Offline money is already in the clinic's hands; only online collections are paid out.
    const netPayable = onlineNetPayable;
    const alreadyReceived = Math.min(
      money(settlement.already_received),
      netPayable
    );
    const pendingPayout = money(Math.max(netPayable - alreadyReceived, 0));
    const expectedPayout = money(Math.max(pendingPayout - onHold, 0));

    return {
      period: {
        start: query.startDate,
        end: query.endDate,
        label: 'Selected period',
      },
      payoutAccount: {
        status:
          routeStatus === 'ACTIVE'
            ? 'verified'
            : routeStatus === 'NEEDS_CLARIFICATION'
              ? 'needs_clarification'
              : 'pending',
        statusReason: payout?.rejection_reason || null,
        manageAccountUrl: '/settings/payout-account',
      },
      grossRevenue,
      grossCollected: grossRevenue,
      netRevenue,
      outstandingDues: rupees(dues.duePaise),
      outstandingPlanDues: rupees(dues.planDuePaise),
      completedAppointmentCount: Number(
        aggregate.completed_appointment_count || 0
      ),
      platformFeeChargedToPatients: money(aggregate.platform_fee),
      platformFeeRatePercent: fee.rate === undefined ? null : money(fee.rate),
      platformFeePayer: fee.fee_payer
        ? String(fee.fee_payer).toLowerCase()
        : null,
      netPayable,
      alreadyReceived,
      settledToBank,
      settledCount: Number(settledPeriod.settled_count || 0),
      pendingPayout: expectedPayout,
      nextSettlementDate:
        settlement.next_settlement_date ||
        (expectedPayout > 0
          ? new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
          : null),
      nextSettlementId: settlement.next_settlement_id
        ? String(settlement.next_settlement_id)
        : null,
      nextSettlementRef: nextSettlementRef,
      onHold,
      onHoldReason: onHold > 0 ? 'Contact support to release' : null,
      refundsIssued,
      refundCount,
      // Already inside the totals above; its own line so staff can see it.
      treatmentPlans: {
        netRevenue: rupees(ledger.bySourcePaise.treatment_plan ?? 0),
        // Money in and refunds apart, so the screen never shows a negative "received".
        received: rupees(ledger.grossBySourcePaise.treatment_plan ?? 0),
        refunded: rupees(
          (ledger.grossBySourcePaise.treatment_plan ?? 0) -
            (ledger.bySourcePaise.treatment_plan ?? 0)
        ),
      },
      channelBreakdown: {
        online: {
          grossRevenue: onlineGross,
          refundsIssued: onlineRefunds,
          netPayable: onlineNetPayable,
          completedAppointmentCount: Number(
            aggregate.online_completed_count || 0
          ),
        },
        offline: {
          grossRevenue: offlineGross,
          refundsIssued: offlineRefunds,
          netPayable: offlineNetPayable,
          completedAppointmentCount: Number(
            aggregate.offline_completed_count || 0
          ),
        },
      },
      features: {
        settlements: true,
        refundReviews: true,
        disputes: true,
      },
    };
  }

  static async getRevenueBreakdown(
    clinicId: string,
    query: RevenueBreakdownQueryDto
  ) {
    const { start, end } = istRange(query);
    const booked = bookedPaymentCondition();
    const isOnline = isOnlinePaymentCondition();
    const isOffline = isOfflinePaymentCondition();
    const completed = sql`${AppointmentModel.appointmentStatus} = 'Completed'`;
    const cancelled = sql`${AppointmentModel.appointmentStatus} = 'Cancelled'`;
    // booked/completed/cancelled are the visit bill by status; collected comes from the money ledger.
    const sum = (when: SQL) =>
      sql`COALESCE(SUM(CASE WHEN ${when} THEN ${CLINIC_AMOUNT} ELSE 0 END), 0)`;
    const columns = sql`
      ${sum(booked)} AS booked,
      ${sum(sql`${booked} AND ${isOnline}`)} AS online_booked,
      ${sum(sql`${booked} AND ${isOffline}`)} AS offline_booked,
      ${sum(sql`${booked} AND ${completed}`)} AS completed,
      ${sum(sql`${booked} AND ${completed} AND ${isOnline}`)} AS online_completed,
      ${sum(sql`${booked} AND ${completed} AND ${isOffline}`)} AS offline_completed,
      ${sum(sql`${booked} AND ${cancelled}`)} AS cancelled,
      ${sum(sql`${booked} AND ${cancelled} AND ${isOnline}`)} AS online_cancelled,
      ${sum(sql`${booked} AND ${cancelled} AND ${isOffline}`)} AS offline_cancelled`;
    const inRange = sql`${AppointmentModel.clinicId} = ${clinicId}
      AND ${AppointmentModel.appointmentDate} BETWEEN ${start} AND ${end}`;

    const [rows, totalRows, groups] = await Promise.all([
      database.execute(
        query.view === 'doctor'
          ? sql`
            SELECT COALESCE(${UserModel.name}, 'Unassigned') AS name, ${columns}
            FROM ${AppointmentModel}
            LEFT JOIN ${AppointmentPaymentModel}
              ON ${AppointmentPaymentModel.appointmentId} = ${AppointmentModel.id}
            LEFT JOIN ${UserModel} ON ${UserModel.id} = ${AppointmentModel.doctorId}
            WHERE ${inRange}
            GROUP BY ${AppointmentModel.doctorId}, ${UserModel.name}
            ORDER BY completed DESC
            LIMIT 100`
          : query.view === 'service'
            ? sql`
            SELECT COALESCE(${ClinicServiceModel.serviceName}, 'Unassigned') AS name, ${columns}
            FROM ${AppointmentModel}
            LEFT JOIN ${AppointmentPaymentModel}
              ON ${AppointmentPaymentModel.appointmentId} = ${AppointmentModel.id}
            LEFT JOIN ${ClinicServiceModel}
              ON ${ClinicServiceModel.id} = ${AppointmentModel.clinicServiceId}
            WHERE ${inRange}
            GROUP BY ${AppointmentModel.clinicServiceId}, ${ClinicServiceModel.serviceName}
            ORDER BY completed DESC
            LIMIT 100`
            : sql`
            SELECT
              ${AppointmentModel.appointmentDate}::date AS date,
              TO_CHAR(${AppointmentModel.appointmentDate}::date, 'Dy') AS label,
              ${columns}
            FROM ${AppointmentModel}
            LEFT JOIN ${AppointmentPaymentModel}
              ON ${AppointmentPaymentModel.appointmentId} = ${AppointmentModel.id}
            WHERE ${inRange}
            GROUP BY ${AppointmentModel.appointmentDate}::date
            ORDER BY date`
      ),
      database.execute(sql`
        SELECT ${columns}
        FROM ${AppointmentModel}
        LEFT JOIN ${AppointmentPaymentModel}
          ON ${AppointmentPaymentModel.appointmentId} = ${AppointmentModel.id}
        WHERE ${inRange}
      `),
      MoneyReadService.receivedGrouped(
        { clinicId, start, end },
        query.view === 'doctor'
          ? 'doctor'
          : query.view === 'service'
            ? 'service'
            : 'day'
      ),
    ]);
    const collectedBy = new Map<string, { desk: number; online: number }>();
    for (const g of groups) {
      const c = collectedBy.get(g.key) ?? { desk: 0, online: 0 };
      c[g.channel] += g.paise;
      collectedBy.set(g.key, c);
    }
    const keyOf = (row: Record<string, unknown>) =>
      query.view === 'doctor' || query.view === 'service'
        ? String(row.name)
        : new Date(String(row.date)).toISOString().slice(0, 10);
    const withCollected = (
      row: Record<string, unknown>,
      c?: { desk: number; online: number }
    ): Record<string, unknown> => ({
      ...row,
      collected: ((c?.desk ?? 0) + (c?.online ?? 0)) / 100,
      online_collected: (c?.online ?? 0) / 100,
      offline_collected: (c?.desk ?? 0) / 100,
    });
    const toSeries = (row: Record<string, unknown>) => ({
      booked: money(row.booked),
      onlineBooked: money(row.online_booked),
      offlineBooked: money(row.offline_booked),
      completed: money(row.completed),
      onlineCompleted: money(row.online_completed),
      offlineCompleted: money(row.offline_completed),
      cancelled: money(row.cancelled),
      onlineCancelled: money(row.online_cancelled),
      offlineCancelled: money(row.offline_cancelled),
      collected: money(row.collected),
      onlineCollected: money(row.online_collected),
      offlineCollected: money(row.offline_collected),
    });
    const seen = new Set<string>();
    const list = (rows as unknown as Record<string, unknown>[]).map((row) => {
      seen.add(keyOf(row));
      return withCollected(row, collectedBy.get(keyOf(row)));
    });
    for (const [key, c] of collectedBy) {
      if (seen.has(key)) continue;
      list.push(
        withCollected(
          query.view === 'doctor' || query.view === 'service'
            ? { name: key }
            : {
                date: key,
                label: new Date(key).toLocaleDateString('en-US', {
                  weekday: 'short',
                }),
              },
          c
        )
      );
    }
    if (!query.view || query.view === 'daily')
      list.sort((a, b) => String(keyOf(a)).localeCompare(String(keyOf(b))));
    const allCollected = [...collectedBy.values()].reduce(
      (t, c) => ({ desk: t.desk + c.desk, online: t.online + c.online }),
      { desk: 0, online: 0 }
    );
    const base = {
      view: query.view,
      series: [
        'booked',
        'onlineBooked',
        'offlineBooked',
        'completed',
        'onlineCompleted',
        'offlineCompleted',
        'cancelled',
        'onlineCancelled',
        'offlineCancelled',
        'collected',
        'onlineCollected',
        'offlineCollected',
      ],
      totals: toSeries(
        withCollected(
          (totalRows as unknown as Record<string, unknown>[])[0] || {},
          allCollected
        )
      ),
    };

    if (query.view === 'doctor') {
      return {
        ...base,
        byDoctor: list.map((row) => ({
          name: String(row.name),
          ...toSeries(row),
        })),
      };
    }
    if (query.view === 'service') {
      return {
        ...base,
        byService: list.map((row) => ({
          name: String(row.name),
          ...toSeries(row),
        })),
      };
    }
    return {
      ...base,
      daily: list.map((row) => ({
        date: row.date,
        label: String(row.label).trim(),
        ...toSeries(row),
      })),
    };
  }
}
