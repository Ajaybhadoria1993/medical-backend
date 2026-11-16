// src/utils/__tests__/smsClient.test.ts
import { sendSMS, sendWhatsAppOtp, sendWhatsAppTemplate } from '../smsClient';
import { SnsNotificationService } from '../../main/notifications/services/sns.service';
import { envConfig } from '../envConfig';
import { WhatsAppService } from '../../main/notifications/services/whatsapp.service';
import {
  buildTemplateBodyParams,
  buildTemplateUrlButtonParams,
  normalizeWhatsAppNumber,
  resolveTemplateName,
  sanitizeTemplateParam,
} from '../../main/notifications/utils/whatsappTemplate.utils';
import { formatDoctorName } from '../../main/notifications/models/appointmentParticipants.model';

// Mock SnsNotificationService
jest.mock('../../main/notifications/services/sns.service', () => {
  return {
    SnsNotificationService: {
      sendTransactionalSms: jest.fn().mockResolvedValue(undefined),
    },
  };
});

jest.mock('../../main/notifications/services/whatsapp.service', () => {
  return {
    WhatsAppService: {
      sendTemplateMessage: jest.fn().mockResolvedValue(undefined),
    },
  };
});

describe('smsClient AWS SNS routing and WhatsApp placeholder tests', () => {
  const originalEnv = process.env;
  let originalPatientTpl: string | undefined;
  let originalAdminTpl: string | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      DLT_TEMPLATE_PATIENT_MOBILE_VERIFICATION: 'PATIENT_VERIFY_TPL_ID',
      DLT_TEMPLATE_ADMIN_MOBILE_VERIFICATION: 'ADMIN_VERIFY_TPL_ID',
    };
    originalPatientTpl = envConfig.DLT_TEMPLATE_PATIENT_MOBILE_VERIFICATION;
    originalAdminTpl = envConfig.DLT_TEMPLATE_ADMIN_MOBILE_VERIFICATION;
    envConfig.DLT_TEMPLATE_PATIENT_MOBILE_VERIFICATION =
      'PATIENT_VERIFY_TPL_ID';
    envConfig.DLT_TEMPLATE_ADMIN_MOBILE_VERIFICATION = 'ADMIN_VERIFY_TPL_ID';
  });

  afterEach(() => {
    envConfig.DLT_TEMPLATE_PATIENT_MOBILE_VERIFICATION = originalPatientTpl;
    envConfig.DLT_TEMPLATE_ADMIN_MOBILE_VERIFICATION = originalAdminTpl;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should format and route +91 numbers to SnsNotificationService with matched patient template ID', async () => {
    await sendSMS(
      '+919876543210',
      'Your MediArogya verification code is 123456. It is valid for 10 minutes. Do not share this code with anyone.'
    );

    expect(SnsNotificationService.sendTransactionalSms).toHaveBeenCalledWith(
      '+919876543210',
      'Your MediArogya verification code is 123456. It is valid for 10 minutes. Do not share this code with anyone.',
      'PATIENT_VERIFY_TPL_ID'
    );
  });

  it('should format and route +91 numbers to SnsNotificationService with matched admin template ID', async () => {
    await sendSMS(
      '+919876543210',
      'Your MediArogya admin verification code is 654321. It is valid for 5 minutes. Do not share this code with anyone.'
    );

    expect(SnsNotificationService.sendTransactionalSms).toHaveBeenCalledWith(
      '+919876543210',
      'Your MediArogya admin verification code is 654321. It is valid for 5 minutes. Do not share this code with anyone.',
      'ADMIN_VERIFY_TPL_ID'
    );
  });

  it('should format and route international numbers directly to SnsNotificationService without DLT attributes', async () => {
    await sendSMS('15550100', 'Hello International SMS');

    expect(SnsNotificationService.sendTransactionalSms).toHaveBeenCalledWith(
      '+15550100',
      'Hello International SMS'
    );
  });

  it('strips only a real "Dr." prefix and the token label from booked params', async () => {
    await sendWhatsAppTemplate('9876543210', 'appointmentBooked', {
      patientName: 'Asha',
      doctorName: 'Dr. Drishti Rao',
      clinicName: 'Apollo',
      date: 'Fri, 10 Jul 2026',
      timeOrToken: 'Token No: 7',
      appointmentId: 'appt-1',
    });
    const body = (WhatsAppService.sendTemplateMessage as jest.Mock).mock
      .lastCall[3];
    expect(body[1]).toBe('Drishti Rao');
    expect(body[4]).toBe('7');
  });

  it('should send WhatsApp as an approved template with per-field params', async () => {
    delete process.env.WHATSAPP_TEMPLATE_APPOINTMENT_BOOKED; // a local .env may pin v1
    delete process.env.WHATSAPP_APPOINTMENT_BOOKED_HEADER_IMAGE_URL;
    await sendWhatsAppTemplate('9876543210', 'appointmentBooked', {
      patientName: 'Asha',
      doctorName: 'Dr. Rajesh Kumar',
      clinicName: 'Apollo',
      date: 'Fri, 10 Jul 2026',
      timeOrToken: 'Time: 10:00 AM',
      appointmentId: 'appt-1',
    });

    expect(WhatsAppService.sendTemplateMessage).toHaveBeenCalledWith(
      '+919876543210',
      'appointment_booked_utility_v1',
      'en',
      ['Asha', 'Rajesh Kumar', 'Apollo', 'Fri, 10 Jul 2026', 'Time: 10:00 AM'],
      ['appt-1?type=livequeue'],
      undefined
    );
  });

  it('should send an OTP through the authentication template, code in body and copy button', async () => {
    delete process.env.WHATSAPP_TEMPLATE_OTP; // a local .env may pin a name
    const sendingEnabled = envConfig.WHATSAPP_SENDING_ENABLED;
    // The staging switch does not apply: an OTP only goes to the number that asked.
    envConfig.WHATSAPP_SENDING_ENABLED = false;
    try {
      await sendWhatsAppOtp('+919876543210', '482913');
    } finally {
      envConfig.WHATSAPP_SENDING_ENABLED = sendingEnabled;
    }

    expect(WhatsAppService.sendTemplateMessage).toHaveBeenCalledWith(
      '+919876543210',
      'otp_verification',
      'en',
      ['482913'],
      ['482913']
    );
  });

  it('should use the env-configured OTP template name', async () => {
    process.env.WHATSAPP_TEMPLATE_OTP = 'homoheal_login_otp';
    await sendWhatsAppOtp('9876543210', '111222');

    expect(WhatsAppService.sendTemplateMessage).toHaveBeenCalledWith(
      '+919876543210',
      'homoheal_login_otp',
      'en',
      ['111222'],
      ['111222']
    );
  });

  it('should reject when WhatsApp fails, so the caller can answer 502', async () => {
    (WhatsAppService.sendTemplateMessage as jest.Mock).mockRejectedValueOnce(
      new Error('Meta rejected the template')
    );

    await expect(sendWhatsAppOtp('9876543210', '123456')).rejects.toThrow(
      'Meta rejected the template'
    );
  });

  it('should normalize WhatsApp numbers', () => {
    expect(normalizeWhatsAppNumber('+919876543210')).toBe('+919876543210');
    expect(normalizeWhatsAppNumber('9876543210')).toBe('+919876543210');
    expect(normalizeWhatsAppNumber('09876543210')).toBe('+919876543210');
    expect(normalizeWhatsAppNumber('91 98765 43210')).toBe('+919876543210');
  });
});

describe('WhatsApp template parameters', () => {
  it('should flatten multi-line values Meta would reject', () => {
    expect(sanitizeTemplateParam('Line one\n\nLine two\ttabbed')).toBe(
      'Line one Line two tabbed'
    );
  });

  it('should substitute a placeholder for empty values', () => {
    expect(sanitizeTemplateParam('   ')).toBe('-');
  });

  it('should build body params in the template placeholder order', () => {
    expect(
      buildTemplateBodyParams('appointmentNoShow', {
        patientName: 'Asha',
        doctorName: 'Dr. Rajesh Kumar',
        clinicName: 'Apollo',
        actionTaken: 'Rescheduled',
        reason: 'Patient did not\narrive',
      })
    ).toEqual([
      'Asha',
      'Dr. Rajesh Kumar',
      'Apollo',
      'Rescheduled',
      'Patient did not arrive',
    ]);
  });

  it('should prefix doctor names with Dr. without duplicating an existing one', () => {
    expect(formatDoctorName('Rajesh Kumar')).toBe('Dr. Rajesh Kumar');
    expect(formatDoctorName('Dr. Rajesh Kumar')).toBe('Dr. Rajesh Kumar');
    expect(formatDoctorName('dr Rajesh Kumar')).toBe('dr Rajesh Kumar');
    expect(formatDoctorName('  Rajesh Kumar  ')).toBe('Dr. Rajesh Kumar');
  });

  it('should fall back to a generic phrase for an unassigned doctor', () => {
    expect(formatDoctorName(null)).toBe('your doctor');
    expect(formatDoctorName('   ')).toBe('your doctor');
  });

  it('should prefer the env-configured template name over the default', () => {
    process.env.WHATSAPP_TEMPLATE_APPOINTMENT_REMINDER = 'custom_reminder';
    expect(resolveTemplateName('appointmentReminder')).toBe('custom_reminder');

    delete process.env.WHATSAPP_TEMPLATE_APPOINTMENT_REMINDER;
    expect(resolveTemplateName('appointmentReminder')).toBe(
      'appointment_reminder_utility_v1'
    );
  });

  // Placeholder order and button suffixes as approved on the WABA (2026-10-28).
  it('should map the utility_v1 templates to their approved bodies and buttons', () => {
    const base = {
      patientName: 'Asha',
      doctorName: 'Dr. Rajesh Kumar',
      clinicName: 'Apollo',
      date: 'Thu, 23 Jul 2026',
      timeOrToken: 'Token No: 12',
      appointmentId: 'appt-1',
    };
    const cases = [
      [
        'appointmentReminder',
        ['Asha', 'Rajesh Kumar', 'Apollo', 'Thu, 23 Jul 2026', '12'],
        ['appt-1?type=livequeue'],
      ],
      [
        'appointmentCancelled',
        ['Asha', 'Rajesh Kumar', 'Apollo', 'Thu, 23 Jul 2026', '12'],
        ['appt-1'],
      ],
      [
        'appointmentCompleted',
        ['Asha', 'Rajesh Kumar', 'Apollo'],
        ['appt-1/pdf'],
      ],
      ['consultationStarted', ['Asha', 'Rajesh Kumar', 'Apollo'], []],
      [
        'doctorRunningLate',
        ['Asha', 'Rajesh Kumar', 'Apollo', '12'],
        ['appt-1?type=livequeue'],
      ],
    ] as const;
    for (const [key, body, buttons] of cases) {
      expect(buildTemplateBodyParams(key, base)).toEqual(body);
      expect(buildTemplateUrlButtonParams(key, base)).toEqual(buttons);
    }
  });
});
