import type { CreditSettingValues } from '../types/credits.types';

/** Every credit type the module knows; a new type is one entry here plus a settings row. */
export const CREDIT_TYPES = ['whatsapp'] as const;

export type CreditType = (typeof CREDIT_TYPES)[number];

/** Message channels share the credit type of the same name. */
export type MessageChannel = CreditType;

/** First settings row per type. Must match docs/credits/CREDITS_IMPLEMENTATION.md §2.1. */
export const DEFAULT_CREDIT_SETTINGS: Record<CreditType, CreditSettingValues> =
  {
    whatsapp: {
      expiryDays: 365,
      reminderDays: 7,
      warnPercent: 80,
      unitCostInr: '0.1150',
      taxPercent: '18.00',
    },
  };

/** First packs per type, prices GST included. Must match docs/credits/WHATSAPP_QUOTA_PLAN.md decision 13. */
export const DEFAULT_CREDIT_PACKS: Record<
  CreditType,
  { credits: number; priceInr: string }[]
> = {
  whatsapp: [
    { credits: 250, priceInr: '75.00' },
    { credits: 1000, priceInr: '249.00' },
    { credits: 5000, priceInr: '999.00' },
  ],
};
