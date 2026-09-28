import { renderAlertBox, renderEmailLayout } from './emailTemplateLayout';

type ProfileRequestStatusParams = {
  doctorName: string;
  status: 'approved' | 'rejected';
  rejectionReason?: string | null;
  supportEmail?: string;
};

export const profileRequestStatusChangeTemplate = ({
  doctorName,
  status,
  rejectionReason,
  supportEmail = 'support@infinitymedisetu.com',
}: ProfileRequestStatusParams): string => {
  const isApproved = status === 'approved';
  const formattedDoctorName = doctorName.replace(/^[Dd]r\.?\s*/i, '').trim();
  const supportPhone = process.env.SUPPORT_PHONE || '+91 8770553894';

  return renderEmailLayout({
    title: 'Profile Update Request',
    preview: `Your profile update request has been ${status}.`,
    greeting: `Dear Dr. ${formattedDoctorName} 👋`,
    headline: 'Profile update request reviewed.',
    message:
      'Your request to update your professional profile details has been reviewed.',
    email: supportEmail,
    phone: supportPhone,
    bodyHtml: `
      ${renderAlertBox(
        isApproved ? 'Approved' : 'Request Declined',
        isApproved
          ? 'Your profile updates have been verified and successfully updated on the platform.'
          : `Your profile update request was not approved.${rejectionReason ? ` Reason: <strong>${rejectionReason}</strong>` : ''}`,
        isApproved ? 'success' : 'danger'
      )}
      ${renderAlertBox(
        'Need Assistance?',
        `If you need clarification or would like to submit other details, contact us at <a href="mailto:${supportEmail}" style="color:#0b7673; text-decoration:none; font-weight:700;">${supportEmail}</a>.`,
        'info'
      )}
    `,
  });
};
