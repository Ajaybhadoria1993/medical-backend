/**
 * Free-message alerts for clinic admins. Not configurable: a muted "paused" alert
 * would leave patients without messages and nobody at the clinic knowing why.
 */

import { defineEvents } from '../defineEvents';
import type { RecipientDeps } from '../types';

export interface CreditUsageCtx extends Record<string, unknown> {
  clinicId: string;
  used: number;
  limit: number;
  /** IST date the free messages reset, e.g. "20 Nov 2026". */
  resetsOn: string;
}

export interface CreditExpiryCtx extends Record<string, unknown> {
  clinicId: string;
  grantId: string;
  creditsLeft: number;
  /** IST date, e.g. "12 Oct 2027". */
  expiresOn: string;
}

async function clinicAdmins(
  ctx: { clinicId: string },
  { directory }: RecipientDeps
): Promise<string[]> {
  const admins = await directory.getStaffByRole(ctx.clinicId, ['Admin']);
  return admins.map((a) => a.id);
}

export const creditEvents = defineEvents({
  'credits.usage_warning': {
    label: 'WhatsApp messages running low',
    description: 'When most of this month’s free WhatsApp messages are used.',
    category: 'system',
    priority: 'normal',
    kind: 'notification',
    configurable: false,
    defaults: { inApp: true, push: true },
    channels: ['inApp', 'push'],
    tenant: (ctx: CreditUsageCtx) => ({
      type: 'clinic' as const,
      id: ctx.clinicId,
    }),
    // Shared with the paused alert, which then replaces this one instead of stacking.
    collapseKey: (ctx: CreditUsageCtx) => `credits-usage:${ctx.clinicId}`,
    clickAction: () => ({ route: '/settings/notifications' }),
    audiences: [
      {
        key: 'admin',
        roles: ['Admin'],
        recipients: clinicAdmins,
        message: {
          inApp: (ctx: CreditUsageCtx) => ({
            title: 'WhatsApp messages running low',
            body: `You've used ${ctx.used} of ${ctx.limit} free WhatsApp messages this month. They reset on ${ctx.resetsOn}.`,
          }),
        },
      },
    ],
  },
  'credits.usage_paused': {
    label: 'WhatsApp messages paused',
    description: 'When this month’s free WhatsApp messages are used up.',
    category: 'system',
    priority: 'action_required',
    kind: 'notification',
    configurable: false,
    defaults: { inApp: true, push: true },
    channels: ['inApp', 'push'],
    tenant: (ctx: CreditUsageCtx) => ({
      type: 'clinic' as const,
      id: ctx.clinicId,
    }),
    collapseKey: (ctx: CreditUsageCtx) => `credits-usage:${ctx.clinicId}`,
    clickAction: () => ({ route: '/settings/notifications' }),
    audiences: [
      {
        key: 'admin',
        roles: ['Admin'],
        recipients: clinicAdmins,
        message: {
          inApp: (ctx: CreditUsageCtx) => ({
            title: 'WhatsApp messages paused',
            body: `All ${ctx.limit} free WhatsApp messages for this month are used and no credits are left. Patient WhatsApp messages are paused until ${ctx.resetsOn}; bookings and everything else work as normal.`,
          }),
        },
      },
    ],
  },
  'credits.expiring': {
    label: 'WhatsApp credits expiring',
    description: 'When WhatsApp credits are about to expire unused.',
    category: 'system',
    priority: 'normal',
    kind: 'notification',
    configurable: false,
    defaults: { inApp: true, push: true },
    channels: ['inApp', 'push'],
    tenant: (ctx: CreditExpiryCtx) => ({
      type: 'clinic' as const,
      id: ctx.clinicId,
    }),
    // One per grant: two grants expiring are two facts, not one to replace.
    collapseKey: (ctx: CreditExpiryCtx) => `credits-expiring:${ctx.grantId}`,
    clickAction: () => ({ route: '/settings/notifications' }),
    audiences: [
      {
        key: 'admin',
        roles: ['Admin'],
        recipients: clinicAdmins,
        message: {
          inApp: (ctx: CreditExpiryCtx) => ({
            title: 'WhatsApp credits expiring soon',
            body: `${ctx.creditsLeft} WhatsApp credits expire on ${ctx.expiresOn}. Unused credits are not refunded.`,
          }),
        },
      },
    ],
  },
});
