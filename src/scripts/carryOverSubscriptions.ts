// Copies each clinic's current plan, active add-ons and past payments into the new subscription tables.
// Usage: NODE_ENV=<env> npx tsx src/scripts/carryOverSubscriptions.ts [--apply] (dry run by default); adds only, safe to rerun.
import { and, eq, isNull } from 'drizzle-orm';
import { database } from '../configurations/dbConnection';
import {
  ensureFirstVersion,
  type Tx,
} from '../drizzle/seeds/subscriptions.seed';
import { ClinicModel } from '../main/clinic/models/clinic.model';
import {
  AddOnModel,
  ClinicAddOnModel,
  ClinicSubscriptionModel,
  CouponUsageModel,
  PlanAddOnLimitsModel,
  PlanFeaturesModel,
  SubscriptionActivityModel,
  SubscriptionAddOnModel,
  SubscriptionModel,
  SubscriptionPaymentModel,
  SubscriptionPlanModel,
} from '../main/subscription/models';
import type {
  ClinicSubscription,
  NewSubscription,
  NewSubscriptionPayment,
  SubscriptionPlan,
} from '../main/subscription/models';
import type { PaymentLine } from '../main/subscription/types/subscriptionPayment.types';
import { billingCycleFromProviderId } from '../main/subscription/utils/billingCycle.utils';
import { normalizeSubscriptionPaymentMode } from '../main/subscription/utils/paymentMode.utils';

const apply = process.argv.includes('--apply');
const say = (...m: unknown[]) => console.info(...m);
class DryRun extends Error {}

const DAY_MS = 24 * 60 * 60 * 1000;
const toPaise = (rupees: unknown) => Math.round(Number(rupees ?? 0) * 100);
const isPaymentId = (id?: string | null): id is string =>
  !!id && id.startsWith('pay_');
const anchorDay = (d: Date) =>
  Number(
    new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: 'numeric',
    }).format(d)
  );
const METHODS: Record<string, string> = {
  UPI: 'upi',
  Card: 'card',
  'Net Banking': 'netbanking',
  Wallet: 'wallet',
};
const methodOf = (mode?: string | null) =>
  METHODS[normalizeSubscriptionPaymentMode(mode)] ?? null;
/** The fields this script reads from old activity metadata. */
type Meta = {
  transactionId?: string;
  paymentId?: string;
  clinicAddOnId?: string;
  items?: { clinicAddOnId?: string; price?: string | number }[];
  pricing?: { couponDiscount?: string | number };
  planId?: string;
  planName?: string;
  billingCycle?: string;
  paymentMode?: string;
  periodStartsAt?: string;
  periodEndsAt?: string;
};

const report = {
  plans: 0,
  clinics: 0,
  alreadyCarried: 0,
  free: 0,
  trial: 0,
  paid: 0,
  expiredToFree: 0,
  addOns: 0,
  payments: { plan: 0, addOn: 0, renewal: 0, couponOnly: 0, written: 0 },
  orphanSubscriptions: [] as string[],
  missingPlan: [] as string[],
  addOnEndChanges: [] as string[],
};

/** Every plan gets version 1 and its features and add-on limits point at it. */
async function planVersions(tx: Tx) {
  // Same free rule the old code uses, for databases where the seed has not run yet.
  for (const slug of ['solo', 'Free'])
    await tx
      .update(SubscriptionPlanModel)
      .set({ kind: 'free' })
      .where(eq(SubscriptionPlanModel.slug, slug));
  const plans = await tx.select().from(SubscriptionPlanModel);
  const versionOf = new Map<string, string>();
  for (const p of plans) {
    const v = await ensureFirstVersion(
      tx,
      p.id,
      Number(p.price),
      p.kind === 'free'
    );
    versionOf.set(p.id, v);
    await tx
      .update(PlanFeaturesModel)
      .set({ planVersionId: v })
      .where(
        and(
          eq(PlanFeaturesModel.planId, p.id),
          isNull(PlanFeaturesModel.planVersionId)
        )
      );
    await tx
      .update(PlanAddOnLimitsModel)
      .set({ planVersionId: v })
      .where(
        and(
          eq(PlanAddOnLimitsModel.planId, p.id),
          isNull(PlanAddOnLimitsModel.planVersionId)
        )
      );
  }
  report.plans = plans.length;
  return { plans, versionOf };
}

/** The old code's unpaid-trial rule (pricing.service), so a paid purchase of the trial plan is not a trial. */
const isUnpaidTrial = (old: ClinicSubscription, plan: SubscriptionPlan) =>
  old.transactionId === 'TRIAL' ||
  (plan.isTrialPlan &&
    Number(old.price) <= 0 &&
    (!old.transactionId || old.transactionId === '-'));

function fromOld(
  old: ClinicSubscription,
  plan: SubscriptionPlan,
  versionId: string,
  planById: Map<string, SubscriptionPlan>,
  now: Date
): NewSubscription {
  const isTrial = isUnpaidTrial(old, plan);
  const ended = !!old.expiresAt && old.expiresAt <= now;
  const renews = !isTrial && !!old.expiresAt;
  const scheduledFree =
    old.scheduledProviderSubscriptionId === 'free_plan' ||
    planById.get(old.scheduledPlanId ?? '')?.kind === 'free';
  return {
    ownerType: 'clinic',
    ownerId: old.clinicId,
    planVersionId: versionId,
    status: ended ? 'expired' : isTrial ? 'trialing' : 'active',
    billingCycle: renews
      ? billingCycleFromProviderId(old.providerSubscriptionId)
      : 'none',
    currentPeriodStart: old.startsAt,
    currentPeriodEnd: old.expiresAt,
    // The next renewal lands on the old expiry date, so its day becomes the anchor.
    billingAnchorDay: renews ? anchorDay(old.expiresAt!) : null,
    isTrial,
    cancelAtPeriodEnd: old.cancelAtPeriodEnd,
    cancelledAt: old.cancelledAt,
    cancellationReason: old.cancellationReason,
    scheduledPlanId: old.scheduledPlanId,
    scheduledBillingCycle: old.scheduledPlanId
      ? scheduledFree
        ? 'none'
        : billingCycleFromProviderId(old.scheduledProviderSubscriptionId)
      : null,
    scheduledChangeAt: old.scheduledPlanChangeAt,
    endedAt: ended ? old.expiresAt : null,
    createdAt: old.createdAt,
  };
}

async function subscriptions(
  tx: Tx,
  plans: SubscriptionPlan[],
  versionOf: Map<string, string>,
  now: Date
) {
  const planById = new Map(plans.map((p) => [p.id, p]));
  const free =
    plans.find((p) => p.isDefaultFallback && p.ownerType === 'clinic') ??
    plans.find((p) => p.kind === 'free');
  if (!free) throw new Error('No Free (fallback) plan: run the seed first');

  const carried = new Set(
    (
      await tx
        .selectDistinct({ id: SubscriptionModel.ownerId })
        .from(SubscriptionModel)
        .where(eq(SubscriptionModel.ownerType, 'clinic'))
    ).map((r) => r.id)
  );
  const clinics = await tx.select({ id: ClinicModel.id }).from(ClinicModel);
  const current = new Map(
    (
      await tx
        .select()
        .from(ClinicSubscriptionModel)
        .where(eq(ClinicSubscriptionModel.active, true))
    ).map((r) => [r.clinicId, r])
  );
  const liveAddOns = (
    await tx
      .select()
      .from(ClinicAddOnModel)
      .where(
        and(
          eq(ClinicAddOnModel.isActive, true),
          eq(ClinicAddOnModel.paymentStatus, 'success')
        )
      )
  ).filter((a) => !a.expiresAt || a.expiresAt > now);

  const clinicIds = new Set(clinics.map((c) => c.id));
  report.clinics = clinics.length;
  report.orphanSubscriptions = [...current.keys()].filter(
    (id) => !clinicIds.has(id)
  );

  for (const { id: clinicId } of clinics) {
    if (carried.has(clinicId)) {
      report.alreadyCarried++;
      continue;
    }
    try {
      const old = current.get(clinicId);
      const plan = old && planById.get(old.planId);
      const freeRow = (start: Date): NewSubscription => ({
        ownerType: 'clinic',
        ownerId: clinicId,
        planVersionId: versionOf.get(free.id)!,
        status: 'active',
        billingCycle: 'none',
        currentPeriodStart: start,
      });

      let row: NewSubscription;
      if (old && !plan)
        report.missingPlan.push(`${clinicId}: plan ${old.planId}`);
      if (!old || !plan || plan.kind === 'free') {
        row = freeRow(old?.startsAt ?? now);
        report.free++;
      } else {
        row = fromOld(old, plan, versionOf.get(plan.id)!, planById, now);
        if (row.status === 'expired') {
          // History keeps the ended plan; the clinic is on Free from its end, as the old code treats it.
          await tx.insert(SubscriptionModel).values(row);
          row = freeRow(old.expiresAt!);
          report.expiredToFree++;
        } else if (row.isTrial) report.trial++;
        else report.paid++;
      }
      const [sub] = await tx
        .insert(SubscriptionModel)
        .values(row)
        .returning({ id: SubscriptionModel.id });

      const byAddOn = new Map<string, typeof liveAddOns>();
      for (const a of liveAddOns.filter((x) => x.clinicId === clinicId))
        byAddOn.set(a.addOnId, [...(byAddOn.get(a.addOnId) ?? []), a]);
      for (const [addOnId, rows] of byAddOn) {
        const quantity = rows.reduce((s, r) => s + r.quantity, 0);
        const next = rows.reduce(
          (s, r) =>
            s + (r.cancelAtPeriodEnd ? 0 : r.quantity - r.scheduledReductionBy),
          0
        );
        await tx.insert(SubscriptionAddOnModel).values({
          ownerType: 'clinic',
          ownerId: clinicId,
          subscriptionId: sub.id,
          addOnId,
          quantity,
          scheduledQuantity: next === quantity ? null : Math.max(0, next),
          scheduledDeactivateUserIds: rows.flatMap(
            (r) => r.scheduledDeactivateUserIds
          ),
          createdAt: rows[0].createdAt,
        });
        report.addOns++;
        // Add-ons now end with the plan period, so list any whose own end date was different.
        const planEnd = row.currentPeriodEnd ?? null;
        for (const r of rows) {
          const gap =
            r.expiresAt && planEnd
              ? Math.abs(r.expiresAt.getTime() - planEnd.getTime())
              : r.expiresAt || planEnd
                ? Infinity
                : 0;
          if (gap > DAY_MS)
            report.addOnEndChanges.push(
              `${clinicId}: add-on ${addOnId} ended ${r.expiresAt?.toISOString() ?? 'never'}, now ${planEnd?.toISOString() ?? 'never'}`
            );
        }
      }
    } catch (e) {
      (e as Error).message = `clinic ${clinicId}: ${(e as Error).message}`;
      throw e;
    }
  }
}

/** Real past payments (one row per Razorpay payment) plus coupon uses with no payment, all captured. */
async function payments(tx: Tx, versionOf: Map<string, string>) {
  const coupons = await tx.select().from(CouponUsageModel);
  const couponByPay = new Map(
    coupons
      .filter((c) => isPaymentId(c.razorpayPaymentId))
      .map((c) => [c.razorpayPaymentId!, c])
  );
  const out: NewSubscriptionPayment[] = [];
  const seen = new Set<string>();
  const add = (
    p: Omit<
      NewSubscriptionPayment,
      'ownerType' | 'status' | 'lines' | 'idempotencyKey'
    > & {
      key: string;
      items: PaymentLine[];
    }
  ) => {
    const { key, items, ...rest } = p;
    if (p.providerPaymentId) seen.add(p.providerPaymentId);
    const coupon = p.providerPaymentId
      ? couponByPay.get(p.providerPaymentId)
      : undefined;
    out.push({
      ...rest,
      ownerType: 'clinic',
      status: 'captured',
      provider: p.providerPaymentId ? 'razorpay' : null,
      couponId: rest.couponId ?? coupon?.couponId ?? null,
      discountPaise: coupon
        ? toPaise(coupon.discountAmount)
        : (rest.discountPaise ?? 0),
      lines: { version: 1, items },
      idempotencyKey: `carryover:${key}`,
      createdAt: rest.paidAt ?? undefined,
      updatedAt: rest.paidAt ?? undefined,
    });
  };

  const activity = await tx
    .select()
    .from(SubscriptionActivityModel)
    .where(eq(SubscriptionActivityModel.type, 'addon_purchased'));
  // clinic_add_ons.price can be rewritten on a cycle change; the purchase event keeps what was paid.
  const paidByAddOnRow = new Map<string, number>();
  const addOnDiscountByPay = new Map<string, number>();
  for (const ev of activity) {
    const m = (ev.metadata ?? {}) as Meta;
    if (isPaymentId(m.transactionId) && Number(m.pricing?.couponDiscount) > 0)
      addOnDiscountByPay.set(
        m.transactionId,
        Number(m.pricing?.couponDiscount)
      );
    if (Array.isArray(m.items)) {
      for (const i of m.items)
        if (i.clinicAddOnId)
          paidByAddOnRow.set(i.clinicAddOnId, Number(i.price));
    } else if (m.clinicAddOnId) {
      paidByAddOnRow.set(m.clinicAddOnId, Number(ev.amount));
    }
  }

  // Read first: the old billing history counts a payment id that is also a renewal as the renewal.
  const renewals = await tx
    .select()
    .from(SubscriptionActivityModel)
    .where(eq(SubscriptionActivityModel.type, 'renewal_payment'));
  for (const ev of renewals) {
    const m = (ev.metadata ?? {}) as Meta;
    if (!isPaymentId(m.paymentId) || seen.has(m.paymentId)) continue;
    add({
      key: m.paymentId,
      ownerId: ev.clinicId,
      kind: 'renewal',
      amountPaise: toPaise(ev.amount),
      currency: ev.currency,
      items: [
        {
          kind: 'plan',
          description: m.planName || 'Subscription renewal',
          amountPaise: toPaise(ev.amount),
          planVersionId: versionOf.get(m.planId ?? ''),
          billingCycle: m.billingCycle === 'yearly' ? 'yearly' : 'monthly',
        },
      ],
      periodStart: m.periodStartsAt ? new Date(m.periodStartsAt) : null,
      periodEnd: m.periodEndsAt ? new Date(m.periodEndsAt) : null,
      providerPaymentId: m.paymentId,
      paymentMethod: methodOf(m.paymentMode),
      paidAt: ev.createdAt,
    });
    report.payments.renewal++;
  }

  const planRows = await tx
    .select({
      s: ClinicSubscriptionModel,
      planName: SubscriptionPlanModel.name,
      currency: SubscriptionPlanModel.currency,
    })
    .from(ClinicSubscriptionModel)
    .innerJoin(
      SubscriptionPlanModel,
      eq(SubscriptionPlanModel.id, ClinicSubscriptionModel.planId)
    )
    .where(eq(ClinicSubscriptionModel.paymentStatus, 'success'));
  const addOnRows = (
    await tx
      .select({
        a: ClinicAddOnModel,
        name: AddOnModel.name,
        currency: AddOnModel.currency,
      })
      .from(ClinicAddOnModel)
      .innerJoin(AddOnModel, eq(AddOnModel.id, ClinicAddOnModel.addOnId))
      .where(eq(ClinicAddOnModel.paymentStatus, 'success'))
  ).filter((r) => isPaymentId(r.a.transactionId));
  const addOnPays = new Set(addOnRows.map((r) => r.a.transactionId));

  for (const { s, planName, currency } of planRows) {
    const payId = s.providerPaymentId ?? s.transactionId;
    if (!isPaymentId(payId) || seen.has(payId)) continue;
    const cycle = billingCycleFromProviderId(s.providerSubscriptionId);
    // A combined checkout stored the whole amount on the plan row, add-ons included.
    const description = addOnPays.has(payId)
      ? `${planName} (with add-ons)`
      : planName;
    add({
      key: payId,
      ownerId: s.clinicId,
      kind: 'plan_purchase',
      amountPaise: toPaise(s.price),
      discountPaise: toPaise(s.discount),
      currency,
      items: [
        {
          kind: 'plan',
          description,
          amountPaise: toPaise(s.price),
          planVersionId: versionOf.get(s.planId),
          billingCycle: cycle,
        },
      ],
      periodStart: s.startsAt,
      periodEnd: s.expiresAt,
      providerOrderId: s.providerOrderId,
      providerPaymentId: payId,
      paymentMethod: methodOf(s.paymentMode),
      paidAt: s.createdAt,
    });
    report.payments.plan++;
  }

  const groups = new Map<string, typeof addOnRows>();
  for (const r of addOnRows)
    if (!seen.has(r.a.transactionId!))
      groups.set(r.a.transactionId!, [
        ...(groups.get(r.a.transactionId!) ?? []),
        r,
      ]);
  for (const [payId, rows] of groups) {
    const items: PaymentLine[] = rows.map(({ a, name }) => ({
      kind: 'addon',
      description: name,
      amountPaise: toPaise(paidByAddOnRow.get(a.id) ?? a.price),
      addOnId: a.addOnId,
      quantity: a.quantity,
      billingCycle: a.billingCycle === 'yearly' ? 'yearly' : 'monthly',
    }));
    const first = rows[0].a;
    add({
      key: payId,
      ownerId: first.clinicId,
      kind: 'addon_purchase',
      amountPaise: items.reduce((s, i) => s + i.amountPaise, 0),
      discountPaise: toPaise(addOnDiscountByPay.get(payId)),
      currency: rows[0].currency,
      items,
      periodStart: first.startsAt,
      periodEnd: first.expiresAt,
      // Add-on rows keep the Razorpay order id in provider_subscription_id.
      providerOrderId: first.providerSubscriptionId?.startsWith('order_')
        ? first.providerSubscriptionId
        : null,
      providerPaymentId: payId,
      paymentMethod: methodOf(first.paymentMode),
      paidAt: first.createdAt,
    });
    report.payments.addOn++;
  }

  // Kept so per-clinic coupon limits still count uses that had no Razorpay payment (e.g. a 100% coupon).
  for (const c of coupons) {
    if (isPaymentId(c.razorpayPaymentId) && seen.has(c.razorpayPaymentId))
      continue;
    add({
      key: `coupon_usage:${c.id}`,
      ownerId: c.clinicId,
      kind: c.planId ? 'plan_purchase' : 'addon_purchase',
      amountPaise: toPaise(c.finalAmount),
      discountPaise: toPaise(c.discountAmount),
      couponId: c.couponId,
      items: [
        {
          kind: c.planId ? 'plan' : 'addon',
          description: 'Coupon purchase (carried over)',
          amountPaise: toPaise(c.finalAmount),
          planVersionId: c.planId ? versionOf.get(c.planId) : undefined,
          addOnId: c.addOnId ?? undefined,
        },
      ],
      providerOrderId: c.razorpayOrderId,
      providerPaymentId: isPaymentId(c.razorpayPaymentId)
        ? c.razorpayPaymentId
        : null,
      paidAt: c.usedAt,
    });
    report.payments.couponOnly++;
  }

  for (const p of out) {
    const written = await tx
      .insert(SubscriptionPaymentModel)
      .values(p)
      .onConflictDoNothing({
        target: [
          SubscriptionPaymentModel.ownerType,
          SubscriptionPaymentModel.ownerId,
          SubscriptionPaymentModel.idempotencyKey,
        ],
      })
      .returning({ id: SubscriptionPaymentModel.id });
    report.payments.written += written.length;
  }
}

async function main() {
  say(
    apply
      ? 'APPLY: copying into the new tables'
      : 'DRY RUN: nothing will be written'
  );
  const now = new Date();
  try {
    // One transaction: either every clinic is carried over or none is.
    await database.transaction(async (tx) => {
      const { plans, versionOf } = await planVersions(tx);
      await subscriptions(tx, plans, versionOf, now);
      await payments(tx, versionOf);
      if (!apply) throw new DryRun();
    });
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
  }

  const r = report;
  const carriedNow = r.free + r.trial + r.paid + r.expiredToFree;
  say(`\nPlans: ${r.plans} (each has version 1)`);
  say(
    `Clinics: ${r.clinics} · already carried over: ${r.alreadyCarried} · ${apply ? 'carried now' : 'would carry'}: ${carriedNow}`
  );
  say(
    `  Free: ${r.free} · trial: ${r.trial} · paid: ${r.paid} · ended, now Free: ${r.expiredToFree}`
  );
  say(`Add-ons: ${r.addOns}`);
  say(
    `Payments found: plan ${r.payments.plan} · add-on ${r.payments.addOn} · renewal ${r.payments.renewal} · coupon only ${r.payments.couponOnly}; new rows: ${r.payments.written}`
  );
  say(
    `\nActive old subscriptions with no clinic (not copied): ${r.orphanSubscriptions.length}`
  );
  r.orphanSubscriptions.slice(0, 50).forEach((id) => say(`  ${id}`));
  say(`\nOld plan no longer exists, put on Free: ${r.missingPlan.length}`);
  r.missingPlan.slice(0, 50).forEach((s) => say(`  ${s}`));
  say(`\nAdd-ons whose end date changes: ${r.addOnEndChanges.length}`);
  r.addOnEndChanges.slice(0, 50).forEach((s) => say(`  ${s}`));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
