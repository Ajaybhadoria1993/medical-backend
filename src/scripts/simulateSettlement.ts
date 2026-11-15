// Test only: marks a clinic's unsettled online payments as paid out, since Razorpay test mode never settles.
// Usage: NODE_ENV=<development|staging> npx tsx src/scripts/simulateSettlement.ts <clinicId> (server: node dist/scripts/...).
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { database } from '../configurations/dbConnection';
import { envConfig } from '../utils/envConfig';
import { AppointmentModel } from '../main/appointments/models/appointment.model';
import { AppointmentPaymentModel } from '../main/appointments/models/appointment-payment.model';
import { ClinicSettlementItemModel } from '../main/clinicFinance/models/clinicSettlement.model';
import { SettlementService } from '../main/clinicFinance/services/settlement.service';
import { isOnlinePaymentCondition } from '../main/clinicFinance/utils/clinicFinanceAmounts.utils';

type Transfer = { id?: string; amount?: number; amountReversed?: number };

async function main() {
  const clinicId = process.argv[2];
  // Same guard as the billing test tool: dev/staging with Razorpay test keys, never production.
  const allowed =
    ['development', 'staging'].includes(envConfig.NODE_ENV) &&
    String(envConfig.RAZORPAY_KEY_ID ?? '').startsWith('rzp_test_');
  if (!allowed)
    throw new Error(
      'Refused: runs only on development/staging with rzp_test_ keys.'
    );
  if (!clinicId)
    throw new Error('Pass the clinic id: simulateSettlement.ts <clinicId>');

  const rows = await database
    .select({
      paymentId: AppointmentPaymentModel.id,
      appointmentId: AppointmentModel.id,
      price: AppointmentPaymentModel.price,
      primary: AppointmentPaymentModel.primaryServicePrice,
      transfers: AppointmentPaymentModel.transfersData,
      createdAt: AppointmentPaymentModel.createdAt,
    })
    .from(AppointmentPaymentModel)
    .innerJoin(
      AppointmentModel,
      eq(AppointmentModel.id, AppointmentPaymentModel.appointmentId)
    )
    .leftJoin(
      ClinicSettlementItemModel,
      eq(
        ClinicSettlementItemModel.appointmentPaymentId,
        AppointmentPaymentModel.id
      )
    )
    .where(
      and(
        eq(AppointmentModel.clinicId, clinicId),
        isOnlinePaymentCondition(),
        inArray(sql`LOWER(${AppointmentPaymentModel.paymentStatus})`, [
          'paid',
          'partly refunded',
        ]),
        isNull(ClinicSettlementItemModel.id)
      )
    );
  if (!rows.length) {
    console.info(
      'Nothing to settle: no unsettled online payments for this clinic.'
    );
    return;
  }

  // The clinic's share is what Route transferred to it; without a transfer, the service price.
  const items = rows.map((r) => {
    const list = Array.isArray(r.transfers) ? (r.transfers as Transfer[]) : [];
    const last = list[list.length - 1];
    const clinicAmount = Number(last?.amount ?? r.primary ?? r.price ?? 0);
    return {
      appointmentPaymentId: r.paymentId,
      appointmentId: r.appointmentId,
      providerTransferId: last?.id ?? null,
      clinicAmount,
      reversedAmount: Number(last?.amountReversed ?? 0),
      status: 'COMPLETED',
    };
  });
  const amount = items.reduce(
    (s, i) => s + i.clinicAmount - i.reversedAmount,
    0
  );
  const stamp = Date.now();
  const id = `setl_TEST_${stamp}`;
  const utr = `TESTUTR${stamp}`;
  const times = rows.map((r) => r.createdAt.getTime());

  // The real webhook's save path, with the shape it stores, so the Payouts tab reads it the same way.
  await SettlementService.upsertFromProvider({
    clinicId,
    paymentProvider: 'razorpay',
    providerSettlementId: id,
    cycleStart: new Date(Math.min(...times)),
    cycleEnd: new Date(Math.max(...times)),
    amount: Math.round(amount * 100) / 100,
    status: 'COMPLETED',
    settledAt: new Date(),
    gatewayResponse: {
      simulated: true,
      payload: { settlement: { entity: { id, utr } } },
    },
    items,
  });
  console.info(
    `Settled ${items.length} payment(s), ₹${amount.toFixed(2)}, ${id}, UTR ${utr}`
  );
}

main()
  .catch((e) => {
    console.error('Failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
