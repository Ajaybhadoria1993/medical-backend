import {
  renderAlertBox,
  renderDetailsCard,
  renderEmailLayout,
} from './emailTemplateLayout';

type ClinicCreationNotificationParams = {
  superAdminName: string;
  clinicName: string;
  creatorName: string;
  creatorRole: string;
  clinicAddress: string;
  clinicPhone: string;
};

export const clinicCreationNotificationTemplate = ({
  superAdminName,
  clinicName,
  creatorName,
  creatorRole,
  clinicAddress,
  clinicPhone,
}: ClinicCreationNotificationParams): string => {
  return renderEmailLayout({
    title: 'New Clinic Registered',
    preview: `A new clinic "${clinicName}" has been successfully created.`,
    greeting: `Dear ${superAdminName} 👋`,
    headline: 'New Clinic Registered.',
    message: `This is a notification that a new clinic has been successfully registered on the Medisetu platform.`,
    bodyHtml: `
      ${renderDetailsCard('Registered Clinic Details', [
        { label: 'Clinic Name:', value: clinicName },
        { label: 'Registered By:', value: `${creatorName} (${creatorRole})` },
        { label: 'Contact No:', value: clinicPhone || 'N/A' },
        { label: 'Address:', value: clinicAddress || 'N/A' },
      ])}
      ${renderAlertBox(
        'Action Required',
        'Please review the clinic credentials, subscription plan, and active status in your Super Admin panel if necessary.',
        'info'
      )}
    `,
  });
};
