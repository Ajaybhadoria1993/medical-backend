import { and, desc, eq, inArray } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import { SubscriptionModel } from '../../models/ownerSubscription.model';
import {
  PlanVersionModel,
  type PlanVersion,
} from '../../models/planVersion.model';
import { SubscriptionPlanModel } from '../../models/subscription.model';
import { SubscriptionPaymentModel } from '../../models/subscriptionPayment.model';
import { AddOnModel } from '../../models/addon.model';
import { addOnPriceNow } from '../../models/addOnPrice.model';
import type { PaymentLine } from '../../types/subscriptionPayment.types';
import type { TaxSetting } from '../../types/tax.types';
import { DEFAULT_TAX, netOfTax } from '../../utils/invoiceTax.utils';
import { OwnerSubscriptionService } from './ownerSubscription.service';
import { graceUntil } from '../../utils/subscriptionState.utils';

const CURRENT = ['trialing', 'active', 'past_due'] as const;
type Cycle = (typeof SubscriptionModel.$inferSelect)['billingCycle'];

/** The price for the row's cycle: yearly rows pay the yearly price, everything else the monthly one. */
const priceFor = (
  v: Pick<PlanVersion, 'monthlyPrice' | 'yearlyPrice'>,
  cycle: Cycle
) => Number((cycle === 'yearly' ? v.yearlyPrice : v.monthlyPrice) ?? 0);

const rowsWithPlan = () =>
  database
    .select({
      subscription: SubscriptionModel,
      version: PlanVersionModel,
      plan: SubscriptionPlanModel,
    })
    .from(SubscriptionModel)
    .innerJoin(
      PlanVersionModel,
      eq(PlanVersionModel.id, SubscriptionModel.planVersionId)
    )
    .innerJoin(
      SubscriptionPlanModel,
      eq(SubscriptionPlanModel.id, PlanVersionModel.planId)
    );

/** What other modules may read about a clinic's plan; they never query the subscription tables themselves. */
export class SubscriptionReadService {
  /** The plan in force now, or null when the clinic has none. */
  static async current(clinicId: string, now = new Date()) {
    const c = await OwnerSubscriptionService.getCurrent(
      'clinic',
      clinicId,
      now
    );
    if (!c) return null;
    const s = c.subscription;
    return {
      planName: c.plan.name,
      slug: c.plan.slug,
      kind: c.plan.kind,
      billingCycle: s.billingCycle,
      price: priceFor(c.version, s.billingCycle),
      startsAt: s.currentPeriodStart,
      expiresAt: s.currentPeriodEnd,
      isTrial: s.isTrial,
      active: c.state.isValid,
      state: c.state.state,
      graceUntil: graceUntil(c.state, s.currentPeriodEnd, now),
    };
  }

  /** Whether the clinic has an active AutoPay mandate; shared by the billing page and the renewal popup. */
  static async autoPayOn(clinicId: string) {
    // Imported here: the AutoPay service's own imports lead back to the core services.
    const { AutoPayService } = await import('../billing/autoPay.service');
    return !!(await AutoPayService.active(clinicId));
  }

  /** Every plan the clinic has had, newest first. */
  static async history(clinicId: string) {
    const rows = await rowsWithPlan()
      .where(
        and(
          eq(SubscriptionModel.ownerType, 'clinic'),
          eq(SubscriptionModel.ownerId, clinicId)
        )
      )
      .orderBy(desc(SubscriptionModel.createdAt));
    return rows.map(({ subscription: s, version, plan }) => ({
      planName: plan.name,
      slug: plan.slug,
      price: priceFor(version, s.billingCycle),
      startsAt: s.createdAt,
      expiresAt: s.endedAt ?? s.currentPeriodEnd,
      active: (CURRENT as readonly string[]).includes(s.status),
    }));
  }

  /** Current plan name per clinic, in one query, for lists of clinics. */
  static async currentPlanNames(
    clinicIds: string[]
  ): Promise<Map<string, string>> {
    if (!clinicIds.length) return new Map();
    const rows = await database
      .select({
        clinicId: SubscriptionModel.ownerId,
        planName: SubscriptionPlanModel.name,
      })
      .from(SubscriptionModel)
      .innerJoin(
        PlanVersionModel,
        eq(PlanVersionModel.id, SubscriptionModel.planVersionId)
      )
      .innerJoin(
        SubscriptionPlanModel,
        eq(SubscriptionPlanModel.id, PlanVersionModel.planId)
      )
      .where(
        and(
          eq(SubscriptionModel.ownerType, 'clinic'),
          inArray(SubscriptionModel.ownerId, clinicIds),
          inArray(SubscriptionModel.status, [...CURRENT])
        )
      );
    return new Map(rows.map((r) => [r.clinicId, r.planName]));
  }

  /**
   * Plan spans for the Super Admin revenue and trial charts. A paid plan is read from its captured
   * payments, so an upgrade shows as a change and a renewal paid ahead starts when its period starts;
   * an upgrade edits the subscription row in place, so the row alone would lose that history.
   */
  static async spans() {
    const rows = await rowsWithPlan().where(
      eq(SubscriptionModel.ownerType, 'clinic')
    );
    const netOf = (rupees: number, tax: TaxSetting) =>
      netOfTax(Math.round(rupees * 100), tax) / 100;
    const span = (
      clinicId: string,
      startsAt: Date,
      expiresAt: Date | null,
      version: Pick<PlanVersion, 'monthlyPrice' | 'yearlyPrice'>,
      cycle: Cycle,
      plan: { kind: string; name: string },
      isTrial: boolean,
      // MRR is reported without GST; rows before dynamic GST were 18% inclusive.
      tax: TaxSetting = DEFAULT_TAX,
      // Share of the list price actually charged after a coupon (1 = no coupon).
      paidShare = 1
    ) => {
      const price = netOf(priceFor(version, cycle), tax) * paidShare;
      return {
        clinicId,
        startsAt,
        expiresAt,
        monthlyValue: Math.round(cycle === 'yearly' ? price / 12 : price),
        isTrial,
        isPaid: plan.kind === 'paid' && !isTrial,
        isFreePlan: plan.kind === 'free',
        planName: plan.name,
        continues: false as boolean,
      };
    };
    // Free, trial and unpaid rows have no payments: the row is the span.
    const out = rows
      .filter(({ subscription: s, plan }) => plan.kind !== 'paid' || s.isTrial)
      .map(({ subscription: s, version, plan }) =>
        span(
          s.ownerId,
          s.createdAt,
          s.endedAt ?? s.currentPeriodEnd,
          version,
          s.billingCycle,
          plan,
          s.isTrial
        )
      );

    const paidRows = rows.filter(
      ({ subscription: s, plan }) => plan.kind === 'paid' && !s.isTrial
    );
    const payments = paidRows.length
      ? await database
          .select({
            subscriptionId: SubscriptionPaymentModel.subscriptionId,
            periodStart: SubscriptionPaymentModel.periodStart,
            periodEnd: SubscriptionPaymentModel.periodEnd,
            paidAt: SubscriptionPaymentModel.paidAt,
            lines: SubscriptionPaymentModel.lines,
            taxRateBp: SubscriptionPaymentModel.taxRateBp,
            taxMode: SubscriptionPaymentModel.taxMode,
            discountPaise: SubscriptionPaymentModel.discountPaise,
          })
          .from(SubscriptionPaymentModel)
          .where(
            and(
              eq(SubscriptionPaymentModel.ownerType, 'clinic'),
              eq(SubscriptionPaymentModel.status, 'captured'),
              inArray(
                SubscriptionPaymentModel.subscriptionId,
                paidRows.map((r) => r.subscription.id)
              ),
              inArray(SubscriptionPaymentModel.kind, [
                'plan_purchase',
                'plan_change',
                'renewal',
                'manual_adjustment',
                'addon_purchase',
              ])
            )
          )
      : [];
    const versionIds = [
      ...new Set(
        payments.flatMap((p) =>
          p.lines.items
            .filter((l) => l.kind === 'plan' && l.planVersionId)
            .map((l) => l.planVersionId!)
        )
      ),
    ];
    const versions = new Map(
      (versionIds.length
        ? await database
            .select({ version: PlanVersionModel, plan: SubscriptionPlanModel })
            .from(PlanVersionModel)
            .innerJoin(
              SubscriptionPlanModel,
              eq(SubscriptionPlanModel.id, PlanVersionModel.planId)
            )
            .where(inArray(PlanVersionModel.id, versionIds))
        : []
      ).map((r) => [r.version.id, r])
    );

    // Today's monthly value of each add-on: a mid-period purchase line holds only its pro-rated total.
    const addOnIds = [
      ...new Set(
        payments.flatMap((p) =>
          p.lines.items
            .filter((l) => l.kind === 'addon' && l.addOnId)
            .map((l) => l.addOnId!)
        )
      ),
    ];
    const addOnPrice = new Map(
      (addOnIds.length
        ? await database
            .select({
              id: AddOnModel.id,
              monthly: addOnPriceNow('monthly'),
              yearly: addOnPriceNow('yearly'),
            })
            .from(AddOnModel)
            .where(inArray(AddOnModel.id, addOnIds))
        : []
      ).map((r) => [r.id, r])
    );
    // A part-period line is valued at its stored unit price; older lines without one fall back to today's price.
    const addOnMonthly = (l: PaymentLine, tax: TaxSetting) => {
      const yearly = l.billingCycle === 'yearly';
      if (!l.days) return netOf(l.amountPaise / 100, tax) / (yearly ? 12 : 1);
      const p = addOnPrice.get(l.addOnId!);
      const unit =
        l.unitPaise !== undefined
          ? l.unitPaise / 100
          : Number((yearly ? p?.yearly : p?.monthly) ?? 0);
      return netOf(unit * (l.quantity ?? 1), tax) / (yearly ? 12 : 1);
    };
    const taxOf = (p: (typeof payments)[number]): TaxSetting =>
      p.taxMode ? { rateBp: p.taxRateBp, mode: p.taxMode } : DEFAULT_TAX;
    // A coupon comes off the whole subtotal, so every line of that payment keeps the same share.
    const paidShareOf = (p: (typeof payments)[number]) => {
      const subtotal = p.lines.items
        .filter((l) => l.kind !== 'coupon' && l.kind !== 'tax')
        .reduce((sum, l) => sum + l.amountPaise, 0);
      return p.discountPaise > 0 && subtotal > 0
        ? Math.max(0, 1 - p.discountPaise / subtotal)
        : 1;
    };

    for (const { subscription: s, version, plan } of paidRows) {
      const own = payments
        .flatMap((p) => {
          const line = p.lines.items.find(
            (l) => l.kind === 'plan' && l.planVersionId
          );
          const v = line ? versions.get(line.planVersionId!) : undefined;
          const startsAt = p.periodStart ?? p.paidAt;
          if (
            p.subscriptionId !== s.id ||
            !line ||
            !v ||
            !startsAt ||
            !p.periodEnd
          )
            return [];
          return [
            span(
              s.ownerId,
              startsAt,
              p.periodEnd,
              v.version,
              line.billingCycle ?? s.billingCycle,
              v.plan,
              false,
              taxOf(p),
              paidShareOf(p)
            ),
          ];
        })
        .sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime());
      // Add-ons are monthly revenue too: one span per add-on line, under the plan in force when it started.
      for (const p of payments) {
        if (p.subscriptionId !== s.id) continue;
        for (const l of p.lines.items) {
          if (l.kind !== 'addon' || !l.addOnId) continue;
          const startsAt = l.periodStart
            ? new Date(l.periodStart)
            : (p.periodStart ?? p.paidAt);
          let expiresAt = l.periodEnd ? new Date(l.periodEnd) : p.periodEnd;
          if (!startsAt || !expiresAt) continue;
          if (s.endedAt && expiresAt > s.endedAt) expiresAt = s.endedAt;
          if (expiresAt <= startsAt) continue;
          const under = [...own]
            .reverse()
            .find(
              (x) =>
                x.startsAt <= startsAt &&
                (!x.expiresAt || x.expiresAt > startsAt)
            );
          out.push({
            clinicId: s.ownerId,
            startsAt,
            expiresAt,
            monthlyValue: Math.round(
              addOnMonthly(l, taxOf(p)) * paidShareOf(p)
            ),
            isTrial: false,
            isPaid: true,
            isFreePlan: false,
            planName: under?.planName ?? plan.name,
            continues: true,
          });
        }
      }
      // Carried-over plans have no payments here: fall back to the row.
      if (!own.length) {
        out.push(
          span(
            s.ownerId,
            s.createdAt,
            s.endedAt ?? s.currentPeriodEnd,
            version,
            s.billingCycle,
            plan,
            false
          )
        );
        continue;
      }
      // A later payment replaces an earlier one from its start (an upgrade mid-period); an ended row stops all.
      own.forEach((x, i) => {
        const next = own[i + 1];
        if (i > 0 && own[i - 1].planName === x.planName) x.continues = true;
        if (next && x.expiresAt && x.expiresAt > next.startsAt)
          x.expiresAt = next.startsAt;
        if (s.endedAt && (!x.expiresAt || x.expiresAt > s.endedAt))
          x.expiresAt = s.endedAt;
      });
      out.push(...own.filter((x) => !x.expiresAt || x.expiresAt > x.startsAt));
    }
    return out;
  }

  /** When the clinic's current period started; the credits allowance resets from this day. */
  static async billingAnchor(clinicId: string): Promise<Date | null> {
    const [row] = await database
      .select({
        start: SubscriptionModel.currentPeriodStart,
        endedAt: SubscriptionModel.endedAt,
      })
      .from(SubscriptionModel)
      .where(
        and(
          eq(SubscriptionModel.ownerType, 'clinic'),
          eq(SubscriptionModel.ownerId, clinicId)
        )
      )
      .orderBy(desc(SubscriptionModel.createdAt))
      .limit(1);
    if (!row) return null;
    return row.endedAt ?? row.start;
  }
}
