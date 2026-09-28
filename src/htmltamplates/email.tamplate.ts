import { ClinicRow } from '../main/clinic/types/clinic.types';
import {
  renderActionButton,
  renderAlertBox,
  renderDetailsCard,
  renderEmailLayout,
  renderValidityNotice,
} from './emailTemplateLayout';

export const emailVerifyHtml = (
  name: string,
  verifyUrl: string,
  clinic?: ClinicRow
) => {
  const clinicName = clinic?.clinicName ?? 'Medisetu';
  const displayName = name.trim() || 'there';

  return renderEmailLayout({
    title: 'Verify Your Email',
    preview: 'Confirm your email address for Infinity Medisetu.',
    greeting: `Hi, ${displayName} 👋`,
    headline: `Welcome to ${clinicName}!`,
    message: 'Please confirm your email address by clicking the button below.',
    bodyHtml: `
      ${renderValidityNotice('This link will expire in <strong>10 minutes</strong>.')}
      ${renderActionButton('Verify Email', verifyUrl)}
      ${renderAlertBox(
        'Security Note',
        "If you're not expecting this email, please contact the clinic administrator.",
        'warning'
      )}
    `,
  });
};

export const emailGenratePasswordHtml = (
  name: string,
  email: string,
  generatePasword: string
) => {
  const displayName = name.trim() || 'there';

  return renderEmailLayout({
    title: 'Your Account Password',
    preview: 'Your Infinity Medisetu account credentials are ready.',
    greeting: `Hi, ${displayName} 👋`,
    headline: 'Your account has been created successfully.',
    message: 'Use the credentials below to log in.',
    bodyHtml: `
      ${renderDetailsCard('Login Credentials', [
        {
          label: 'Email:',
          value: `<strong style="color:#243033;">${email}</strong>`,
        },
        {
          label: 'Temporary Password:',
          value: `<span style="display:inline-block; background:#eefaf9; border:1px solid #bfe7e4; border-radius:6px; color:#0d696d; font-family:Consolas, Monaco, monospace; font-size:13px; font-weight:700; letter-spacing:1px; padding:6px 10px;">${generatePasword}</span>`,
        },
      ])}
      ${renderAlertBox(
        'Security Note',
        'This password is valid for 10 minutes. Please change it immediately after logging in for better security.',
        'warning'
      )}
    `,
  });
};

export const generateResetPasswordEmail = (
  user: { name: string; email: string; id: string },
  rawToken: string,
  expiresAt?: Date
) => {
  const expiryQuery = expiresAt
    ? `&expiresAt=${encodeURIComponent(expiresAt.toISOString())}`
    : '';
  const resetUrl = `${
    process.env.FRONTEND_URL || 'http://localhost:3000'
  }/reset-password?token=${encodeURIComponent(rawToken)}&uid=${encodeURIComponent(user.id)}${expiryQuery}`;
  const displayName = user.name.trim() || user.email || 'there';

  return renderEmailLayout({
    title: 'Reset Your Password',
    preview: 'Reset your Infinity Medisetu password.',
    greeting: `Hi, ${displayName} 👋`,
    headline: 'Reset your password securely.',
    message:
      'We received a request to reset your password. Click the button below to reset it.',
    bodyHtml: `
      ${renderValidityNotice('This link will expire in <strong>10 minutes</strong>.')}
      ${renderActionButton('Reset Password', resetUrl)}
      ${renderAlertBox(
        'Security Note',
        'If you did not request this password reset, please contact the clinic administrator.',
        'warning'
      )}
    `,
  });
};

export const passwordSetupEmailTemplate = (
  name: string,
  clinicName: string,
  resetUrl: string
) => {
  const displayName = name.trim() || 'there';

  return renderEmailLayout({
    title: 'Set Your Password',
    preview: 'Set your Infinity Medisetu account password.',
    greeting: `Hi, ${displayName} 👋`,
    headline: `Welcome to ${clinicName}!`,
    message:
      'Your email has been verified successfully. To complete your account setup, please set your password by clicking the button below.',
    bodyHtml: `
      ${renderValidityNotice('This link will expire in <strong>1 hour</strong>.')}
      ${renderActionButton('Set Your Password', resetUrl)}
      ${renderAlertBox(
        'Security Note',
        "If you're not expecting this email, please contact the clinic administrator.",
        'warning'
      )}
    `,
  });
};
