# Treatment plan reminders (parked)

Built and tested on dev on 2026-10-28, then taken out until the owner reviews it. This file holds the design and the
full code, so it can be put back as it was.

## Why

The clinic settings "Instalment reminder (days before)" and "Package expiry reminder (days before)" save, but nothing
reads them, so no reminder is ever sent.

## How it worked

- A daily job at 9:15 AM IST checks every open plan (accepted, in treatment, paused).
- **Instalment:** an unpaid instalment due within the clinic's lead time gets one reminder. `treatment_instalments.reminded_at`
  is claimed first, so it is sent once.
- **Package:** fires on the one day that is exactly the lead time before `package_expires_on` (plans have no
  reminded column). A queue job id makes a second run on the same day a no-op.
- Goes to clinic Admins and Receptionists, in-app and push; clicking opens the plan. Lead time 0 turns it off.
- No database changes. Patient WhatsApp was left out (needs approved templates and uses message credits).

## Tested on dev (2026-10-28)

- Instalment due 30 Oct with a 2-day lead: picked and marked reminded. Instalment due 20 Nov: skipped.
- Package ending 4 Nov with a 7-day lead: picked.
- Delivery to the bell was **not** confirmed: the backend was down at the end of the test.

## To put it back

1. Create the three new files below.
2. Wire it in four places:
   - `src/cron/index.ts`: import `initTreatmentPlanReminders` from `./jobs/treatmentPlanReminders.cron` and call it in `initCronJobs()`.
   - `src/main/treatmentPlan/index.ts`: import `PlanReminderService` and add
     `export const runTreatmentPlanReminders = () => PlanReminderService.run();`
   - `src/main/notifications/registry/index.ts`: import `treatmentPlanEvents` from `./treatmentPlan` and spread it into `registry`.
   - `src/main/notifications/__tests__/registry.contract.test.ts`: add `planId: 'pl1'` and `dueOn: '5 Nov 2026'` to `sampleCtx`.
3. Test with a one-off script **without** starting the notification worker in it (creating the queue also starts a
   worker, which takes the jobs and fails without the server's ports). Let the running server deliver them.

### `src/cron/jobs/treatmentPlanReminders.cron.ts`

```ts
// src/cron/jobs/treatmentPlanReminders.cron.ts
import cron from 'node-cron';
import logger from '../../utils/logger';

/** Daily: reminds the front desk of plan instalments due and packages ending soon. */
export function initTreatmentPlanReminders(): void {
  cron.schedule(
    '15 9 * * *',
    async () => {
      logger.info('[Cron:TreatmentPlanReminders] Starting...');

      try {
        const { runTreatmentPlanReminders } = await import(
          '../../main/treatmentPlan'
        );
        const { instalments, packages } = await runTreatmentPlanReminders();
        logger.info(
          `[Cron:TreatmentPlanReminders] Reminded ${instalments} instalments, ${packages} packages`
        );
      } catch (error) {
        logger.error('[Cron:TreatmentPlanReminders] Failed:', error);
      }
    },
    { timezone: 'Asia/Kolkata' }
  );

  logger.info('[Cron:TreatmentPlanReminders] Scheduled at 9:15 AM IST daily');
}
```

### `src/main/treatmentPlan/services/plans/planReminder.service.ts`

```ts
import { and, between, eq, inArray, isNull } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import { getISTDateString } from '../../../../utils/istDateTime';
import { notify } from '../../../notifications/queues/notification.queue';
import { TreatmentInstalmentModel as Instalment } from '../../models/treatmentLedger.model';
import { TreatmentPlanModel as P } from '../../models/treatmentPlan.model';
import { getPatientPort } from '../../ports';
import { addDays } from '../../utils/timing.utils';
import { TreatmentPlanSettingsService } from '../settings.service';

/** The settings cap a lead time at 60 days, so nothing further out is read. */
const MAX_LEAD_DAYS = 60;
const OPEN = ['accepted', 'in_treatment', 'paused'] as const;

const dayLabel = (ymd: string) =>
  new Date(`${ymd}T00:00:00`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
const rupees = (amount: string) =>
  Number(amount).toLocaleString('en-IN', { maximumFractionDigits: 2 });

/** Daily front-desk reminders for plan instalments and package expiry, by each clinic's lead time. */
export class PlanReminderService {
  static async run(today = getISTDateString()) {
    const [instalments, packages] = await Promise.all([
      this.instalments(today),
      this.packages(today),
    ]);
    return { instalments, packages };
  }

  /** Lead time per clinic; 0 means the clinic turned this reminder off. */
  private static async leadDays(
    clinicIds: string[],
    key: 'instalmentReminderDays' | 'packageExpiryReminderDays'
  ) {
    const entries = await Promise.all(
      [...new Set(clinicIds)].map(
        async (id) =>
          [id, (await TreatmentPlanSettingsService.get(id))[key]] as const
      )
    );
    return new Map(entries);
  }

  /** Each unpaid instalment once: reminded_at is claimed before the message goes out. */
  private static async instalments(today: string): Promise<number> {
    const rows = await database
      .select({
        id: Instalment.id,
        clinicId: Instalment.clinicId,
        planId: Instalment.planId,
        amount: Instalment.amount,
        dueDate: Instalment.dueDate,
        patientId: P.patientId,
        title: P.title,
      })
      .from(Instalment)
      .innerJoin(P, eq(P.id, Instalment.planId))
      .where(
        and(
          isNull(Instalment.paidAt),
          isNull(Instalment.remindedAt),
          inArray(P.status, [...OPEN]),
          between(Instalment.dueDate, today, addDays(today, MAX_LEAD_DAYS))
        )
      );
    if (!rows.length) return 0;
    const lead = await this.leadDays(
      rows.map((r) => r.clinicId),
      'instalmentReminderDays'
    );
    const due = rows.filter((r) => {
      const days = lead.get(r.clinicId) ?? 0;
      return days > 0 && r.dueDate <= addDays(today, days);
    });
    const names = await getPatientPort().getNames(due.map((r) => r.patientId));
    let sent = 0;
    for (const r of due) {
      const [claimed] = await database
        .update(Instalment)
        .set({ remindedAt: new Date() })
        .where(and(eq(Instalment.id, r.id), isNull(Instalment.remindedAt)))
        .returning({ id: Instalment.id });
      if (!claimed) continue;
      await notify('treatment_plan.instalment_due', {
        clinicId: r.clinicId,
        planId: r.planId,
        patientName: names.get(r.patientId) ?? 'A patient',
        planName: r.title,
        amount: rupees(r.amount),
        dueOn: dayLabel(r.dueDate),
      });
      sent += 1;
    }
    return sent;
  }

  /** No reminded column on plans, so it fires on the one day that is exactly the lead time out. */
  private static async packages(today: string): Promise<number> {
    const rows = await database
      .select({
        id: P.id,
        clinicId: P.clinicId,
        patientId: P.patientId,
        title: P.title,
        expiresOn: P.packageExpiresOn,
      })
      .from(P)
      .where(
        and(
          inArray(P.status, [...OPEN]),
          between(
            P.packageExpiresOn,
            addDays(today, 1),
            addDays(today, MAX_LEAD_DAYS)
          )
        )
      );
    if (!rows.length) return 0;
    const lead = await this.leadDays(
      rows.map((r) => r.clinicId),
      'packageExpiryReminderDays'
    );
    const due = rows.filter((r) => {
      const days = lead.get(r.clinicId) ?? 0;
      return days > 0 && r.expiresOn === addDays(today, days);
    });
    const names = await getPatientPort().getNames(due.map((r) => r.patientId));
    for (const r of due) {
      // The job id makes a second run on the same day a no-op in the queue.
      await notify(
        'treatment_plan.package_expiring',
        {
          clinicId: r.clinicId,
          planId: r.id,
          patientName: names.get(r.patientId) ?? 'A patient',
          planName: r.title,
          expiresOn: dayLabel(r.expiresOn!),
        },
        { jobId: `tp-package-expiring:${r.id}:${r.expiresOn}` }
      );
    }
    return due.length;
  }
}
```

### `src/main/notifications/registry/treatmentPlan/index.ts`

```ts
/**
 * Treatment plan reminders for the front desk, sent by the daily plan-reminder job.
 * Not configurable: the clinic sets the lead time (or 0 to turn one off) in Treatment plan settings.
 */

import { defineEvents } from '../defineEvents';
import type { RecipientDeps } from '../types';

export interface InstalmentDueCtx extends Record<string, unknown> {
  clinicId: string;
  planId: string;
  patientName: string;
  planName: string;
  /** Rupees, e.g. "1,200". */
  amount: string;
  /** IST date, e.g. "5 Nov 2026". */
  dueOn: string;
}

export interface PackageExpiryCtx extends Record<string, unknown> {
  clinicId: string;
  planId: string;
  patientName: string;
  planName: string;
  /** IST date, e.g. "12 Oct 2027". */
  expiresOn: string;
}

async function frontDesk(
  ctx: { clinicId: string },
  { directory }: RecipientDeps
): Promise<string[]> {
  const staff = await directory.getStaffByRole(ctx.clinicId, [
    'Admin',
    'Receptionist',
  ]);
  return staff.map((s) => s.id);
}

export const treatmentPlanEvents = defineEvents({
  'treatment_plan.instalment_due': {
    label: 'Plan instalment due soon',
    description: 'A few days before a treatment plan instalment is due.',
    category: 'payments',
    priority: 'normal',
    kind: 'notification',
    configurable: false,
    defaults: { inApp: true, push: true },
    channels: ['inApp', 'push'],
    tenant: (ctx: InstalmentDueCtx) => ({
      type: 'clinic' as const,
      id: ctx.clinicId,
    }),
    clickAction: (ctx: InstalmentDueCtx) => ({
      route: '/treatment-plans/:planId',
      params: { planId: ctx.planId },
    }),
    audiences: [
      {
        key: 'front_desk',
        roles: ['Admin', 'Receptionist'],
        recipients: frontDesk,
        message: {
          inApp: (ctx: InstalmentDueCtx) => ({
            title: 'Instalment due soon',
            body: `${ctx.patientName} has ₹${ctx.amount} due on ${ctx.dueOn} for ${ctx.planName}.`,
          }),
        },
      },
    ],
  },
  'treatment_plan.package_expiring': {
    label: 'Treatment package ending soon',
    description: 'A few days before a treatment package stops accepting bookings.',
    category: 'appointments',
    priority: 'normal',
    kind: 'notification',
    configurable: false,
    defaults: { inApp: true, push: true },
    channels: ['inApp', 'push'],
    tenant: (ctx: PackageExpiryCtx) => ({
      type: 'clinic' as const,
      id: ctx.clinicId,
    }),
    clickAction: (ctx: PackageExpiryCtx) => ({
      route: '/treatment-plans/:planId',
      params: { planId: ctx.planId },
    }),
    audiences: [
      {
        key: 'front_desk',
        roles: ['Admin', 'Receptionist'],
        recipients: frontDesk,
        message: {
          inApp: (ctx: PackageExpiryCtx) => ({
            title: 'Package ending soon',
            body: `${ctx.patientName}'s ${ctx.planName} package ends on ${ctx.expiresOn}. Book the remaining sessions or extend it.`,
          }),
        },
      },
    ],
  },
});
```

