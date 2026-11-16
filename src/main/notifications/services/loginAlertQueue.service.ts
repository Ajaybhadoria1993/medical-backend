// src/services/loginAlertQueue.service.ts
import { Job, Queue, Worker } from 'bullmq';
import { queueConnection } from '../queues/queueConnection';
import { eq } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { ClinicModel } from '../../clinic/models/clinic.model';
import { ClinicSettingsModel } from '../../clinic/models/clinicSettings.model';
import { sendEmail } from '../../../utils/email';
import logger from '../../../utils/logger';
import {
  renderAlertBox,
  renderDetailsCard,
  renderEmailLayout,
} from '../../../htmltamplates/emailTemplateLayout';

// geoip-lite is CommonJS

const geoip = require('geoip-lite');

interface LoginAlertJobData {
  userId: string;
  userEmail: string;
  userName: string;
  ipAddress?: string;
  userAgent?: string;
  loginTime: string;
  city?: string;
  country?: string;
}

class LoginAlertQueue {
  private queue?: Queue;
  private disabled: boolean;

  constructor() {
    this.disabled = process.env.ENABLE_LOGIN_ALERTS_QUEUE === 'false';

    if (this.disabled) {
      logger.info(
        'LoginAlertQueue is disabled via ENABLE_LOGIN_ALERTS_QUEUE=false'
      );
      return;
    }

    this.queue = new Queue('login-alerts', { connection: queueConnection });
    this.startWorker();
  }

  private startWorker() {
    const worker = new Worker(
      'login-alerts',
      async (job: Job<LoginAlertJobData>) => {
        await this.processLoginAlert(job.data);
      },
      { connection: queueConnection }
    );

    worker.on('completed', () => {});

    worker.on('failed', () => {});

    worker.on('error', (err) => {
      logger.error('Login alert worker error', err);
    });
  }

  private async processLoginAlert(data: LoginAlertJobData) {
    if (this.disabled) return;
    const [clinic] = await database
      .select({
        clinicId: ClinicModel.id,
        clinicName: ClinicModel.clinicName,
        loginAlertsEnabled: ClinicSettingsModel.loginAlertsEnabled,
      })
      .from(ClinicModel)
      .leftJoin(
        ClinicSettingsModel,
        eq(ClinicSettingsModel.clinicId, ClinicModel.id)
      )
      .where(eq(ClinicModel.userId, data.userId))
      .limit(1);

    if (!clinic || !clinic.loginAlertsEnabled) return;

    // 📍 Resolve location
    let city = data.city;
    let country = data.country;

    if ((!city || !country) && data.ipAddress) {
      let ip = data.ipAddress;

      // Handle IPv6 mapped IPv4 (::ffff:x.x.x.x)
      if (ip.startsWith('::ffff:')) {
        ip = ip.replace('::ffff:', '');
      }

      // Ignore private/local IPs
      const isPrivateIP =
        ip === '127.0.0.1' ||
        ip === '::1' ||
        ip.startsWith('192.168.') ||
        ip.startsWith('10.');

      if (!isPrivateIP) {
        const geo = geoip.lookup(ip);
        if (geo) {
          city = geo.city;
          country = geo.country;
        }
      }
    }

    const html = this.generateLoginAlertHTML({
      userName: data.userName,
      userEmail: data.userEmail,
      clinicName: clinic.clinicName,
      loginTime: data.loginTime,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
      city,
      country,
    });

    const subject = `MediArogya - Login Alert at ${clinic.clinicName}`;
    await sendEmail(data.userEmail, subject, html);
  }

  private generateLoginAlertHTML(data: {
    userName: string;
    userEmail: string;
    clinicName: string;
    loginTime: string;
    ipAddress?: string;
    userAgent?: string;
    city?: string;
    country?: string;
  }): string {
    const formattedTime = new Date(data.loginTime).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    // Parse device info from user agent
    let deviceInfo = 'Unknown Device';
    if (data.userAgent) {
      deviceInfo = this.parseUserAgent(data.userAgent);
    }

    // Only include location if it's not "Unknown"
    const hasLocation =
      data.city &&
      data.country &&
      data.city !== 'Local Network' &&
      data.country !== 'Development';

    const detailRows = [
      { label: 'Time:', value: formattedTime },
      { label: 'Device/OS:', value: deviceInfo },
    ];

    if (data.ipAddress) {
      detailRows.push({ label: 'IP Address:', value: data.ipAddress });
    }

    if (hasLocation) {
      detailRows.push({
        label: 'Location:',
        value: `${data.city}, ${data.country}`,
      });
    }

    const supportEmail =
      process.env.SUPPORT_EMAIL || 'bhadoriaajay99@gmail.com';
    const supportPhone = process.env.SUPPORT_PHONE || '+91 8602911113';
    return renderEmailLayout({
      title: 'Login Alert',
      preview: `New login detected for ${data.clinicName}.`,
      greeting: `Hi ${data.userName} 👋`,
      headline: 'New login detected on your account.',
      message: `A new login was detected on your account for ${data.clinicName}. Please review the details below.`,
      email: supportEmail,
      phone: supportPhone,
      bodyHtml: `
        ${renderDetailsCard('Login Details', detailRows)}
        ${renderAlertBox(
          'Security Note',
          'If this login was you, no action is required. If you do not recognize this activity, please change your password immediately and contact support.',
          'warning'
        )}
      `,
    });
  }

  private parseUserAgent(userAgent: string): string {
    let os = 'Unknown OS';
    let browser = 'Unknown Browser';

    // Parse OS
    if (userAgent.includes('Windows')) os = 'Windows';
    else if (userAgent.includes('Mac')) os = 'macOS';
    else if (userAgent.includes('Linux')) os = 'Linux';
    else if (userAgent.includes('Android')) os = 'Android';
    else if (userAgent.includes('iOS') || userAgent.includes('iPhone'))
      os = 'iOS';

    // Parse Browser
    if (userAgent.includes('Chrome') && !userAgent.includes('Edg'))
      browser = 'Chrome';
    else if (userAgent.includes('Firefox')) browser = 'Firefox';
    else if (userAgent.includes('Safari') && !userAgent.includes('Chrome'))
      browser = 'Safari';
    else if (userAgent.includes('Edg')) browser = 'Edge';
    else if (userAgent.includes('Opera')) browser = 'Opera';

    return `${os} - ${browser}`;
  }

  async addLoginAlert(data: LoginAlertJobData) {
    if (this.disabled || !this.queue) return;
    try {
      await this.queue.add('send-login-alert', data, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: 1000,
      });
    } catch (error) {
      console.error('Failed to queue login alert:', error);
    }
  }

  async shouldSendAlert(userId: string): Promise<boolean> {
    try {
      const [clinic] = await database
        .select({
          loginAlertsEnabled: ClinicSettingsModel.loginAlertsEnabled,
        })
        .from(ClinicModel)
        .leftJoin(
          ClinicSettingsModel,
          eq(ClinicSettingsModel.clinicId, ClinicModel.id)
        )
        .where(eq(ClinicModel.userId, userId))
        .limit(1);

      return !!(clinic && clinic.loginAlertsEnabled);
    } catch (error) {
      console.error('Failed to check login alert settings:', error);
      return false;
    }
  }
}

export const loginAlertQueue = new LoginAlertQueue();
