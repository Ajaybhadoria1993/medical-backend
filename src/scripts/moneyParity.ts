// Compares each money screen's current figure with MoneyReadService, per clinic per month; run after the backfill.
// Usage: NODE_ENV=<env> npx tsx src/scripts/moneyParity.ts [--clinic=<uuid>] [--months=3]
import { sql } from 'drizzle-orm';
import { initTreatmentPlanPorts } from '../adapters/treatmentPlan';
import { database } from '../configurations/dbConnection';
import redisClient from '../configurations/redisConfig';
import { AppointmentPaymentsService } from '../main/appointments/services/appointmentPayments.service';
import { ClinicFinanceService } from '../main/clinicFinance/services/clinicFinance.service';
import { invalidateClinicDashboardCaches } from '../main/dashboard/utils/dashboardCache.utils';
import { DashboardService } from '../main/dashboard/services/dashboard.service';
import { MoneyReadService } from '../main/money';
import { ReportsRevenueService } from '../main/reportsOverview/services/reportsRevenue.service';
import { getISTDateString, istDayBoundsUtc } from '../utils/istDateTime';

const clinicArg = process.argv.find((a) => a.startsWith('--clinic='))?.slice(9);
const months = Number(
  process.argv.find((a) => a.startsWith('--months='))?.slice(9) ?? 3
);
const say = (...m: unknown[]) => console.info(...m);
const rupees = (paise: number) => Math.round(paise) / 100;

function monthRanges() {
  const out: { startDate: string; endDate: string }[] = [];
  const [y, m] = getISTDateString().split('-').map(Number);
  for (let i = 0; i < months; i++) {
    const first = new Date(Date.UTC(y, m - 1 - i, 1));
    const last = new Date(Date.UTC(y, m - i, 0));
    out.push({
      startDate: first.toISOString().slice(0, 10),
      endDate: last.toISOString().slice(0, 10),
    });
  }
  return out;
}

async function main() {
  const [{ ok }] = (await database.execute(
    sql`SELECT to_regclass('public.money_entries') IS NOT NULL AS ok`
  )) as unknown as { ok: boolean }[];
  if (!ok)
    throw new Error(
      'money_entries does not exist: run the migration and backfill first'
    );
  initTreatmentPlanPorts();
  const clinics = clinicArg
    ? [clinicArg]
    : (
        (await database.execute(
          // Lab rows carry no clinic; parity is a clinic check.
          sql`SELECT DISTINCT clinic_id FROM money_entries WHERE clinic_id IS NOT NULL`
        )) as unknown as { clinic_id: string }[]
      ).map((r) => r.clinic_id);
  let diffs = 0;
  for (const clinicId of clinics) {
    // Fresh figures only, never a cached copy.
    await invalidateClinicDashboardCaches(clinicId);
    const reportKeys = await redisClient.keys(`*eports*${clinicId}*`);
    if (reportKeys.length) await redisClient.del(...reportKeys);
    for (const { startDate, endDate } of monthRanges()) {
      const range = {
        clinicId,
        start: istDayBoundsUtc(startDate).start.toISOString(),
        end: istDayBoundsUtc(endDate).end.toISOString(),
      };
      const ledger = rupees((await MoneyReadService.totals(range)).netPaise);
      const history =
        await AppointmentPaymentsService.getAppointmentPaymentTransactions(
          { startDate, endDate, pageNumber: 1, pageSize: 1 } as never,
          { userType: 'Admin' },
          clinicId
        );
      const finance = await ClinicFinanceService.getSummary(clinicId, {
        startDate,
        endDate,
      } as never);
      const dashboard = await DashboardService.getRevenueOverview(
        clinicId,
        { id: clinicId, userType: 'Admin' } as never,
        { startDate, endDate }
      );
      const reports = await ReportsRevenueService.getRevenueReports(clinicId, {
        startDate,
        endDate,
      } as never);
      const screens: [string, number][] = [
        ['Payment History', history.summary.netAmount],
        ['Finance', finance.netRevenue],
        ['Dashboard', dashboard.totalRevenue],
        ['Reports', reports.metrics.totalRevenue.value],
      ];
      for (const [name, value] of screens) {
        // Reports rounds to whole rupees.
        const same =
          name === 'Reports'
            ? Math.round(ledger) === value
            : Math.abs(ledger - value) < 0.01;
        if (!same) {
          diffs++;
          say(
            `DIFF ${clinicId} ${startDate.slice(0, 7)} ${name}: screen ₹${value} vs ledger ₹${ledger}`
          );
        }
      }
    }
  }
  say(
    `\n${clinics.length} clinics × ${months} months checked; ${diffs} differences.`
  );
  say(
    diffs
      ? 'Review before switching any screen (live money after the switch-on is dated on the day received, visits on the visit day).'
      : 'All screens match the ledger.'
  );
}

main()
  .catch((e) => {
    console.error('Failed:', (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
