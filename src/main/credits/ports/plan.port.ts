import type { MessageLimit } from '../types/credits.types';
import type { MessageChannel } from '../utils/creditTypes.utils';

/** Plan data the module reads from subscriptions; it never writes there. */
export interface PlanPort {
  /** No plan, or no limit set on the plan, reads as unlimited. */
  getMessageLimit(
    clinicId: string,
    channel: MessageChannel
  ): Promise<MessageLimit>;
  /** The moment the clinic's current plan started; its day of month is the renewal day. */
  getBillingAnchor(clinicId: string): Promise<Date>;
  /** Plans with no limit row for this channel, which therefore read as unlimited. */
  getPlansWithoutMessageLimit(
    channel: MessageChannel
  ): Promise<{ planId: string; planName: string }[]>;
}
