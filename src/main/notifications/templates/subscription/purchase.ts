import {
  renderActionButton,
  renderAlertBox,
  renderDetailsCard,
  renderEmailLayout,
  renderLinkFallback,
} from '../../../../htmltamplates/emailTemplateLayout';

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[char];
  });

export function subscriptionPurchaseSuccessTemplate(params: {
  adminName: string;
  clinicName: string;
  planName: string;
  amount: string;
  transactionId: string;
  invoiceUrl?: string;
  invoiceAttached?: boolean;
  paid?: boolean;
  trialDays?: number | null;
  trialEndsAt?: Date | null;
  billingCycle?: 'monthly' | 'yearly';
  addOns?: Array<{ name: string; quantity: number }>;
}) {
  const adminName = escapeHtml(params.adminName || 'there');
  const clinicName = escapeHtml(params.clinicName || 'your clinic');
  const planName = escapeHtml(params.planName);
  const invoiceUrl =
    params.invoiceUrl ||
    `${process.env.FRONTEND_URL || 'http://localhost:5173'}/subscription`;
  const isFreeTrial = params.paid === false && Number(params.trialDays) > 0;
  const trialEndDate = params.trialEndsAt
    ? params.trialEndsAt.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;
  const headline = isFreeTrial
    ? `Your ${params.trialDays}-day free trial is active`
    : 'Your subscription is active';
  const message = params.paid
    ? `Thank you. Your payment went through and ${planName} is now active for ${clinicName}.`
    : isFreeTrial
      ? `Your ${params.trialDays}-day free trial of ${planName} is active for ${clinicName}${trialEndDate ? ` through ${trialEndDate}` : ''}.`
      : `${planName} is now active for ${clinicName}.`;

  return renderEmailLayout({
    title: isFreeTrial
      ? `${params.trialDays}-Day Free Trial Started`
      : params.paid
        ? 'Subscription Purchase Successful'
        : 'Subscription Plan Activated',
    preview: isFreeTrial
      ? `${planName} free trial is active for ${params.trialDays} days.`
      : `${planName} is now active for ${clinicName}.`,
    greeting: `Hi ${adminName},`,
    headline,
    message,
    bodyHtml: `
      ${renderAlertBox(
        params.paid
          ? 'Payment details'
          : isFreeTrial
            ? 'Trial details'
            : 'Plan status',
        params.paid
          ? `${planName}${params.billingCycle ? ` · Billed ${params.billingCycle}` : ''} · Paid ${escapeHtml(params.amount)} · Payment ID ${escapeHtml(params.transactionId || '-')}`
          : isFreeTrial
            ? `${planName} · ${params.trialDays} days${trialEndDate ? ` · Ends ${escapeHtml(trialEndDate)}` : ''}`
            : `${planName} · Active`,
        'success'
      )}
      ${
        params.paid
          ? renderAlertBox(
              'Invoice',
              params.invoiceAttached
                ? 'Your invoice for this purchase is attached to this email.'
                : 'You can download your invoice from subscription settings.',
              params.invoiceAttached ? 'success' : 'info'
            )
          : ''
      }
      ${
        params.paid && params.addOns?.length
          ? renderDetailsCard('Add-ons included with this purchase', [
              {
                label: 'Add-ons',
                value: params.addOns
                  .map(
                    (item) =>
                      `${Math.max(0, Number(item.quantity) || 0)} × ${escapeHtml(item.name)}`
                  )
                  .join('<br />'),
              },
            ])
          : ''
      }
      ${renderActionButton('Open subscription settings', invoiceUrl)}
      ${renderLinkFallback(
        'Button not working? Copy this link into your browser:',
        invoiceUrl
      )}
    `,
  });
}

export function subscriptionPurchaseFailureTemplate(params: {
  adminName: string;
  clinicName: string;
  itemName: string;
  amount?: string | null;
  reason: string;
  droppedCheckout: boolean;
  itemType?: 'subscription' | 'addon';
  retryUrl?: string;
  autoPay?: { retryOn: string | null; accessUntil: string };
}) {
  const adminName = escapeHtml(params.adminName || 'there');
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    });
  const clinicName = escapeHtml(params.clinicName || 'your clinic');
  const itemName = escapeHtml(params.itemName || 'subscription plan');
  const retryUrl =
    params.retryUrl ||
    `${process.env.FRONTEND_URL || 'http://localhost:5173'}/subscription`;
  const isAddOn = params.itemType === 'addon';
  const headline = params.droppedCheckout
    ? 'Checkout was closed before payment'
    : isAddOn
      ? 'We could not process your add-on payment'
      : 'We could not complete your payment';
  const autoPayMessage = params.autoPay
    ? `Your AutoPay payment for ${itemName} did not go through. ${
        params.autoPay.retryOn
          ? `We will try again on ${day(params.autoPay.retryOn)}.`
          : 'We will not try again this month.'
      } To keep ${clinicName} on its plan after ${day(params.autoPay.accessUntil)}, you can pay now.`
    : null;
  const message = autoPayMessage
    ? autoPayMessage
    : params.droppedCheckout
      ? `You closed the payment window for ${itemName} before paying, so nothing was charged to ${clinicName}. You can try again whenever you are ready.`
      : isAddOn
        ? `The payment for ${itemName} did not go through, so the add-on was not added to ${clinicName}. Your current plan is not affected.`
        : `The payment for ${itemName} did not go through, so ${clinicName} has not been charged. Please try again, or use another card, UPI or bank.`;

  return renderEmailLayout({
    title: params.droppedCheckout
      ? `${isAddOn ? 'Add-on' : 'Subscription'} Checkout Incomplete`
      : `${isAddOn ? 'Add-on' : 'Subscription'} Payment Failed`,
    preview: `${itemName}: ${params.droppedCheckout ? 'checkout incomplete' : 'payment failed'}.`,
    greeting: `Hi ${adminName},`,
    headline,
    message,
    bodyHtml: `
      ${renderAlertBox(
        params.droppedCheckout ? 'Checkout status' : 'Payment status',
        `${itemName}${params.amount ? ` · ${escapeHtml(params.amount)}` : ''}${params.reason ? ` · ${escapeHtml(params.reason)}` : ''}`,
        'warning'
      )}
      ${renderActionButton(params.autoPay ? 'Pay now' : 'Try again', retryUrl)}
      ${renderLinkFallback(
        'Button not working? Copy this link into your browser:',
        retryUrl
      )}
    `,
  });
}

export function subscriptionPlanChangeTemplate(params: {
  adminName: string;
  clinicName: string;
  planName: string;
  effectiveAt: Date;
  scheduled: boolean;
  fromBillingCycle?: 'monthly' | 'yearly';
  billingCycle?: 'monthly' | 'yearly';
  addOns?: Array<{ name: string; quantity: number }>;
  invoiceAttached?: boolean;
  accountImpact?: {
    continuingDoctors: string[];
    deactivatedDoctors: string[];
    continuingStaff: string[];
    deactivatedStaff: string[];
  };
}) {
  const adminName = escapeHtml(params.adminName || 'there');
  const clinicName = escapeHtml(params.clinicName || 'your clinic');
  const planName = escapeHtml(params.planName);
  const effectiveDate = params.effectiveAt.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
  const title = params.scheduled
    ? 'Subscription Plan Change Scheduled'
    : 'Subscription Plan Changed';
  const headline = params.scheduled
    ? 'Your plan change is scheduled'
    : 'Your new plan is active';
  const cycleMessage =
    params.fromBillingCycle &&
    params.billingCycle &&
    params.fromBillingCycle !== params.billingCycle
      ? ` Billing changes from ${params.fromBillingCycle} to ${params.billingCycle}.`
      : params.billingCycle
        ? ` Billing is ${params.billingCycle}.`
        : '';
  const message = params.scheduled
    ? `${clinicName} is scheduled to move to ${planName} on ${effectiveDate}.${cycleMessage} Your current plan remains active until then.`
    : `${clinicName} is now on ${planName}, effective ${effectiveDate}.${cycleMessage}`;
  const addOnsHtml = params.addOns?.length
    ? renderDetailsCard('Add-ons included with this purchase', [
        {
          label: 'Add-ons',
          value: params.addOns
            .map((item) => `${item.quantity} × ${escapeHtml(item.name)}`)
            .join('<br />'),
        },
      ])
    : '';
  const accountList = (names: string[]) =>
    names.length
      ? names.map((name) => escapeHtml(name)).join('<br />')
      : 'None';
  const accountImpactHtml =
    params.scheduled && params.accountImpact
      ? `
        ${renderDetailsCard(`Accounts continuing on ${planName}`, [
          {
            label: 'Doctors',
            value: accountList(params.accountImpact.continuingDoctors),
          },
          {
            label: 'Staff',
            value: accountList(params.accountImpact.continuingStaff),
          },
        ])}
        ${renderDetailsCard('Accounts scheduled for deactivation', [
          {
            label: 'Doctors',
            value: accountList(params.accountImpact.deactivatedDoctors),
          },
          {
            label: 'Staff',
            value: accountList(params.accountImpact.deactivatedStaff),
          },
        ])}
      `
      : '';

  return renderEmailLayout({
    title,
    preview: `${planName} ${params.scheduled ? 'starts' : 'became active'} ${effectiveDate}.`,
    greeting: `Hi ${adminName},`,
    headline,
    message,
    bodyHtml: `
      ${
        params.billingCycle
          ? renderAlertBox(
              'Billing cycle',
              params.fromBillingCycle &&
                params.fromBillingCycle !== params.billingCycle
                ? `${params.fromBillingCycle} → ${params.billingCycle}`
                : params.billingCycle,
              'info'
            )
          : ''
      }
      ${
        params.invoiceAttached
          ? renderAlertBox(
              'Invoice',
              'Your invoice for this billing-cycle change is attached to this email.',
              'success'
            )
          : ''
      }
      ${accountImpactHtml}
      ${addOnsHtml}
      ${renderActionButton(
        'Open subscription settings',
        `${process.env.FRONTEND_URL || 'http://localhost:5173'}/subscription`
      )}
      ${renderLinkFallback(
        'Button not working? Copy this link into your browser:',
        `${process.env.FRONTEND_URL || 'http://localhost:5173'}/subscription`
      )}
    `,
  });
}

export function subscriptionPlanChangeReversedTemplate(params: {
  adminName: string;
  clinicName: string;
  currentPlanName: string;
  cancelledPlanName: string;
}) {
  const adminName = escapeHtml(params.adminName || 'there');
  const clinicName = escapeHtml(params.clinicName || 'your clinic');
  const currentPlanName = escapeHtml(params.currentPlanName || 'current plan');
  const cancelledPlanName = escapeHtml(
    params.cancelledPlanName || 'scheduled plan change'
  );

  return renderEmailLayout({
    title: 'Scheduled Plan Change Cancelled',
    preview: `The scheduled move to ${cancelledPlanName} was cancelled.`,
    greeting: `Hi ${adminName},`,
    headline: 'Your scheduled plan change was cancelled',
    message: `The scheduled change to ${cancelledPlanName} has been cancelled for ${clinicName}. Your current ${currentPlanName} plan remains active and its existing renewal schedule continues.`,
    bodyHtml: `
      ${renderAlertBox(
        'Plan change status',
        `Cancelled: ${cancelledPlanName} · Current plan: ${currentPlanName}`,
        'info'
      )}
      ${renderActionButton(
        'Open subscription settings',
        `${process.env.FRONTEND_URL || 'http://localhost:5173'}/subscription`
      )}
      ${renderLinkFallback(
        'Button not working? Copy this link into your browser:',
        `${process.env.FRONTEND_URL || 'http://localhost:5173'}/subscription`
      )}
    `,
  });
}

export function subscriptionRenewalPaymentSuccessTemplate(params: {
  adminName: string;
  clinicName: string;
  planName: string;
  amount: string;
  transactionId: string;
  renewedUntil: Date;
  billingCycle?: 'monthly' | 'yearly';
  invoiceAttached?: boolean;
}) {
  const adminName = escapeHtml(params.adminName || 'there');
  const clinicName = escapeHtml(params.clinicName || 'your clinic');
  const planName = escapeHtml(params.planName);
  const renewedUntil = params.renewedUntil.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return renderEmailLayout({
    title: 'Subscription Renewal Successful',
    preview: `${planName} renewed for ${clinicName}.`,
    greeting: `Hi ${adminName},`,
    headline: 'Your automatic renewal was successful',
    message: `${planName} for ${clinicName} has renewed successfully. Access is active through ${renewedUntil}.`,
    bodyHtml: `
      ${renderAlertBox(
        'Renewal payment',
        `${escapeHtml(params.amount)}${params.billingCycle ? ` · Billed ${params.billingCycle}` : ''} · Transaction ${escapeHtml(params.transactionId)}`,
        'success'
      )}
      ${renderAlertBox(
        'Invoice',
        params.invoiceAttached
          ? 'Your invoice for this renewal is attached to this email.'
          : 'You can download your invoice from subscription settings.',
        params.invoiceAttached ? 'success' : 'info'
      )}
      ${renderActionButton(
        'Open subscription settings',
        `${process.env.FRONTEND_URL || 'http://localhost:5173'}/subscription`
      )}
      ${renderLinkFallback(
        'Button not working? Copy this link into your browser:',
        `${process.env.FRONTEND_URL || 'http://localhost:5173'}/subscription`
      )}
    `,
  });
}

export function subscriptionRenewalPaymentFailureTemplate(params: {
  adminName: string;
  clinicName: string;
  planName: string;
  amount: string | null;
  transactionId?: string | null;
  reason: string;
  accessThrough: Date | null;
  autopayHalted: boolean;
}) {
  const adminName = escapeHtml(params.adminName || 'there');
  const clinicName = escapeHtml(params.clinicName || 'your clinic');
  const planName = escapeHtml(params.planName || 'subscription plan');
  const reason = escapeHtml(
    params.reason || 'The renewal payment could not be completed.'
  );
  const accessDate = params.accessThrough
    ? params.accessThrough.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Asia/Kolkata',
      })
    : null;
  const heading = params.autopayHalted
    ? 'AutoPay has stopped'
    : 'Your renewal payment did not go through';
  const message = params.autopayHalted
    ? `AutoPay for ${planName} at ${clinicName} has stopped after repeated failed renewal payments. ${reason} Your plan will not renew by itself, so please renew it yourself or set up AutoPay again.${accessDate ? ` Everything keeps working until ${accessDate}.` : ''}`
    : `The automatic renewal payment for ${planName} at ${clinicName} did not go through. ${reason} We may try again, so please check your payment method.${accessDate ? ` Everything keeps working until ${accessDate}.` : ''}`;

  return renderEmailLayout({
    title: heading,
    preview: `${heading}: ${clinicName}`,
    greeting: `Hi ${adminName},`,
    headline: heading,
    message,
    bodyHtml: `
      ${renderAlertBox(
        params.autopayHalted ? 'AutoPay status' : 'Renewal payment',
        [
          params.amount ? `Amount: ${escapeHtml(params.amount)}` : '',
          params.transactionId
            ? `Payment: ${escapeHtml(params.transactionId)}`
            : '',
          `Reason: ${reason}`,
        ]
          .filter(Boolean)
          .join(' · '),
        'warning'
      )}
      ${renderActionButton(
        'Open subscription settings',
        `${process.env.FRONTEND_URL || 'http://localhost:5173'}/subscription`
      )}
      ${renderLinkFallback(
        'Button not working? Copy this link into your browser:',
        `${process.env.FRONTEND_URL || 'http://localhost:5173'}/subscription`
      )}
    `,
  });
}

export function addOnPurchaseSuccessTemplate(params: {
  adminName: string;
  clinicName: string;
  items: Array<{
    name: string;
    quantity: number;
    billingCycle: 'monthly' | 'yearly' | 'one-time';
    amount: string;
  }>;
  totalAmount: string;
  transactionId: string;
  invoiceAttached: boolean;
}) {
  const adminName = escapeHtml(params.adminName || 'there');
  const clinicName = escapeHtml(params.clinicName || 'your clinic');
  const multipleAddOns = params.items.length > 1;
  // A WhatsApp message pack is bought once and spent later; it is not add-on capacity.
  const packOnly = params.items.every((i) => i.billingCycle === 'one-time');
  const addOnDetails = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbfffe; border:1px solid #d8e9ec; border-collapse:separate; border-radius:7px; margin:0 0 14px; table-layout:fixed;">
      <tr>
        <td colspan="2" style="padding:11px 13px 5px; color:#0d696d; font-family:'Outfit', sans-serif; font-size:12px; font-weight:700; line-height:17px;">
          ${packOnly ? 'What you bought' : multipleAddOns ? 'Your add-ons' : 'Your add-on'}
        </td>
      </tr>
      ${params.items
        .map(
          (item) => `
            <tr>
              <td style="padding:7px 8px 7px 13px; color:#263b40; font-family:'Outfit', sans-serif; font-size:11px; font-weight:600; line-height:16px; white-space:nowrap;">
                ${escapeHtml(item.name)}${item.billingCycle === 'one-time' ? '' : ` (${item.billingCycle})`}
              </td>
              <td align="right" style="padding:7px 13px 7px 8px; color:#52646e; font-family:'Outfit', sans-serif; font-size:11px; font-weight:500; line-height:16px; white-space:nowrap;">
                ${item.billingCycle === 'one-time' ? '' : `${item.quantity} ${item.quantity === 1 ? 'unit' : 'units'} · `}${escapeHtml(item.amount)}
              </td>
            </tr>`
        )
        .join('')}
    </table>`;

  return renderEmailLayout({
    title: packOnly
      ? 'WhatsApp Messages Added'
      : multipleAddOns
        ? 'Add-ons Activated'
        : 'Add-on Activated',
    preview: multipleAddOns
      ? `${params.items.length} add-ons are active for ${clinicName}.`
      : `${params.items[0]?.name || 'Your add-on'} is active for ${clinicName}.`,
    greeting: `Hi ${adminName},`,
    headline: packOnly
      ? 'Your WhatsApp messages are ready'
      : multipleAddOns
        ? 'Your add-ons are active'
        : 'Your add-on is active',
    message: `${packOnly ? `Your payment went through and the messages are now in ${clinicName}'s balance. They are used after your free monthly messages run out.` : `Your payment went through and ${multipleAddOns ? 'your add-ons are' : 'your add-on is'} now active for ${clinicName}.`} ${params.invoiceAttached ? 'Your invoice is attached.' : 'You can download your invoice from subscription settings.'}`,
    bodyHtml: `
      ${renderAlertBox(
        'Payment details',
        `Paid ${escapeHtml(params.totalAmount)} · Payment ID ${escapeHtml(params.transactionId || '-')}`,
        'success'
      )}
      ${addOnDetails}
      ${renderActionButton(
        'Open subscription settings',
        `${process.env.FRONTEND_URL || 'http://localhost:5173'}/subscription`
      )}
      ${renderLinkFallback(
        'Button not working? Copy this link into your browser:',
        `${process.env.FRONTEND_URL || 'http://localhost:5173'}/subscription`
      )}
    `,
  });
}

export function addOnCancellationTemplate(params: {
  adminName: string;
  clinicName: string;
  addOnName: string;
  effectiveAt: Date;
  scheduled: boolean;
  quantity?: number;
}) {
  const adminName = escapeHtml(params.adminName || 'there');
  const clinicName = escapeHtml(params.clinicName || 'your clinic');
  const addOnName = escapeHtml(params.addOnName || 'Add-on');
  const effectiveDate = params.effectiveAt.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const title = params.scheduled
    ? 'Add-on Renewal Cancellation Scheduled'
    : 'Add-on Cancelled';
  const status = params.scheduled
    ? `Cancellation scheduled for ${effectiveDate}`
    : `Cancelled effective ${effectiveDate}`;
  const accessMessage = params.scheduled
    ? `Your ${addOnName} access remains available through ${effectiveDate}. It will then end and will not renew.`
    : `Your ${addOnName} access ended on ${effectiveDate}. It will not renew.`;

  return renderEmailLayout({
    title,
    preview: `${addOnName} ${params.scheduled ? 'will end' : 'ended'} ${effectiveDate}.`,
    greeting: `Hi ${adminName},`,
    headline: title,
    message: `${accessMessage} This applies to ${clinicName}.`,
    bodyHtml: `
      ${renderAlertBox(
        'Cancellation status',
        `${status}${params.quantity ? ` · ${params.quantity} unit${params.quantity === 1 ? '' : 's'}` : ''}`,
        params.scheduled ? 'info' : 'warning'
      )}
      ${renderActionButton(
        'Open subscription settings',
        `${process.env.FRONTEND_URL || 'http://localhost:5173'}/subscription`
      )}
      ${renderLinkFallback(
        'Button not working? Copy this link into your browser:',
        `${process.env.FRONTEND_URL || 'http://localhost:5173'}/subscription`
      )}
    `,
  });
}

export function addOnQuantityReductionTemplate(params: {
  adminName: string;
  clinicName: string;
  addOnName: string;
  previousQuantity: number;
  newQuantity: number;
  effectiveAt: Date;
}) {
  const adminName = escapeHtml(params.adminName || 'there');
  const clinicName = escapeHtml(params.clinicName || 'your clinic');
  const addOnName = escapeHtml(params.addOnName || 'Add-on');
  const effectiveDate = params.effectiveAt.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return renderEmailLayout({
    title: 'Add-on Quantity Reduction Scheduled',
    preview: `${addOnName} quantity changes to ${params.newQuantity} on ${effectiveDate}.`,
    greeting: `Hi ${adminName},`,
    headline: 'Your add-on quantity reduction is scheduled',
    message: `For ${clinicName}, ${addOnName} access remains at ${params.previousQuantity} units through ${effectiveDate}. Starting then, your quantity will be ${params.newQuantity}; the removed capacity and any accounts using it will no longer be available.`,
    bodyHtml: `
      ${renderAlertBox(
        'Scheduled quantity change',
        `${params.previousQuantity} → ${params.newQuantity} units · Effective ${effectiveDate}`,
        'info'
      )}
      ${renderActionButton(
        'Open subscription settings',
        `${process.env.FRONTEND_URL || 'http://localhost:5173'}/subscription`
      )}
      ${renderLinkFallback(
        'Button not working? Copy this link into your browser:',
        `${process.env.FRONTEND_URL || 'http://localhost:5173'}/subscription`
      )}
    `,
  });
}

export function autoRenewStatusTemplate(params: {
  adminName: string;
  clinicName: string;
  planName: string;
  billingCycle: 'monthly' | 'yearly';
  status: 'enabled' | 'disabled' | 'setup_cancelled' | 'payment_method_updated';
  effectiveAt: Date | null;
  amount?: string;
  /** The method AutoPay now charges (payment_method_updated only). */
  paymentMethod?: string;
  /** The method it replaced, when known (payment_method_updated only). */
  previousPaymentMethod?: string;
  subscriptionUrl?: string;
}) {
  const adminName = escapeHtml(params.adminName || 'there');
  const clinicName = escapeHtml(params.clinicName || 'your clinic');
  const planName = escapeHtml(params.planName || 'your plan');
  const subscriptionUrl =
    params.subscriptionUrl ||
    `${process.env.FRONTEND_URL || 'http://localhost:5173'}/subscription`;
  const effectiveDate = params.effectiveAt
    ? params.effectiveAt.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;
  const enabled = params.status === 'enabled';
  const methodUpdated = params.status === 'payment_method_updated';
  const setupCancelled = params.status === 'setup_cancelled';
  // AutoPay is on in both of these: success styling and "Next renewal".
  const autoPayOn = enabled || methodUpdated;
  const paymentMethod = params.paymentMethod
    ? escapeHtml(params.paymentMethod)
    : '';
  const previousPaymentMethod = params.previousPaymentMethod
    ? escapeHtml(params.previousPaymentMethod)
    : '';
  const title = setupCancelled
    ? 'AutoPay Setup Cancelled'
    : enabled
      ? 'AutoPay Enabled'
      : methodUpdated
        ? 'AutoPay Payment Method Updated'
        : 'AutoPay Turned Off';
  const message = setupCancelled
    ? `The pending AutoPay setup for ${planName} was cancelled before authorization. No automatic renewal is active. Your current access remains available${effectiveDate ? ` through ${effectiveDate}` : ''}; renew manually to continue after that.`
    : enabled
      ? `AutoPay is enabled for ${planName} (${params.billingCycle}) at ${clinicName}. ${effectiveDate ? `Your next renewal is scheduled for ${effectiveDate}.` : 'Your next renewal will follow the current billing period.'}`
      : methodUpdated
        ? `The AutoPay payment method for ${planName} (${params.billingCycle}) at ${clinicName} has been updated${previousPaymentMethod && paymentMethod ? ` from ${previousPaymentMethod} to ${paymentMethod}` : paymentMethod ? ` to ${paymentMethod}` : ''}. Your previous payment mandate has been cancelled, so only the new one will be charged. ${effectiveDate ? `Your next renewal is scheduled for ${effectiveDate}.` : 'Your next renewal will follow the current billing period.'}`
        : `AutoPay is turned off for ${planName} at ${clinicName}. Your current plan and paid add-ons remain available${effectiveDate ? ` through ${effectiveDate}` : ' until the current billing period ends'}; renew manually to continue after that.`;
  const summary = [
    `${planName} · ${params.billingCycle}`,
    methodUpdated && paymentMethod ? `Payment method: ${paymentMethod}` : '',
    params.amount ? `Expected renewal: ${escapeHtml(params.amount)}` : '',
    effectiveDate
      ? `${autoPayOn ? 'Next renewal' : 'Access through'} ${effectiveDate}`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return renderEmailLayout({
    title,
    preview: title,
    greeting: `Hi ${adminName},`,
    headline: title,
    message,
    bodyHtml: `
      ${renderAlertBox('AutoPay status', summary, autoPayOn ? 'success' : 'info')}
      ${renderActionButton('Open subscription settings', subscriptionUrl)}
      ${renderLinkFallback(
        'Button not working? Copy this link into your browser:',
        subscriptionUrl
      )}
    `,
  });
}

export function accountAccessScheduledDeactivationTemplate(params: {
  userName: string;
  clinicName: string;
  roleName: string;
  changeSummary: string;
  effectiveAt: Date;
  reminder: boolean;
  dashboardUrl?: string;
}) {
  const userName = escapeHtml(params.userName || 'there');
  const clinicName = escapeHtml(params.clinicName || 'your clinic');
  const roleName = escapeHtml(params.roleName || 'team member');
  const changeSummary = escapeHtml(params.changeSummary);
  const dashboardUrl =
    params.dashboardUrl ||
    `${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard`;
  const effectiveDate = params.effectiveAt.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const title = params.reminder
    ? 'Access Deactivation in 3 Days'
    : 'Access Deactivation Scheduled';
  const message = params.reminder
    ? `This is a reminder that your ${roleName} access at ${clinicName} is scheduled to be deactivated on ${effectiveDate}. ${changeSummary}. Please contact your clinic admin if you need access after that date.`
    : `Your clinic admin has scheduled a change to ${changeSummary}. As a result, your ${roleName} access at ${clinicName} is scheduled to be deactivated on ${effectiveDate}. Please contact your clinic admin if you need access after that date.`;

  return renderEmailLayout({
    title,
    preview: `${title}: ${effectiveDate}`,
    greeting: `Hi ${userName} 👋`,
    headline: title,
    message,
    bodyHtml: `
      ${renderAlertBox(
        'Scheduled change',
        `${changeSummary} · Access ends ${effectiveDate}`,
        params.reminder ? 'warning' : 'info'
      )}
      ${renderActionButton('Go to dashboard', dashboardUrl)}
      ${renderLinkFallback(
        'Button not working? Copy this link into your browser:',
        dashboardUrl
      )}
    `,
  });
}

export function accountAccessDowngradeReversedTemplate(params: {
  userName: string;
  clinicName: string;
  roleName: string;
  currentPlanName: string;
  cancelledPlanName: string;
  effectiveAt: Date | null;
  dashboardUrl?: string;
}) {
  const userName = escapeHtml(params.userName || 'there');
  const clinicName = escapeHtml(params.clinicName || 'your clinic');
  const roleName = escapeHtml(params.roleName || 'team member');
  const currentPlanName = escapeHtml(params.currentPlanName || 'current plan');
  const cancelledPlanName = escapeHtml(
    params.cancelledPlanName || 'scheduled plan'
  );
  const dashboardUrl =
    params.dashboardUrl ||
    `${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard`;
  const effectiveDate = params.effectiveAt
    ? params.effectiveAt.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Asia/Kolkata',
      })
    : null;
  const message = `Your clinic admin cancelled the scheduled change from ${currentPlanName} to ${cancelledPlanName}. The planned deactivation of your ${roleName} account has been cancelled, and your access at ${clinicName} will continue under the ${currentPlanName} plan.${effectiveDate ? ` The change had been scheduled for ${effectiveDate}.` : ''}`;

  return renderEmailLayout({
    title: 'Your Account Access Is Restored',
    preview: `Your scheduled account deactivation was cancelled${effectiveDate ? ` for ${effectiveDate}` : ''}`,
    greeting: `Hi ${userName} 👋`,
    headline: 'Your Account Access Is Restored',
    message,
    bodyHtml: `
      ${renderAlertBox(
        'Downgrade cancelled',
        `Your ${roleName} access will remain active on ${currentPlanName}.`,
        'success'
      )}
      ${renderActionButton('Go to dashboard', dashboardUrl)}
      ${renderLinkFallback(
        'Button not working? Copy this link into your browser:',
        dashboardUrl
      )}
    `,
  });
}

export function addOnExpiryReminderTemplate(params: {
  adminName: string;
  clinicName: string;
  addOnName: string;
  quantity: number;
  expiresAt: Date;
  daysRemaining: number;
}) {
  const adminName = escapeHtml(params.adminName || 'there');
  const clinicName = escapeHtml(params.clinicName || 'your clinic');
  const addOnName = escapeHtml(params.addOnName || 'Add-on');
  const expiresDate = params.expiresAt.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
  const urgency =
    params.daysRemaining === 0
      ? 'expires today'
      : params.daysRemaining === 1
        ? 'expires tomorrow'
        : `expires in ${params.daysRemaining} days`;
  const timeLeft =
    params.daysRemaining === 0
      ? 'Expiry date is today.'
      : `${params.daysRemaining} day${params.daysRemaining === 1 ? '' : 's'} remaining.`;

  return renderEmailLayout({
    title: `Add-on ${urgency}`,
    preview: `${addOnName} ${urgency} for ${clinicName}.`,
    greeting: `Hi ${adminName},`,
    headline: `${addOnName} ${urgency}.`,
    message: `The ${addOnName} add-on for ${clinicName} is scheduled to expire on ${expiresDate}. It stops working after that date. Renew or adjust your subscription before then if you want to keep using it.`,
    bodyHtml: `
      ${renderAlertBox(
        'Add-on expiry',
        `${params.quantity} unit${params.quantity === 1 ? '' : 's'} · Expires ${expiresDate} · ${timeLeft}`,
        params.daysRemaining <= 3 ? 'warning' : 'info'
      )}
      ${renderActionButton(
        'Manage add-ons',
        `${process.env.FRONTEND_URL || 'http://localhost:5173'}/subscription`
      )}
      ${renderLinkFallback(
        'Button not working? Copy this link into your browser:',
        `${process.env.FRONTEND_URL || 'http://localhost:5173'}/subscription`
      )}
    `,
  });
}

export function addOnExpiredTemplate(params: {
  adminName: string;
  clinicName: string;
  addOnName: string;
  quantity: number;
  expiredAt: Date;
}) {
  const adminName = escapeHtml(params.adminName || 'there');
  const clinicName = escapeHtml(params.clinicName || 'your clinic');
  const addOnName = escapeHtml(params.addOnName || 'Add-on');
  const expiredDate = params.expiredAt.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });

  return renderEmailLayout({
    title: 'Add-on Expired',
    preview: `${addOnName} expired for ${clinicName}.`,
    greeting: `Hi ${adminName},`,
    headline: `${addOnName} has expired.`,
    message: `The ${addOnName} add-on for ${clinicName} expired on ${expiredDate}. It is no longer active. You can purchase it again from subscription settings if your clinic needs it.`,
    bodyHtml: `
      ${renderAlertBox(
        'Expiry completed',
        `${params.quantity} unit${params.quantity === 1 ? '' : 's'} of ${addOnName} expired on ${expiredDate}.`,
        'warning'
      )}
      ${renderActionButton(
        'Manage add-ons',
        `${process.env.FRONTEND_URL || 'http://localhost:5173'}/subscription`
      )}
      ${renderLinkFallback(
        'Button not working? Copy this link into your browser:',
        `${process.env.FRONTEND_URL || 'http://localhost:5173'}/subscription`
      )}
    `,
  });
}
