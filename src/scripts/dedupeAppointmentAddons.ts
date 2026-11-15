// Run before the migration that adds the unique (appointment_id, service_id) index; it fails on duplicates.
// Usage: NODE_ENV=<env> npx tsx src/scripts/dedupeAppointmentAddons.ts [--apply] (lists only by default).
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { database } from '../configurations/dbConnection';
import { AppointmentPaymentModel as Payment } from '../main/appointments/models/appointment-payment.model';
import { appointmentMultipleService as Addon } from '../main/appointments/models/appointmentMultipleService.model';

const apply = process.argv.includes('--apply');
const rupees = (v: string | number | null | undefined) =>
  Math.round(Number(v ?? 0) * 100) / 100;

async function main() {
  const groups = await database
    .select({
      appointmentId: Addon.appointmentId,
      serviceId: Addon.serviceId,
      copies: sql<number>`COUNT(*)::int`,
    })
    .from(Addon)
    .groupBy(Addon.appointmentId, Addon.serviceId)
    .having(sql`COUNT(*) > 1`);

  if (!groups.length) {
    console.info('No duplicate added services. Safe to run the migration.');
    return;
  }
  console.info(`${groups.length} duplicated (appointment, service) pairs:`);
  for (const g of groups)
    console.info(
      `  appointment ${g.appointmentId} · service ${g.serviceId} · ${g.copies} rows`
    );
  if (!apply) {
    console.info(
      '\nList only. Review these visits (was the patient charged twice?), then rerun with --apply.'
    );
    return;
  }

  for (const appointmentId of [
    ...new Set(groups.map((g) => g.appointmentId)),
  ]) {
    await database.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(Addon)
        .where(eq(Addon.appointmentId, appointmentId))
        .orderBy(asc(Addon.createdAt), asc(Addon.id));
      const seen = new Set<string | null>();
      const extras = rows.filter((r) => {
        if (seen.has(r.serviceId)) return true;
        seen.add(r.serviceId);
        return false;
      });
      if (!extras.length) return;
      await tx.delete(Addon).where(
        and(
          eq(Addon.appointmentId, appointmentId),
          inArray(
            Addon.id,
            extras.map((r) => r.id)
          )
        )
      );
      const [payment] = await tx
        .select()
        .from(Payment)
        .where(eq(Payment.appointmentId, appointmentId));
      if (payment) {
        const kept = rows
          .filter((r) => !extras.includes(r))
          .reduce((s, r) => s + rupees(r.price), 0);
        const removed = extras.reduce((s, r) => s + rupees(r.price), 0);
        const price =
          payment.primaryServicePrice != null
            ? rupees(payment.primaryServicePrice) + kept
            : Math.max(0, rupees(payment.price) - removed);
        await tx
          .update(Payment)
          .set({ price: price.toFixed(2), updatedAt: new Date() })
          .where(eq(Payment.appointmentId, appointmentId));
        console.info(
          `  ${appointmentId}: removed ${extras.length} copies (₹${removed}), price ${payment.price} → ${price.toFixed(2)}`
        );
      }
    });
  }
  console.info('\nDone. Now generate and run the migration.');
}

main()
  .catch((e) => {
    console.error('Failed:', e);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
