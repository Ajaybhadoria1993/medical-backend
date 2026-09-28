/**
 * Subscription events.
 *
 * Non-configurable on purpose. A renewal reminder that a clinic admin has muted
 * is a clinic whose staff accounts deactivate without warning — this is the one
 * category where the product's interest and the user's genuinely align against
 * letting them turn it off.
 *
 * Priority rises as the deadline closes: a reminder two weeks out is
 * information, one due tomorrow is an action.
 */

import { defineEvents } from '../defineEvents';

export interface SubscriptionCtx extends Record<string, unknown> {
  clinicId: string;
  clinicName: string;
  adminUserId: string;
  planName: string;
  totalAmount: string;
  daysRemaining: number;
}

export const subscriptionEvents = defineEvents({
  'subscription.expiring': {
    aliases: ['subscription-renewal'],
    label: 'Subscription Expiring',
    description: 'When your plan is close to expiry.',
    category: 'system',
    priority: 'action_required',
    kind: 'notification',
    configurable: false,
    defaults: { inApp: true, push: true },
    channels: ['inApp', 'push'],
    tenant: (ctx: SubscriptionCtx) => ({
      type: 'clinic' as const,
      id: ctx.clinicId,
    }),
    /**
     * One row for the whole renewal window. The reminder fires on several days
     * as expiry approaches, and each firing should replace the last rather than
     * stack five copies of the same warning in the admin's inbox.
     */
    collapseKey: (ctx: SubscriptionCtx) => `subscription:${ctx.clinicId}`,
    clickAction: () => ({ route: '/subscription' }),
    audiences: [
      {
        key: 'admin',
        roles: ['Admin'],
        recipients: (ctx: SubscriptionCtx) => [ctx.adminUserId],
        message: {
          inApp: (ctx: SubscriptionCtx) => ({
            title: 'Subscription expiring soon',
            body:
              ctx.daysRemaining <= 1
                ? `Your ${ctx.planName} plan (₹${ctx.totalAmount}) for ${ctx.clinicName} expires tomorrow. Renew now to keep your staff accounts active.`
                : `Your ${ctx.planName} plan (₹${ctx.totalAmount}) for ${ctx.clinicName} expires in ${ctx.daysRemaining} days. Renew to avoid staff deactivation.`,
          }),
        },
      },
    ],
  },
});
