import { subscriptionEmailEvents } from '../registry/subscription';
import { EMAIL_TEMPLATES, renderEmailTemplate } from '../templates';

const base = {
  clinicId: 'c-1',
  adminName: 'Asha',
  clinicName: 'Sharma Clinic',
};
// One sample ctx per event, enough for its subject and template.
const SAMPLES: Record<string, Record<string, unknown>> = {
  'subscription.payment_receipt': {
    planName: 'Clinic',
    amount: '499',
    transactionId: 'pay_1',
    billingCycle: 'monthly',
    invoiceId: 'inv-1',
  },
  'subscription.addon_receipt': {
    transactionId: 'pay_2',
    totalAmount: 199,
    items: [
      {
        name: 'Extra doctor',
        quantity: 1,
        billingCycle: 'monthly',
        amount: 199,
      },
    ],
  },
  'subscription.payment_failed': {
    itemName: 'Clinic',
    amount: 499,
    reason: 'Declined',
    itemType: 'subscription',
  },
  'subscription.trial_started': {
    planName: 'Clinic',
    trialDays: 14,
    trialEndsAt: '2026-11-18T00:00:00.000Z',
  },
  'subscription.change_scheduled': {
    planName: 'Solo',
    effectiveAt: '2026-12-01T00:00:00.000Z',
    scheduled: true,
    fromBillingCycle: 'monthly',
    billingCycle: 'monthly',
  },
  'subscription.change_undone': {
    currentPlanName: 'Clinic',
    cancelledPlanName: 'Solo',
  },
  'subscription.addon_removal_scheduled': {
    addOnName: 'Extra doctor',
    effectiveAt: '2026-12-01T00:00:00.000Z',
    scheduled: true,
    quantity: 1,
  },
  'subscription.addon_reduction_scheduled': {
    addOnName: 'Extra doctor',
    previousQuantity: 3,
    newQuantity: 1,
    effectiveAt: '2026-12-01T00:00:00.000Z',
  },
  'subscription.trial_ending': {
    planName: 'Clinic',
    trialEndsAt: '2026-11-07T00:00:00.000Z',
    daysLeft: 3,
  },
  'subscription.renewal_reminder': {
    planName: 'Clinic',
    billingCycle: 'monthly',
    periodEnd: '2026-11-11T00:00:00.000Z',
    amount: '897.00',
    daysLeft: 7,
  },
  'subscription.expired': {
    planName: 'Clinic',
    endedAt: '2026-11-04T00:00:00.000Z',
    cancelled: false,
  },
  'subscription.change_applied': {
    summary: '1 add-on change you scheduled now applies.',
    effectiveAt: '2026-11-04T00:00:00.000Z',
  },
  'subscription.staff_access_scheduled': {
    userIds: ['u-2'],
    changeSummary: 'Extra doctor ends',
    effectiveAt: '2026-12-01T00:00:00.000Z',
  },
  'subscription.staff_access_ending': {
    userIds: ['u-2'],
    changeSummary: 'Extra doctor ends',
    effectiveAt: '2026-12-01T00:00:00.000Z',
  },
  'subscription.staff_access_kept': {
    userIds: ['u-2'],
    currentPlanName: 'CareHub',
    cancelledPlanName: 'Clinic',
    effectiveAt: null,
  },
  'subscription.price_change': {
    planName: 'Clinic',
    billingCycle: 'monthly',
    oldPrice: '499.00',
    newPrice: '599.00',
    from: '2026-12-01T00:00:00.000Z',
  },
};

describe('subscription email events', () => {
  it('has a sample for every email event, so none is left untested', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(
      Object.keys(subscriptionEmailEvents).sort()
    );
  });

  it.each(Object.entries(subscriptionEmailEvents))(
    '%s renders with a real template',
    (key, event) => {
      const ctx = { ...base, ...SAMPLES[key] };
      const message = event.audiences[0].message.email!(ctx as never);
      expect(EMAIL_TEMPLATES[message.template]).toBeDefined();
      expect(message.subject).toBeTruthy();
      // Props travel through Redis as JSON, then render exactly as the worker does.
      const props = JSON.parse(
        JSON.stringify({
          ...message.props,
          adminName: 'Asha',
          recipientName: 'Asha',
          recipientRole: 'Doctor',
          clinicName: 'Sharma Clinic',
        })
      );
      expect(renderEmailTemplate(message.template, props)).toContain('Asha');
    }
  );

  it('attaches the invoice to a receipt, scoped to the clinic', () => {
    const message = subscriptionEmailEvents['subscription.payment_receipt']
      .audiences[0].message.email!({
      ...base,
      ...SAMPLES['subscription.payment_receipt'],
    } as never);
    expect(message.attachments).toEqual([
      { kind: 'invoice', ownerId: 'c-1', id: 'inv-1' },
    ]);
  });
});
