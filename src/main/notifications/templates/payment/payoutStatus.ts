import {
  renderActionButton,
  renderAlertBox,
  renderEmailLayout,
} from '../../../../htmltamplates/emailTemplateLayout';

const PAYOUT_URL = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/link-clinic-account`;

/** Told to clinic Admins when Razorpay finishes checking the payout account. */
export function payoutsReadyTemplate(p: { recipientName: string }) {
  return renderEmailLayout({
    title: 'Payouts are ready',
    preview: 'Online booking money now reaches your bank automatically',
    greeting: `Hi ${p.recipientName || 'there'} 👋`,
    headline: 'Payouts are ready',
    message:
      'Razorpay checked your payout details. Money from online bookings now reaches your account automatically, usually within 2 working days.',
    bodyHtml: renderActionButton('Open Payout Account', PAYOUT_URL),
  });
}

/** Told to clinic Admins when Razorpay needs a change, rejects, suspends or locks the payout account. */
export function payoutActionNeededTemplate(p: {
  recipientName: string;
  reason: string | null;
  suspended: boolean;
}) {
  const headline = p.suspended
    ? 'Payouts are paused'
    : 'Your payout account needs a change';
  return renderEmailLayout({
    title: headline,
    preview: p.reason || 'Razorpay needs a change before payouts can start',
    greeting: `Hi ${p.recipientName || 'there'} 👋`,
    headline,
    message: p.suspended
      ? 'Razorpay has paused payouts to your account. Patient payments still work; money waits until this is fixed.'
      : "Razorpay can't send online booking money to your account until this is fixed. Patient payments still work.",
    bodyHtml: `
      ${renderAlertBox('Reason from Razorpay', p.reason || 'No reason given', 'warning')}
      ${renderActionButton('Fix Payout Account', PAYOUT_URL)}
    `,
  });
}
