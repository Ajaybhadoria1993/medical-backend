import {
  renderActionButton,
  renderAlertBox,
  renderDetailsCard,
  renderEmailLayout,
} from './emailTemplateLayout';

type DoctorStatusChangeParams = {
  doctorName: string;
  clinicName: string;
  oldStatus: string;
  newStatus: string;
  changedBy: string;
  changedAt: Date;
  loginUrl?: string;
  supportEmail?: string;
};

export const doctorStatusChangeTemplate = ({
  doctorName,
  clinicName,
  oldStatus,
  newStatus,
  changedBy,
  changedAt,
  loginUrl = process.env.FRONTEND_URL
    ? `${process.env.FRONTEND_URL}/login`
    : 'https://infinitymedisetu.com/app/login',
  supportEmail = 'support@infinitymedisetu.com',
}: DoctorStatusChangeParams): string => {
  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'active':
      case 'approved':
        return '#10B981';
      case 'pending':
        return '#F59E0B';
      case 'blocked':
        return '#EF4444';
      case 'reviewing':
        return '#8B5CF6';
      case 'rejected':
        return '#DC2626';
      default:
        return '#677294';
    }
  };

  const mapStatusToFriendlyLabel = (status: string) => {
    switch (status.toLowerCase()) {
      case 'new':
        return 'Setup Required';
      case 'pending':
        return 'Pending Approval';
      case 'reviewing':
        return 'Under Review';
      default:
        return status;
    }
  };

  const normalizedNewStatus = newStatus.toLowerCase();
  const formattedDoctorName = doctorName.replace(/^[Dd]r\.?\s*/i, '').trim();
  const supportPhone = process.env.SUPPORT_PHONE || '+91 8770553894';
  const statusPill = (label: string, color: string) =>
    `<span style="display:inline-block; background:${color}15; border:1px solid ${color}30; border-radius:999px; color:${color}; font-family:'Outfit', Arial, Helvetica, sans-serif; font-size:10px; font-weight:700; line-height:14px; padding:4px 10px;">${label}</span>`;

  const statusMessage =
    normalizedNewStatus === 'active'
      ? renderAlertBox(
          'Welcome back!',
          'Your account is now active. You can log in and access all clinic features.',
          'success'
        )
      : normalizedNewStatus === 'inactive'
        ? renderAlertBox(
            'Account Inactive',
            'Your account is currently disabled. Please reach out to your administrator to reactivate it.',
            'warning'
          )
        : ['blocked', 'rejected'].includes(normalizedNewStatus)
          ? renderAlertBox(
              'Action Required',
              `Your account status is ${normalizedNewStatus}. If you think this is a mistake, contact our support team.`,
              'danger'
            )
          : normalizedNewStatus === 'pending'
            ? renderAlertBox(
                'Verification Pending',
                'Your details are currently under review. We will notify you once approval is complete.',
                'info'
              )
            : normalizedNewStatus === 'approved'
              ? renderAlertBox(
                  'Approved',
                  'Your account status has been approved.',
                  'success'
                )
              : '';

  return renderEmailLayout({
    title: 'Account Status Update',
    preview: `Your account status at ${clinicName} has been updated.`,
    greeting: `Dear Dr. ${formattedDoctorName} 👋`,
    headline: 'Your account status has changed.',
    message: `Your account status at ${clinicName} has been updated. Please review the details below.`,
    email: supportEmail,
    phone: supportPhone,
    bodyHtml: `
      ${renderDetailsCard('Status Details', [
        {
          label: 'Previous Status:',
          value: statusPill(
            mapStatusToFriendlyLabel(oldStatus),
            getStatusColor(oldStatus)
          ),
        },
        {
          label: 'New Status:',
          value: statusPill(
            mapStatusToFriendlyLabel(newStatus),
            getStatusColor(newStatus)
          ),
        },
        {
          label: 'Updated By:',
          value: `<strong style="color:#243033;">${changedBy}</strong>`,
        },
      ])}
      ${statusMessage}
      ${
        normalizedNewStatus === 'active'
          ? renderActionButton('Login to Your Account', loginUrl)
          : ''
      }
      ${renderAlertBox('Changed on', changedAt.toLocaleString(), 'info')}
      ${renderAlertBox(
        'Need Assistance?',
        `If you have questions about this status change, reach out to us at <a href="mailto:${supportEmail}" style="color:#0b7673; text-decoration:none; font-weight:700;">${supportEmail}</a>.`,
        'info'
      )}
    `,
  });
};
