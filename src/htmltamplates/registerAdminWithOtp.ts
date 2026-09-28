import {
  renderActionButton,
  renderAlertBox,
  renderEmailLayout,
  renderLinkFallback,
  renderValidityNotice,
} from './emailTemplateLayout';

type RegistrationOtpParams = {
  signUpLink: string;
};

export const registrationOtpTemplate = ({
  signUpLink,
}: RegistrationOtpParams): string =>
  renderEmailLayout({
    title: 'Complete Registration',
    preview: 'Complete your secure Infinity Medisetu registration.',
    greeting: 'Hello 👋',
    headline: 'Welcome to Infinity Medisetu!',
    message:
      'Thank you for choosing Infinity Medisetu. Click the button below to complete your registration and secure your account.',
    bodyHtml: `
      ${renderValidityNotice('This link is valid for <strong>10 minutes</strong>.')}
      ${renderActionButton('Complete Registration', signUpLink)}
      ${renderLinkFallback(
        'Or copy and paste this link in your browser:',
        signUpLink
      )}
      ${renderAlertBox(
        'Security Note',
        'Do not share this link with anyone, including members of our support team. We will never ask for your link over the phone or via email.',
        'warning'
      )}
    `,
  });
