import { and, eq } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import logger from '../../../../utils/logger';
import { fetchRazorpayRouteAccountProducts } from '../../../../utils/razorpay';
import { ClinicPaymentAccountModel } from '../../../clinic/models/clinicPaymentAccount.model';
import { formatRazorpayRequirement } from '../../utils/razorpayRequirement.utils';
import { BANK_CHECKS_LOCKED } from '../../utils/payoutAccount.utils';
import {
  canMoveRouteStatus,
  type RouteStatus,
} from '../../utils/routeStatus.utils';
import { PayoutAccountStatusService } from './payoutAccountStatus.service';
import { notify } from '../../../notifications/queues/notification.queue';

// Razorpay sends Route product events under both names.
const ROUTE_ACTIVATED = ['product.activated', 'product.route.activated'];
const ROUTE_REJECTED = ['product.rejected', 'product.route.rejected'];
const ROUTE_CLARIFY = [
  'product.needs_clarification',
  'product.route.needs_clarification',
];
const ACCOUNT = ['account.activated', 'account.updated', 'account.suspended'];
const EVENTS = new Set([
  ...ROUTE_ACTIVATED,
  ...ROUTE_REJECTED,
  ...ROUTE_CLARIFY,
  ...ACCOUNT,
]);

/** What one event asks for: the account, the status and, when Razorpay gave one, the reason. */
interface Target {
  accountId: string;
  status: RouteStatus;
  reason?: string | null;
  productId?: string;
}

/** The one handler of Razorpay account and Route events, from every webhook URL. */
export class PayoutAccountWebhookService {
  /** True for the account and Route events this handler owns. */
  static handles(event: string) {
    return EVENTS.has(event);
  }

  /** Applies the event; ACTIVE only once Razorpay confirms Route, and a repeat changes nothing. */
  static async handle(event: string, payload: any): Promise<void> {
    const target = this.target(event, payload);
    if (!target) return;
    const where = and(
      eq(ClinicPaymentAccountModel.paymentProvider, 'razorpay'),
      eq(ClinicPaymentAccountModel.gatewayAccountId, target.accountId)
    );
    const [row] = await database
      .select({
        clinicId: ClinicPaymentAccountModel.clinicId,
        status: ClinicPaymentAccountModel.routeStatus,
        productId: ClinicPaymentAccountModel.routeProductId,
      })
      .from(ClinicPaymentAccountModel)
      .where(where)
      .limit(1);
    if (!row || !canMoveRouteStatus(row.status, target.status)) return;

    const productId = target.productId ?? row.productId;
    if (
      target.status === 'ACTIVE' &&
      !(await this.routeConfirmed(target.accountId, productId))
    )
      return;

    const active = target.status === 'ACTIVE';
    await database
      .update(ClinicPaymentAccountModel)
      .set({
        routeStatus: target.status,
        routeOnboardingRejectionReason: target.reason ?? null,
        // Razorpay holds the details once active; we keep only masked bank history (DPDP: erase when done).
        ...(active
          ? { routeOnboardedAt: new Date(), onboardingDraftData: null }
          : {}),
        updatedAt: new Date(),
      })
      .where(where);

    // Tell the clinic once; the job id keeps a repeated event from notifying twice.
    if (active)
      await notify(
        'payment.payouts_ready',
        { clinicId: row.clinicId },
        { jobId: `payment.payouts_ready|${target.accountId}` }
      );

    // A clinic that can't be paid must hear it; only on a move into the state, so repeats stay quiet.
    const needsAction = ['NEEDS_CLARIFICATION', 'REJECTED', 'SUSPENDED'];
    if (needsAction.includes(target.status) && row.status !== target.status)
      await notify(
        'payment.payout_action_needed',
        {
          clinicId: row.clinicId,
          reason: target.reason ?? null,
          suspended: target.status === 'SUSPENDED',
        },
        {
          jobId: `payment.payout_action_needed|${target.accountId}|${target.status}|${Date.now()}`,
        }
      );

    if (active && productId) {
      try {
        await PayoutAccountStatusService.syncClinicBankHistory(
          target.accountId,
          productId
        );
      } catch (err) {
        logger.error(
          `[PaymentAccountWebhook] Bank history snapshot failed for ${target.accountId}`,
          err
        );
      }
    }
  }

  /** "Check Status Now": asks Razorpay for the Route status and applies it like the webhook would. */
  static async refresh(clinicId: string): Promise<void> {
    const [row] = await database
      .select({
        accountId: ClinicPaymentAccountModel.gatewayAccountId,
        productId: ClinicPaymentAccountModel.routeProductId,
      })
      .from(ClinicPaymentAccountModel)
      .where(
        and(
          eq(ClinicPaymentAccountModel.clinicId, clinicId),
          eq(ClinicPaymentAccountModel.paymentProvider, 'razorpay')
        )
      )
      .limit(1);
    if (!row?.accountId || !row.productId) return;
    const product = await fetchRazorpayRouteAccountProducts(
      row.accountId,
      row.productId
    );
    const event = {
      activated: 'product.route.activated',
      needs_clarification: 'product.route.needs_clarification',
      rejected: 'product.route.rejected',
    }[String(product?.activation_status) as 'activated'];
    // Still under review: nothing to change, the card keeps saying Verifying.
    if (!event) return;
    await this.handle(event, {
      product: {
        entity: {
          id: row.productId,
          account_id: row.accountId,
          product_name: 'route',
          requirements: product?.requirements,
        },
      },
    });
  }

  /** Reads the event into a target status; null for an event about another product or with no account. */
  private static target(event: string, payload: any): Target | null {
    if (ACCOUNT.includes(event)) {
      const account = payload?.account?.entity;
      if (!account?.id) return null;
      const reason = (fallback: string) =>
        this.reasonOf(account.requirements) || fallback;
      if (event === 'account.activated')
        return { accountId: account.id, status: 'PENDING' };
      if (event === 'account.suspended')
        return { accountId: account.id, status: 'SUSPENDED' };
      switch (account.status) {
        case 'activated':
          return { accountId: account.id, status: 'PENDING' };
        case 'suspended':
          return { accountId: account.id, status: 'SUSPENDED' };
        case 'rejected':
          return {
            accountId: account.id,
            status: 'REJECTED',
            reason: reason(
              'Razorpay could not verify the linked account details.'
            ),
          };
        case 'needs_clarification':
          return {
            accountId: account.id,
            status: 'NEEDS_CLARIFICATION',
            reason: reason('KYC verification requires clarification.'),
          };
        default:
          return null;
      }
    }

    const product =
      payload?.product?.entity ?? payload?.merchant_product?.entity;
    const accountId = product?.account_id || product?.merchant_id;
    if (!accountId) return null;
    if (product?.product_name && product.product_name !== 'route') return null;
    if (ROUTE_ACTIVATED.includes(event))
      return { accountId, status: 'ACTIVE', productId: product.id };
    const rejected = ROUTE_REJECTED.includes(event);
    return {
      accountId,
      status: rejected ? 'REJECTED' : 'NEEDS_CLARIFICATION',
      productId: product.id,
      reason:
        this.reasonOf(product?.requirements) ||
        (rejected
          ? 'Razorpay rejected the Route product application.'
          : 'Razorpay requires clarification for the Route product.'),
    };
  }

  /** Razorpay's requirement list as one readable line. */
  private static reasonOf(requirements: unknown): string {
    const list = Array.isArray(requirements)
      ? requirements
      : requirements
        ? [requirements]
        : [];
    const text = list.map((r) => formatRazorpayRequirement(r)).join('; ');
    // Razorpay's lock lines are noise to a clinic; one plain sentence says what to do.
    return /max retry exceeded/i.test(text) ? BANK_CHECKS_LOCKED : text;
  }

  /** Asks Razorpay whether Route is live; a failed check keeps the current status (logged). */
  private static async routeConfirmed(
    accountId: string,
    productId: string | null | undefined
  ): Promise<boolean> {
    if (!productId) {
      logger.warn(
        `[PaymentAccountWebhook] No Route product id for ${accountId}; ACTIVE not set`
      );
      return false;
    }
    try {
      const product = await fetchRazorpayRouteAccountProducts(
        accountId,
        productId
      );
      if (product?.activation_status === 'activated') return true;
      logger.warn(
        `[PaymentAccountWebhook] Route for ${accountId} is ${product?.activation_status ?? 'unknown'}; ACTIVE not set`
      );
    } catch (err) {
      logger.error(
        `[PaymentAccountWebhook] Could not confirm Route for ${accountId}; status kept`,
        err
      );
    }
    return false;
  }
}
