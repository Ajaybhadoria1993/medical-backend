import logger from '../../../utils/logger';
import { PayoutAccountWebhookService } from './payoutAccount/payoutAccountWebhook.service';

/** A Razorpay webhook body, as much as the router reads. */
export interface RazorpayEvent {
  event: string;
  payload?: Record<string, any>;
}

/** Without Razorpay's event id header: the event and its entity id, stable across its retries. */
const fallbackEventId = (body: RazorpayEvent) => {
  const p = body.payload ?? {};
  const entity = Object.values(p).find((v) => v?.entity?.id)?.entity;
  return `${body.event}:${entity?.id ?? ''}:${entity?.status ?? ''}`;
};

/** Sends each Razorpay event to the module that owns it; every webhook URL calls this. */
export class RazorpayWebhookRouter {
  /** Saves a verified event to the inbox so the reply is immediate; it runs in the background with retries. */
  static async route(body: RazorpayEvent, eventId?: string): Promise<void> {
    // Loaded here: these modules import payment, so a top-level import would be circular.
    const { WebhookService } = await import('../../subscription');
    await WebhookService.receive(eventId || fallbackEventId(body), body);
  }

  /** Runs one stored event in its owner; a throw retries it. Returns a note worth a human look. */
  static async dispatch(body: RazorpayEvent): Promise<string | undefined> {
    const event = body.event ?? '';
    const { WebhookService } = await import('../../subscription');
    if (
      event.startsWith('order.notification.') ||
      event.startsWith('token.') ||
      (await WebhookService.isOurs(body as never))
    )
      return WebhookService.dispatch(body as never);

    if (event === 'payment.captured' || event === 'payment.failed') {
      const payment = body.payload?.payment?.entity;
      const notes = payment?.notes ?? {};
      // App bookings carry the temporary booking id as checkoutReferenceId, the id confirm expects.
      const appointmentId =
        notes.appointmentId ??
        (notes.sourceType === 'APPOINTMENT'
          ? notes.checkoutReferenceId
          : undefined);
      const { patientId } = notes;
      if (appointmentId && patientId) {
        const { PatientService } =
          await import('../../patient/services/patient.service');
        if (event === 'payment.captured')
          await PatientService.confirmPaymentAndAppoint(
            appointmentId,
            payment.id,
            patientId
          );
        else
          await PatientService.handlePaymentFailure(
            appointmentId,
            payment.id,
            patientId
          );
        return;
      }
    }

    if (PayoutAccountWebhookService.handles(event)) {
      await PayoutAccountWebhookService.handle(event, body.payload);
      return;
    }

    const { ClinicFinanceProviderWebhookService } =
      await import('../../clinicFinance/services/financeProviderWebhook.service');
    if (await ClinicFinanceProviderWebhookService.handleRazorpayWebhook(body))
      return;
    logger.debug(`[RazorpayWebhook] Ignored ${event}: no handler owns it`);
  }
}
