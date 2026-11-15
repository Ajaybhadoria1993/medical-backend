import {
  renderActionButton,
  renderAlertBox,
  renderDetailsCard,
  renderEmailLayout,
} from '../../../../htmltamplates/emailTemplateLayout';

const CHECKS_URL = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/business/revenue?tab=checks`;

/** Daily note to Super Admins when billing needs a look; lists only what is wrong. */
export function billingAlertTemplate(p: {
  recipientName: string;
  differences: number;
  webhookQuiet: boolean;
  lastWebhookAt: string | null;
  autoPayFailed: number;
  pastDue: number;
  webhooksStuck?: number;
  jobsNeedingLook?: string[];
  appointmentPayments?: string[];
}) {
  const issues: string[] = [];
  if (p.differences)
    issues.push(
      `${p.differences} payment${p.differences === 1 ? '' : 's'} differ from Razorpay`
    );
  if (p.webhookQuiet) issues.push('No Razorpay event for over 6 hours');
  if (p.autoPayFailed)
    issues.push(
      `${p.autoPayFailed} AutoPay charges failed in the last 24 hours`
    );
  if (p.webhooksStuck)
    issues.push(
      `${p.webhooksStuck} Razorpay event${p.webhooksStuck === 1 ? '' : 's'} could not be applied after every retry`
    );
  if (p.jobsNeedingLook?.length)
    issues.push(`Background jobs need a look: ${p.jobsNeedingLook.join(', ')}`);
  if (p.appointmentPayments?.length)
    issues.push(
      `Appointment payments need a look: ${p.appointmentPayments.join(', ')}`
    );
  return renderEmailLayout({
    title: 'Billing needs a look',
    preview: issues.join(' · '),
    greeting: `Hi ${p.recipientName || 'there'} 👋`,
    headline: 'Billing needs a look',
    message:
      'The daily check found something to review. Nothing is changed until you act.',
    bodyHtml: `
      ${renderAlertBox('What was found', issues.join('<br/>'), 'warning')}
      ${renderDetailsCard('Details', [
        {
          label: 'Open differences with Razorpay',
          value: String(p.differences),
        },
        {
          label: 'Last Razorpay event',
          value: p.lastWebhookAt
            ? new Date(p.lastWebhookAt).toLocaleString('en-IN', {
                timeZone: 'Asia/Kolkata',
              })
            : 'Never',
        },
        {
          label: 'AutoPay charges failed (24 h)',
          value: String(p.autoPayFailed),
        },
        { label: 'Plans past due', value: String(p.pastDue) },
        {
          label: 'Razorpay events stuck (7 days)',
          value: String(p.webhooksStuck ?? 0),
        },
      ])}
      ${renderActionButton('Open Billing checks', CHECKS_URL)}
    `,
  });
}
