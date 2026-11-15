import type { CreditType, MessageChannel } from '../utils/creditTypes.utils';

/** A clinic's free-message allowance for one channel, from its current plan. */
export type MessageLimit =
  { unlimited: true } | { unlimited: false; limit: number };

export interface RecordSentInput {
  clinicId: string;
  channel: MessageChannel;
  /** Meta's id for the accepted message. */
  messageId: string;
  templateKey: string;
}

/** The editable values of one credit_settings row. */
export interface CreditSettingValues {
  expiryDays: number;
  reminderDays: number;
  warnPercent: number;
  /** Decimal strings, as Postgres returns numeric. */
  unitCostInr: string;
  taxPercent: string;
}

/** One billing month: `start` inclusive, `end` exclusive. */
export interface BillingPeriod {
  start: Date;
  end: Date;
}

/** Who pays for the next message: free messages first, then credits.
 *  `none` = both used up, so it is not sent. */
export type AllowanceDecision =
  | { source: 'unlimited' }
  | {
      source: 'plan' | 'credit' | 'none';
      used: number;
      limit: number;
      period: BillingPeriod;
    };

/** A Super Admin grant or removal of credits for one clinic. */
export interface CreditChangeInput {
  clinicId: string;
  creditType: CreditType;
  credits: number;
  reason: string;
  actorUserId: string;
}

/** One status from Meta's webhook, reduced to what the cost record needs. */
export interface DeliveryReport {
  /** Meta's message id. */
  messageId: string;
  /** sent · delivered · read · failed */
  status: string;
  /** Meta's `pricing.billable`; absent on statuses without pricing. */
  billable?: boolean;
}

export interface CheckSendResult {
  allowed: boolean;
}

/** A clinic admin's reminder that one grant's credits expire soon. */
export interface ExpiryAlert {
  clinicId: string;
  creditType: CreditType;
  grantId: string;
  creditsLeft: number;
  /** IST date, e.g. "12 Oct 2027". */
  expiresOn: string;
}

/** What a clinic admin is told when free messages run low or run out. */
export interface UsageAlert {
  clinicId: string;
  channel: MessageChannel;
  used: number;
  limit: number;
  /** IST date the free messages reset, e.g. "20 Nov 2026". */
  resetsOn: string;
  /** Period start (ISO), keeps one alert per period. */
  periodKey: string;
}
