// src/utils/email.ts
import nodemailer from 'nodemailer';
import { envConfig } from './envConfig'; // adapt to your project

const smtpPort = Number(process.env.SMTP_PORT || envConfig.SMTP_PORT || 587);

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || envConfig.SMTP_HOST,
  port: smtpPort,
  secure: smtpPort === 465,
  auth: {
    user: process.env.SMTP_USER || envConfig.SMTP_USER,
    pass: process.env.SMTP_PASS || envConfig.SMTP_PASS,
  },
});

export async function sendEmail(to: string, subject: string, html: string) {
  const from =
    process.env.SMTP_FROM || envConfig.SMTP_FROM || 'no-reply@example.com';
  const maxRetries = Number(process.env.EMAIL_MAX_RETRIES || 3);
  const baseDelay = Number(process.env.EMAIL_RETRY_BASE_MS || 500);
  let attempt = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lastErr: any;
  while (attempt < maxRetries) {
    try {
      const info = await transporter.sendMail({ from, to, subject, html });
      return info;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      lastErr = err;
      const code = err?.responseCode || err?.code;
      const transient =
        code === 451 ||
        code === 421 ||
        code === 450 ||
        code === 'ETIMEDOUT' ||
        code === 'ECONNECTION' ||
        code === 'EMESSAGE';
      attempt++;
      if (!transient || attempt >= maxRetries) throw lastErr;
      const delay = baseDelay * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
