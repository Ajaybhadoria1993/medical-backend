import {
  renderActionButton,
  renderAlertBox,
  renderDetailsCard,
  renderEmailLayout,
} from '../../../../htmltamplates/emailTemplateLayout';
import { formatISTDate } from '../../../../utils/istDateTime';

const SUBSCRIPTION_URL = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/subscription`;
const inDays = (n: number) => (n <= 1 ? 'tomorrow' : `in ${n} days`);

type Base = { adminName: string; clinicName: string };
const page = (
  p: Base,
  title: string,
  headline: string,
  message: string,
  bodyHtml: string
) =>
  renderEmailLayout({
    title,
    preview: message,
    greeting: `Hi ${p.adminName || 'there'},`,
    headline,
    message,
    bodyHtml,
  });

/** Reminder and lifecycle emails; card or UPI details never appear in them. */
export const trialEndingTemplate = (
  p: Base & { planName: string; trialEndsAt: Date; daysLeft: number }
) =>
  page(
    p,
    'Your free trial is ending',
    `Your ${p.planName} trial ends ${inDays(p.daysLeft)}`,
    `On ${formatISTDate(p.trialEndsAt)} ${p.clinicName} moves to the Free plan unless you choose a paid plan.`,
    renderAlertBox(
      'What changes',
      'Features and accounts beyond the Free plan stop when the trial ends.',
      'info'
    ) + renderActionButton('Choose a plan', SUBSCRIPTION_URL)
  );

export const renewalReminderTemplate = (
  p: Base & {
    planName: string;
    billingCycle: string;
    periodEnd: Date;
    amount: string;
    daysLeft: number;
    graceUntil?: Date | null;
  }
) =>
  p.graceUntil
    ? page(
        p,
        'Payment due',
        `Payment due for ${p.planName}`,
        `Your plan's period ended on ${formatISTDate(p.periodEnd)}. Everything keeps working until ${formatISTDate(p.graceUntil)}; pay by then or ${p.clinicName} moves to the Free plan.`,
        renderDetailsCard('Renewal', [
          { label: 'Plan', value: `${p.planName} (${p.billingCycle})` },
          { label: 'Amount', value: `₹${p.amount}` },
          { label: 'Pay by', value: formatISTDate(p.graceUntil) },
        ]) + renderActionButton('Pay now', SUBSCRIPTION_URL)
      )
    : page(
        p,
        'Renewal reminder',
        `${p.planName} renews ${inDays(p.daysLeft)}`,
        `Pay before ${formatISTDate(p.periodEnd)} to keep ${p.clinicName} on ${p.planName}. Without payment it moves to the Free plan.`,
        renderDetailsCard('Renewal', [
          { label: 'Plan', value: `${p.planName} (${p.billingCycle})` },
          { label: 'Amount', value: `₹${p.amount}` },
          { label: 'Due by', value: formatISTDate(p.periodEnd) },
        ]) + renderActionButton('Renew now', SUBSCRIPTION_URL)
      );

export const expiredTemplate = (
  p: Base & { planName: string; endedAt: Date; cancelled: boolean }
) =>
  page(
    p,
    'Your plan has ended',
    `${p.clinicName} is now on the Free plan`,
    p.cancelled
      ? `${p.planName} ended on ${formatISTDate(p.endedAt)}, as you asked.`
      : `${p.planName} ended on ${formatISTDate(p.endedAt)} because it was not renewed.`,
    renderAlertBox(
      'What changed',
      'Accounts and features beyond the Free plan are switched off. Your data is kept.',
      'warning'
    ) + renderActionButton('Choose a plan', SUBSCRIPTION_URL)
  );

export const changeAppliedTemplate = (
  p: Base & { summary: string; effectiveAt: Date }
) =>
  page(
    p,
    'Scheduled changes applied',
    'Scheduled changes applied',
    `From ${formatISTDate(p.effectiveAt)}: ${p.summary}`,
    renderActionButton('View subscription', SUBSCRIPTION_URL)
  );

export const planEndingTemplate = (
  p: Base & { planName: string; endsAt: Date; replacementName: string | null }
) =>
  page(
    p,
    'Your plan is ending',
    `${p.planName} ends on ${formatISTDate(p.endsAt)}`,
    p.replacementName
      ? `Your access stays until your current period ends. At your next renewal after ${formatISTDate(p.endsAt)}, renew on ${p.replacementName}.`
      : `Your access stays until your current period ends. Before your next renewal after ${formatISTDate(p.endsAt)}, choose another plan.`,
    renderDetailsCard('What changes', [
      { label: 'Plan', value: p.planName },
      { label: 'Ends on', value: formatISTDate(p.endsAt) },
      { label: 'Next plan', value: p.replacementName ?? 'Your choice' },
    ]) + renderActionButton('View subscription', SUBSCRIPTION_URL)
  );

export const refundIssuedTemplate = (
  p: Base & {
    amount: string;
    itemName: string;
    creditNoteNumber: string | null;
    invoiceNumber: string | null;
    endedItem: string | null;
  }
) =>
  page(
    p,
    'Refund issued',
    `₹${p.amount} refunded for ${p.itemName}`,
    'The money goes back to the account you paid from, usually in 5–7 working days.',
    renderDetailsCard('Refund', [
      { label: 'Item', value: p.itemName },
      { label: 'Amount', value: `₹${p.amount}` },
      ...(p.invoiceNumber
        ? [{ label: 'Invoice', value: p.invoiceNumber }]
        : []),
      ...(p.creditNoteNumber
        ? [{ label: 'Credit note', value: `${p.creditNoteNumber} (attached)` }]
        : []),
    ]) +
      (p.endedItem ? renderAlertBox('What ends', p.endedItem, 'info') : '') +
      renderActionButton('View billing', SUBSCRIPTION_URL)
  );

export const autoPayChangedTemplate = (
  p: Base & {
    on: boolean;
    maxAmount: string | null;
    reason: string | null;
    renewBy: Date | null;
  }
) =>
  p.on
    ? page(
        p,
        'AutoPay is on',
        'AutoPay is on',
        `Your plan renews automatically. You get a notice before each charge, and you can turn AutoPay off any time.`,
        renderDetailsCard('AutoPay', [
          ...(p.maxAmount
            ? [{ label: 'Charge limit', value: `Up to ₹${p.maxAmount}` }]
            : []),
        ]) + renderActionButton('View billing', SUBSCRIPTION_URL)
      )
    : page(
        p,
        'AutoPay is off',
        'AutoPay is off',
        p.renewBy
          ? `Renew by ${formatISTDate(p.renewBy)} to keep access. You can turn AutoPay on again from billing.`
          : 'Renew your plan yourself before it ends. You can turn AutoPay on again from billing.',
        (p.reason ? renderAlertBox('Why', p.reason, 'info') : '') +
          renderActionButton('Renew or turn on AutoPay', SUBSCRIPTION_URL)
      );

export const planExtendedTemplate = (
  p: Base & { planName: string; days: number; endsAt: Date }
) =>
  page(
    p,
    'Your plan was extended',
    `${p.planName} now runs until ${formatISTDate(p.endsAt)}`,
    `We added ${p.days} day${p.days === 1 ? '' : 's'} to your plan at no charge. AutoPay and reminders follow the new date.`,
    renderActionButton('View subscription', SUBSCRIPTION_URL)
  );

export const priceChangeTemplate = (
  p: Base & {
    planName: string;
    billingCycle: string;
    oldPrice: string;
    newPrice: string;
    from: Date;
  }
) =>
  page(
    p,
    'Price change at your next renewal',
    `${p.planName} will cost ₹${p.newPrice} at renewal`,
    `Your current price stays until your period ends. Renewals from ${formatISTDate(p.from)} are ₹${p.newPrice} instead of ₹${p.oldPrice}.`,
    renderDetailsCard('Price change', [
      { label: 'Plan', value: `${p.planName} (${p.billingCycle})` },
      { label: 'Now', value: `₹${p.oldPrice}` },
      { label: 'At next renewal', value: `₹${p.newPrice}` },
    ]) + renderActionButton('View subscription', SUBSCRIPTION_URL)
  );
