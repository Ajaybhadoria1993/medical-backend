import {
  renderActionButton,
  renderAlertBox,
  renderEmailLayout,
  renderLinkFallback,
} from './emailTemplateLayout';

export interface AddOnInfo {
  name: string;
  quantity: number;
  price: number;
}

export interface SubscriptionRenewalParams {
  adminName: string;
  clinicName: string;
  planName: string;
  planPrice: number;
  billingCycle: string;
  addOns: AddOnInfo[];
  totalAmount: number;
  expiresAt: Date;
  daysRemaining: number;
  renewalUrl: string;
  staffCount: number;
  doctorCount: number;
  staffLimit: number;
  doctorLimit: number;
}

export function subscriptionRenewalTemplate(
  params: SubscriptionRenewalParams
): string {
  const {
    adminName,
    clinicName,
    planName,
    planPrice,
    billingCycle,
    addOns,
    totalAmount,
    expiresAt,
    daysRemaining,
    renewalUrl,
    staffCount,
    doctorCount,
    staffLimit,
    doctorLimit,
  } = params;

  const expiryDate = expiresAt.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const formatCurrency = (amount: number) =>
    `₹${amount.toLocaleString('en-IN')}`;

  const willLoseAccess = staffCount > staffLimit || doctorCount > doctorLimit;

  const urgencyLabel =
    daysRemaining <= 1
      ? 'expires tomorrow'
      : `expires in ${daysRemaining} day${daysRemaining > 1 ? 's' : ''}`;

  const supportEmail =
    process.env.SUPPORT_EMAIL || 'support@infinitymedisetu.com';
  const supportPhone = process.env.SUPPORT_PHONE || '+91 8770553894';

  const addOnRows = addOns
    .map(
      (a) => `
        <tr>
          <td style="border-bottom:1px solid #dfe9e8; color:#60707c; font-family:'Outfit', Arial, Helvetica, sans-serif; font-size:11px; line-height:17px; padding:10px 12px;">
            ${a.name} × ${a.quantity}
          </td>
          <td align="right" style="border-bottom:1px solid #dfe9e8; color:#243533; font-family:'Outfit', Arial, Helvetica, sans-serif; font-size:11px; font-weight:700; line-height:17px; padding:10px 12px;">
            ${formatCurrency(a.price)}
          </td>
        </tr>`
    )
    .join('');

  const limitAlert = willLoseAccess
    ? renderAlertBox(
        'Staff Limit Alert',
        `You currently have <strong>${doctorCount} doctor(s)</strong> (free limit: ${doctorLimit}) and <strong>${staffCount} staff member(s)</strong> (free limit: ${staffLimit}). Excess accounts will be deactivated if you revert to the Solo tier.`,
        'danger'
      )
    : '';

  return renderEmailLayout({
    title: 'Subscription Renewal Reminder',
    preview: `${clinicName} subscription ${urgencyLabel}.`,
    greeting: `Hi ${adminName} 👋`,
    headline: `${clinicName} subscription ${urgencyLabel}.`,
    message: `Your ${planName} subscription is nearing expiry. Renew now to keep all your staff accounts and features active without interruption.`,
    email: supportEmail,
    phone: supportPhone,
    bodyHtml: `
      ${renderAlertBox(
        'Expires on',
        `${expiryDate}. ${daysRemaining} day${daysRemaining > 1 ? 's' : ''} left.`,
        daysRemaining <= 3 ? 'danger' : 'info'
      )}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbfffe; border:1px solid #d8e9ec; border-radius:7px; border-collapse:separate; margin:0 0 16px; overflow:hidden;">
                <tr>
                  <td colspan="2" style="background:#eefaf9; border-bottom:1px solid #d8e9ec; color:#0b6867; font-family:'Outfit', Arial, Helvetica, sans-serif; font-size:13px; font-weight:700; line-height:18px; padding:11px 12px;">
                    Renewal Summary (${billingCycle})
                  </td>
                </tr>
                <tr>
                  <td style="border-bottom:1px solid #dfe9e8; color:#60707c; font-family:'Outfit', Arial, Helvetica, sans-serif; font-size:11px; line-height:17px; padding:10px 12px;">
                    ${planName} Base Plan
                  </td>
                  <td align="right" style="border-bottom:1px solid #dfe9e8; color:#243533; font-family:'Outfit', Arial, Helvetica, sans-serif; font-size:11px; font-weight:700; line-height:17px; padding:10px 12px;">
                    ${formatCurrency(planPrice)}
                  </td>
                </tr>
                ${addOnRows}
                <tr>
                  <td style="color:#243533; font-family:'Outfit', Arial, Helvetica, sans-serif; font-size:12px; font-weight:700; line-height:18px; padding:12px;">
                    Total
                  </td>
                  <td align="right" style="color:#079a96; font-family:'Outfit', Arial, Helvetica, sans-serif; font-size:12px; font-weight:700; line-height:18px; padding:12px;">
                    ${formatCurrency(totalAmount)}/${billingCycle === 'yearly' ? 'year' : 'month'}
                  </td>
                </tr>
              </table>

              ${limitAlert}

              ${renderActionButton(
                `Renew Now - ${formatCurrency(totalAmount)}`,
                renewalUrl
              )}
              ${renderLinkFallback('Or visit this renewal link:', renewalUrl)}
              ${renderAlertBox(
                "If you've already renewed",
                'Please ignore this email.',
                'info'
              )}
    `,
  });
}
