import {
  renderActionButton,
  renderAlertBox,
  renderDetailsCard,
  renderEmailLayout,
} from '../../../../htmltamplates/emailTemplateLayout';

const PAYOUTS_URL = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/finance?tab=payouts`;

/** Told to clinic Admins and Super Admins when an online payment's transfer to the clinic fails or is reversed. */
export function transferFailedTemplate(p: {
  recipientName: string;
  clinicName: string;
  amount: string;
  reversed: boolean;
  reason: string | null;
  patientName?: string;
  when?: string;
  transferId: string;
}) {
  const what = p.reversed ? 'was taken back' : "didn't reach the clinic's bank";
  return renderEmailLayout({
    title: 'A payout needs a look',
    preview: `₹${p.amount} ${what}`,
    greeting: `Hi ${p.recipientName || 'there'} 👋`,
    headline: 'A payout needs a look',
    message: `₹${p.amount} from an online payment ${what}. The MediArogya team has been told too.`,
    bodyHtml: `
      ${renderAlertBox('Reason from Razorpay', p.reason || 'No reason given', 'warning')}
      ${renderDetailsCard('Details', [
        { label: 'Clinic', value: p.clinicName },
        { label: 'Patient', value: p.patientName || '—' },
        { label: 'Visit', value: p.when || '—' },
        { label: 'Amount', value: `₹${p.amount}` },
        { label: 'Razorpay transfer', value: p.transferId },
      ])}
      ${renderActionButton('Open Payouts', PAYOUTS_URL)}
    `,
  });
}
