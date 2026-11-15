import { notify } from '../../notifications/queues/notification.queue';

/** Billing emails go through the notifications module; the registry entry (registry/subscription) says what each sends.
 *  `dedupeKey` (a payment, subscription or change id) makes a replay send nothing twice. */
export function subscriptionNotify(
  event: string,
  ctx: { clinicId: string } & Record<string, unknown>,
  dedupeKey: string
) {
  // BullMQ refuses ':' in a custom job id.
  return notify(event, ctx, {
    jobId: `${event}|${dedupeKey}`.replace(/:/g, '_'),
  });
}
