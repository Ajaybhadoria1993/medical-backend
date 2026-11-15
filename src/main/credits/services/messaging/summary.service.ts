import type { MessageChannel } from '../../utils/creditTypes.utils';
import { AllowanceService } from '../core/allowance.service';
import { GrantsService } from '../core/grants.service';
import { CreditSettingsService } from '../core/settings.service';

export class SummaryService {
  /** What the clinic's WhatsApp card shows: free messages this billing month and credits. */
  static async forClinic(clinicId: string, channel: MessageChannel) {
    const [decision, balance, nextExpiring, settings] = await Promise.all([
      AllowanceService.decide(clinicId, channel),
      GrantsService.balance(clinicId, channel),
      GrantsService.nextExpiring(clinicId, channel),
      CreditSettingsService.getInForce(channel),
    ]);

    const free =
      decision.source === 'unlimited'
        ? { unlimited: true as const }
        : {
            unlimited: false as const,
            used: Math.min(decision.used, decision.limit),
            limit: decision.limit,
            periodStart: decision.period.start,
            resetsAt: decision.period.end,
            // The same warning point the alert uses, so the card and the alert agree.
            warnPercent: settings.warnPercent,
          };

    return {
      channel,
      free,
      credits: { balance, nextExpiring },
      // What happens to the next message: send it free, by credit, or not at all.
      next: decision.source,
    };
  }
}
