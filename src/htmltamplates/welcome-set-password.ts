import {
  renderActionButton,
  renderAlertBox,
  renderEmailLayout,
  renderValidityNotice,
} from './emailTemplateLayout';

type WelcomeSetPasswordParams = {
  name: string;
  clinicName: string;
  resetUrl: string;
};

export const welcomeSetPasswordTemplate = ({
  name,
  clinicName,
  resetUrl,
}: WelcomeSetPasswordParams): string => {
  const displayName = name.trim() || 'there';
  const greeting = displayName.toLowerCase().startsWith('dr')
    ? `Dear ${displayName} 👋`
    : `Hi, ${displayName} 👋`;

  return renderEmailLayout({
    title: 'You Have Been Invited',
    preview: `You've been invited to join ${clinicName} on Infinity Medisetu.`,
    greeting,
    headline: `You're invited to join ${clinicName}!`,
    message:
      "You've been invited to join Infinity Medisetu. To accept your invitation and get started, please set your password using the button below.",
    bodyHtml: `
      ${renderValidityNotice('This invitation link will expire in <strong>24 hours</strong>.')}
      ${renderActionButton('Accept Invitation', resetUrl)}
      ${renderAlertBox(
        'Security Note',
        "If you're not expecting this email, please contact the clinic administrator.",
        'warning'
      )}
    `,
  });
};
