import type { AutoPayLimit } from '../../types/autoPay.types';
import { AUTOPAY_DEFAULT_LIMIT_PAISE } from '../../utils/autoPay.utils';

/**
 * The AutoPay limit sent to Razorpay and shown before approval: one fixed amount for every plan,
 * raised only if a renewal is ever larger, so plan or add-on changes never need a new approval.
 */
export class AutoPayLimitService {
  /** Pure: needs only this month's renewal, so callers never query the plan for it. */
  static forRenewal(renewalPaise: number): AutoPayLimit {
    return {
      limitPaise: Math.max(AUTOPAY_DEFAULT_LIMIT_PAISE, renewalPaise),
      lines: [],
      uncapped: [],
    };
  }
}
