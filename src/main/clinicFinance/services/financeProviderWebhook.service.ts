import { and, eq, or, sql } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import logger from '../../../utils/logger';
import { AppointmentPaymentModel } from '../../appointments/models/appointment-payment.model';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { ClinicPaymentAccountModel } from '../../clinic/models/clinicPaymentAccount.model';
import { ClinicSettlementItemModel } from '../models/clinicSettlement.model';
import {
  callRazorpaySdk,
  fetchRazorpayLinkedSettlement,
  fetchRazorpayTransfer,
  razorpayInstance,
} from '../../../utils/razorpay';
import { DisputeService } from './dispute.service';
import { SettlementService } from './settlement.service';
import { notify } from '../../notifications/queues/notification.queue';

type JsonObject = Record<string, unknown>;

/** Transfers asked about per run (one Razorpay call each); the rest wait for the next run. */
const SYNC_BATCH = 200;

function object(value: unknown): JsonObject {
  return value && typeof value === 'object' ? (value as JsonObject) : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function unixDate(value: unknown, fallback = new Date()): Date {
  const seconds = number(value);
  return seconds > 0 ? new Date(seconds * 1000) : fallback;
}

export function mapRazorpayDisputeStatus(
  event: string,
  dispute: JsonObject
): { status: string; resolutionParty: string | null; resolvedAt: Date | null } {
  if (event === 'payment.dispute.won') {
    return {
      status: 'RESOLVED_CLINIC',
      resolutionParty: 'CLINIC',
      resolvedAt: new Date(),
    };
  }
  if (event === 'payment.dispute.lost') {
    return {
      status: 'RESOLVED_PATIENT',
      resolutionParty: 'PATIENT',
      resolvedAt: new Date(),
    };
  }
  if (event === 'payment.dispute.closed') {
    const patientFavoured = number(dispute.amount_deducted) > 0;
    return {
      status: patientFavoured ? 'RESOLVED_PATIENT' : 'RESOLVED_CLINIC',
      resolutionParty: patientFavoured ? 'PATIENT' : 'CLINIC',
      resolvedAt: new Date(),
    };
  }
  return { status: 'UNDER_REVIEW', resolutionParty: null, resolvedAt: null };
}

export class ClinicFinanceProviderWebhookService {
  static async handleRazorpayWebhook(eventData: unknown): Promise<boolean> {
    const root = object(eventData);
    const event = text(root.event);

    if (event === 'settlement.processed') {
      await this.handleRazorpaySettlement(root);
      return true;
    }

    if (
      event === 'transfer.created' ||
      event === 'transfer.processed' ||
      event === 'transfer.failed' ||
      event === 'transfer.reversed'
    ) {
      await this.handleRazorpayTransfer(event, root);
      return true;
    }

    if (event.startsWith('payment.dispute.')) {
      await this.handleRazorpayDispute(event, root);
      return true;
    }

    return false;
  }

  /** Nightly backup for settlement.processed: asks Razorpay about unsettled transfers of the last 30 days. */
  static async syncPendingSettlements(): Promise<string> {
    // Unsettled transfers, filtered in SQL; the settled check uses the unique transfer index.
    const rows = (await database.execute(sql`
      SELECT DISTINCT t->>'id' AS id
      FROM ${AppointmentPaymentModel} p,
           jsonb_array_elements(p.transfers_data) t
      WHERE p.created_at >= NOW() - INTERVAL '30 days'
        AND jsonb_typeof(p.transfers_data) = 'array'
        AND t->>'id' IS NOT NULL
        AND COALESCE(t->>'status', '') NOT IN ('failed', 'reversed')
        AND NOT EXISTS (
          SELECT 1 FROM ${ClinicSettlementItemModel} s
          WHERE s.provider_transfer_id = t->>'id'
        )
      LIMIT ${SYNC_BATCH}
    `)) as unknown as { id: string }[];
    const pending = rows.map((r) => r.id);
    if (!pending.length) return 'No transfers waiting';

    // settlementId -> linked account and the transfer total seen (used if the settlement read fails).
    const settlements = new Map<string, { account: string; amount: number }>();
    let failed = 0;
    for (const id of pending) {
      try {
        const t = await fetchRazorpayTransfer(id);
        const settlementId = text(t.recipient_settlement_id);
        if (text(t.settlement_status) !== 'settled' || !settlementId) continue;
        const s = settlements.get(settlementId) ?? {
          account: text(t.recipient),
          amount: 0,
        };
        s.amount += number(t.amount);
        settlements.set(settlementId, s);
      } catch (err) {
        failed += 1;
        logger.warn(`[SettlementSync] Transfer ${id} could not be read`, err);
      }
    }

    for (const [settlementId, s] of settlements) {
      let entity: JsonObject = { id: settlementId, amount: s.amount };
      try {
        entity = await fetchRazorpayLinkedSettlement(s.account, settlementId);
      } catch (err) {
        // No UTR without it; the amount comes from the transfers and the date is today.
        logger.warn(
          `[SettlementSync] Settlement ${settlementId} not readable`,
          err
        );
      }
      await this.handleRazorpaySettlement({
        account_id: s.account,
        payload: { settlement: { entity } },
      });
    }
    return `${pending.length} transfers checked, ${settlements.size} settlements recorded${failed ? `, ${failed} unreadable` : ''}`;
  }

  private static async handleRazorpayTransfer(event: string, root: JsonObject) {
    const transfer = object(object(object(root.payload).transfer).entity);
    const transferId = text(transfer.id);
    const source = text(transfer.source);
    const recipient = text(transfer.recipient);
    if (!transferId || !source || !recipient) return;

    const [local] = await database
      .select({
        paymentId: AppointmentPaymentModel.id,
        appointmentId: AppointmentModel.id,
        transfersData: AppointmentPaymentModel.transfersData,
        clinicId: AppointmentModel.clinicId,
      })
      .from(AppointmentPaymentModel)
      .innerJoin(
        AppointmentModel,
        eq(AppointmentModel.id, AppointmentPaymentModel.appointmentId)
      )
      .where(
        or(
          eq(AppointmentPaymentModel.transactionId, source),
          eq(AppointmentPaymentModel.gatewayOrderId, source)
        )
      )
      .limit(1);

    if (!local) return;

    // Route transfer webhooks identify the linked account as the recipient.
    // Confirm that it belongs to this appointment's clinic before persisting it.
    const [account] = await database
      .select({ clinicId: ClinicPaymentAccountModel.clinicId })
      .from(ClinicPaymentAccountModel)
      .where(
        and(
          eq(ClinicPaymentAccountModel.paymentProvider, 'razorpay'),
          eq(ClinicPaymentAccountModel.gatewayAccountId, recipient),
          eq(ClinicPaymentAccountModel.clinicId, local.clinicId)
        )
      )
      .limit(1);
    if (!account) return;

    const stored = Array.isArray(local.transfersData)
      ? (local.transfersData as JsonObject[])
      : [];
    const transferRecord = {
      id: transferId,
      source,
      recipient,
      amount: number(transfer.amount) / 100,
      amountReversed: number(transfer.amount_reversed) / 100,
      status: text(transfer.status).toLowerCase(),
      settlementStatus: text(transfer.settlement_status).toLowerCase() || null,
      onHold: transfer.on_hold === true,
      onHoldUntil: number(transfer.on_hold_until) || null,
      failureReason:
        text(transfer.failure_reason) ||
        text(object(transfer.error).description) ||
        text(object(transfer.error).reason) ||
        null,
      event,
      updatedAt: unixDate(root.created_at).toISOString(),
    };
    const previousTransfer = stored.find(
      (item) => text(item.id) === transferId
    );
    const previousUpdatedAt = Date.parse(text(previousTransfer?.updatedAt));
    const currentUpdatedAt = Date.parse(transferRecord.updatedAt);
    if (
      Number.isFinite(previousUpdatedAt) &&
      previousUpdatedAt > currentUpdatedAt
    ) {
      return;
    }
    const nextTransfers = [
      ...stored.filter((item) => text(item.id) !== transferId),
      transferRecord,
    ];

    await database
      .update(AppointmentPaymentModel)
      .set({ transfersData: nextTransfers, updatedAt: new Date() })
      .where(eq(AppointmentPaymentModel.id, local.paymentId));

    // Razorpay retries webhooks; alert only the first time this transfer reaches this event.
    const failed = event === 'transfer.failed' || event === 'transfer.reversed';
    if (failed && text(previousTransfer?.event) !== event) {
      await notify(
        'payment.transfer_failed',
        {
          appointmentId: local.appointmentId,
          clinicId: local.clinicId,
          transferId,
          amount: (event === 'transfer.reversed' &&
          transferRecord.amountReversed
            ? transferRecord.amountReversed
            : transferRecord.amount
          ).toLocaleString('en-IN', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }),
          reversed: event === 'transfer.reversed',
          reason: transferRecord.failureReason,
        },
        { jobId: `payment.transfer_failed|${transferId}|${event}` }
      );
    }
  }

  private static async handleRazorpayDispute(event: string, root: JsonObject) {
    const payload = object(root.payload);
    const payment = object(object(payload.payment).entity);
    const dispute = object(object(payload.dispute).entity);
    const gatewayPaymentId =
      text(dispute.payment_id) || text(payment.id) || text(payment.payment_id);
    const providerDisputeId = text(dispute.id);

    if (!gatewayPaymentId || !providerDisputeId) return;

    const [local] = await database
      .select({
        paymentId: AppointmentPaymentModel.id,
        appointmentId: AppointmentModel.id,
        clinicId: AppointmentModel.clinicId,
      })
      .from(AppointmentPaymentModel)
      .innerJoin(
        AppointmentModel,
        eq(AppointmentModel.id, AppointmentPaymentModel.appointmentId)
      )
      .where(eq(AppointmentPaymentModel.transactionId, gatewayPaymentId))
      .limit(1);

    if (!local) return;

    const mapped = mapRazorpayDisputeStatus(event, dispute);
    await DisputeService.upsertFromProvider({
      clinicId: local.clinicId,
      appointmentId: local.appointmentId,
      appointmentPaymentId: local.paymentId,
      paymentProvider: 'razorpay',
      providerDisputeId,
      amount: number(dispute.amount) / 100,
      reason:
        text(dispute.reason_code) || text(dispute.phase) || 'Payment disputed',
      status: mapped.status,
      resolutionParty: mapped.resolutionParty,
      filedAt: unixDate(dispute.created_at),
      resolvedAt: mapped.resolvedAt,
      providerResponse: root,
    });
  }

  private static async handleRazorpaySettlement(root: JsonObject) {
    const accountId = text(root.account_id);
    const settlement = object(object(object(root.payload).settlement).entity);
    const providerSettlementId = text(settlement.id);
    if (!accountId || !providerSettlementId) return;

    const [account] = await database
      .select({ clinicId: ClinicPaymentAccountModel.clinicId })
      .from(ClinicPaymentAccountModel)
      .where(
        and(
          eq(ClinicPaymentAccountModel.paymentProvider, 'razorpay'),
          eq(ClinicPaymentAccountModel.gatewayAccountId, accountId)
        )
      )
      .limit(1);
    if (!account) return;

    const transfersApi = razorpayInstance.transfers as unknown as {
      all(input: { recipient_settlement_id: string }): Promise<{
        items?: JsonObject[];
      }>;
    };
    const transferCollection = await callRazorpaySdk(
      'Razorpay settlement transfer reconciliation',
      () => transfersApi.all({ recipient_settlement_id: providerSettlementId })
    );

    const items: Array<{
      appointmentPaymentId: string;
      appointmentId: string;
      providerTransferId: string;
      clinicAmount: number;
      reversedAmount: number;
      status: string;
    }> = [];
    const itemDates: Date[] = [];

    for (const transfer of transferCollection.items || []) {
      const source = text(transfer.source);
      const transferId = text(transfer.id);
      if (!source || !transferId) continue;

      const [local] = await database
        .select({
          paymentId: AppointmentPaymentModel.id,
          paymentCreatedAt: AppointmentPaymentModel.createdAt,
          appointmentId: AppointmentModel.id,
          clinicId: AppointmentModel.clinicId,
        })
        .from(AppointmentPaymentModel)
        .innerJoin(
          AppointmentModel,
          eq(AppointmentModel.id, AppointmentPaymentModel.appointmentId)
        )
        .where(
          or(
            eq(AppointmentPaymentModel.transactionId, source),
            eq(AppointmentPaymentModel.gatewayOrderId, source)
          )
        )
        .limit(1);

      if (!local || local.clinicId !== account.clinicId) continue;
      itemDates.push(local.paymentCreatedAt);
      items.push({
        appointmentPaymentId: local.paymentId,
        appointmentId: local.appointmentId,
        providerTransferId: transferId,
        clinicAmount: number(transfer.amount) / 100,
        reversedAmount: number(transfer.amount_reversed) / 100,
        status: text(transfer.status).toUpperCase() || 'COMPLETED',
      });
    }

    const settledAt = unixDate(
      settlement.created_at || root.created_at,
      new Date()
    );
    const timestamps = itemDates.map((date) => date.getTime());
    const cycleStart = timestamps.length
      ? new Date(Math.min(...timestamps))
      : settledAt;
    const cycleEnd = timestamps.length
      ? new Date(Math.max(...timestamps))
      : settledAt;

    await SettlementService.upsertFromProvider({
      clinicId: account.clinicId,
      paymentProvider: 'razorpay',
      providerSettlementId,
      gatewayAccountId: accountId,
      cycleStart,
      cycleEnd,
      amount: number(settlement.amount) / 100,
      status: 'COMPLETED',
      settledAt,
      gatewayResponse: root,
      items,
    });
  }
}
